import { relative } from 'node:path'
import type { ResultChanges, WorktreeInfo } from '@shared/types'
import type { SquadPullRequest } from '@shared/types'
import { isPullRequestUrl } from '@shared/pull-request-url'
import { insideRoot } from './git'
import type { WorktreeState } from './git'

export interface SquadTicketPublishDeps {
  state(worktree: WorktreeInfo): Promise<WorktreeState>
  remoteHost(worktree: WorktreeInfo): Promise<string>
  existingPR(worktree: WorktreeInfo): Promise<string | null>
  commit(changes: ResultChanges, message: string): Promise<string>
  changes?(changes: ResultChanges): void
  committed?(changes: ResultChanges, sha: string): void
  openPR(worktree: WorktreeInfo, title: string, body: string): Promise<string>
  record(pr: SquadPullRequest): void
  reconstruct?(worktree: WorktreeInfo): Promise<ResultChanges>
}

/** A synchronous acquire gate prevents simultaneous automatic/manual publication attempts. */
export class SquadPublicationGate {
  private readonly active = new Set<string>()

  enter(key: string): boolean {
    if (this.active.has(key)) return false
    this.active.add(key)
    return true
  }

  leave(key: string): void {
    this.active.delete(key)
  }
}

/** Keep failures after publication out of the previous ticket's retryable result. */
export async function publishThenStartNext<T>(deps: {
  publish(): Promise<T>
  startNext(): Promise<void>
  publicationFailed(error: unknown): void
  nextStartFailed(error: unknown): void
}): Promise<boolean> {
  try {
    await deps.publish()
  } catch (error) {
    deps.publicationFailed(error)
    return false
  }

  try {
    await deps.startNext()
  } catch (error) {
    deps.nextStartFailed(error)
  }
  return true
}

/** Publishes one successful ticket result. Queue release is the final, URL-gated step. */
export async function publishSquadTicket(
  input: {
    changes?: ResultChanges
    worktree: WorktreeInfo
    ticket: { id: string; key: string; title: string }
    squad: string
    result: string
    now?: number
  },
  deps: SquadTicketPublishDeps,
): Promise<string> {
  const source = input.changes ?? (deps.reconstruct ? await deps.reconstruct(input.worktree) : undefined)
  if (!source) throw new Error('Não foi possível reconstruir o diff salvo com segurança; o ticket continua ativo.')
  if (!input.changes) deps.changes?.(source)
  const changes = publishableChanges(source, input.worktree, input.squad)
  if (!changes.files.length) throw new Error('O ciclo não deixou arquivos de entrega para publicar; o ticket continua ativo.')

  let url = await deps.existingPR(input.worktree)
  if (!url) {
    const state = await deps.state(input.worktree)
    if (!state.exists) throw new Error('A cópia isolada do ticket não existe mais; o ticket continua ativo.')
    if (state.dirty && !changes.committed) {
      const sha = await deps.commit(changes, `${input.ticket.key}: ${input.ticket.title}`)
      deps.committed?.(source, sha)
    }
    url = await deps.openPR(
      input.worktree,
      `${input.ticket.key}: ${input.ticket.title}`,
      `${input.result.slice(0, 6000)}\n\n---\nPR do squad ${input.squad}, ticket ${input.ticket.key}, branch \`${input.worktree.branch}\`. Revisão e merge ficam com a usuária.`,
    )
  }

  const host = await deps.remoteHost(input.worktree).catch(() => null)
  if (!isPullRequestUrl(url, host)) throw new Error('A URL do PR não corresponde ao host do remoto; o ticket continua ativo.')
  deps.record({
    ticketId: input.ticket.id,
    ticketKey: input.ticket.key,
    title: input.ticket.title,
    url,
    branch: input.worktree.branch,
    createdAt: input.now ?? Date.now(),
  })
  return url
}

/** Never commit the copied, canonical squad definitions or runner support files. */
export function publishableChanges(changes: ResultChanges, worktree: WorktreeInfo, squad: string): ResultChanges {
  if (!changes.git || changes.truncated || changes.discarded)
    throw new Error('O resultado não pode ser publicado com segurança; o ticket continua ativo.')
  const projectDir = relative(changes.root, worktree.path).replace(/\\/g, '/')
  if (projectDir === '..' || projectDir.startsWith('../') || projectDir.startsWith('..\\'))
    throw new Error('A pasta do squad está fora do worktree; nada foi publicado.')
  const prefix = projectDir ? `${projectDir}/` : ''
  const blocked = [`${prefix}squads/${squad}/`, `${prefix}_opensquad/`]
  const files = changes.files.filter((file) => {
    const absolute = insideRoot(changes.root, file.path)
    if (!absolute) return false
    const relativePath = relative(changes.root, absolute).replace(/\\/g, '/')
    if (!relativePath || relativePath.startsWith('../') || relativePath === '..') return false
    return !blocked.some((prefix) => relativePath.toLowerCase().startsWith(prefix.toLowerCase()))
  })
  return { ...changes, root: changes.root || worktree.path, files }
}
