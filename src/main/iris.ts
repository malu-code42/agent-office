import { randomUUID } from 'node:crypto'
import {
  IRIS_NOT_UNDERSTOOD,
  IRIS_REQUEST_MAX,
  IRIS_SOURCE,
  irisContext,
  type IrisAnswer,
  type IrisPreview,
  type IrisResult,
} from '@shared/iris'
import { REFUSED_MESSAGE, type Proposal } from '@shared/proposals'
import { parseTasksFile } from '@shared/tasks'
import { PROFILES } from '@shared/profiles'
import { allCommitments, type AgendaWriter } from './agenda-write'
import { dayKey } from './backups'
import type { PlanningStore } from './planning'
import { planProposal } from './proposals'
import { readTasks, type TaskWriter } from './tasks-write'
import { parseIrisAnswer } from './validate'

/**
 * Luna (AO-13). A request in words goes through here: the context is built from the files and kept, the user
 * reads it (prepare), and only the send with that same token leaves the computer (send). The answer is checked
 * by the schema, planned against the files as they are now, and only then becomes a pending proposal with the
 * source "Luna". Nothing is written here: a confirmed proposal is applied by proposals.ts, as any other.
 * Logs carry events and reasons only: never the request, the context or the answer.
 */

export const IRIS_TIMEOUT_MS = 60_000
const EMPTY = 'Escreva o pedido para a Luna.'
const TOO_LONG = `O pedido pode ter até ${IRIS_REQUEST_MAX} caracteres.`
const NO_PENDING = 'Esse envio não existe mais. Revise o pedido de novo.'
const TIMEOUT = 'A Luna demorou para responder. Tente de novo.'
const UNAVAILABLE = 'Não consegui falar com a Luna agora. Verifique a conexão e o Claude Code, e tente de novo.'

/** Something the Luna could not do, with a message that is safe to show. The interpreter raises it; nothing else is shown raw. */
export class IrisUnavailable extends Error {}

/** Sends the context to a model and resolves with its text. `signal` aborts the call when the time is up. */
export interface IrisInterpreter {
  interpret(context: string, signal: AbortSignal): Promise<string>
}

export interface IrisLog {
  warn(...args: unknown[]): void
}

export interface IrisDeps {
  planning: PlanningStore
  tasks: TaskWriter
  agenda: AgendaWriter
  interpreter: IrisInterpreter
  log: IrisLog
  /** AO-43: the memories of the profiles, read when the context is built; empty when none has a summary. */
  memories?: () => { profile: string; summary: string }[]
  now?: () => Date
  newId?: () => string
  timeoutMs?: number
}

interface Pending {
  token: string
  vault: string
  context: string
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err)).replace(/\.$/, '')

/** The JSON object in the answer; a model that wraps it in text or a code fence still gets read, and the schema decides. */
function jsonOf(raw: unknown): unknown {
  if (typeof raw !== 'string') return undefined
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end < start) return undefined
  try {
    return JSON.parse(raw.slice(start, end + 1))
  } catch {
    // Not JSON: the answer is discarded below.
    return undefined
  }
}

export class IrisDesk {
  private pending: Pending | undefined
  private readonly now: () => Date
  private readonly newId: () => string

  constructor(private deps: IrisDeps) {
    this.now = deps.now ?? (() => new Date())
    this.newId = deps.newId ?? randomUUID
  }

  /**
   * Builds the context from tarefas.md and agenda.md and keeps it under a token. Nothing is sent: the caller
   * shows the returned text, and only send() with that token sends it.
   */
  prepare(vault: string, request: string): IrisPreview {
    const text = request.trim()
    if (!text) throw new Error(EMPTY)
    if ([...text].length > IRIS_REQUEST_MAX) throw new Error(TOO_LONG)
    const board = readTasks(vault)
    this.deps.tasks.remember(vault, board)
    const agendaText = this.deps.agenda.read(vault)
    const context = irisContext({
      request: text,
      today: dayKey(this.now()),
      commitments: agendaText === null ? [] : allCommitments(agendaText),
      lists: parseTasksFile(board).lists,
      profiles: PROFILES,
      memories: this.deps.memories?.(),
    })
    const token = this.newId()
    this.pending = { token, vault, context }
    return { token, context }
  }

  /**
   * Sends the context kept by prepare(), once. Returns a question when the Luna asks one (no proposal then),
   * or the proposal it created. Throws a message for the user when it cannot answer; the context is dropped either way.
   */
  async send(token: string): Promise<IrisResult> {
    const p = this.pending
    if (!p || p.token !== token) throw new Error(NO_PENDING)
    this.pending = undefined
    const answer = await this.ask(p.context)
    if (answer.question) return { kind: 'question', text: answer.question }
    if (answer.mediaDraft) return { kind: 'media-draft', draft: answer.mediaDraft }
    if (answer.profile && answer.operations.length === 0) return { kind: 'task', profile: answer.profile }

    // The files as they are now: an operation the text no longer matches becomes a question, not a proposal.
    this.refresh(p.vault)
    const candidate: Proposal = { id: 'iris-check', source: IRIS_SOURCE, createdAt: this.now().getTime(), operations: answer.operations }
    try {
      planProposal(p.vault, candidate, this.deps)
    } catch (err) {
      this.deps.log.warn('Luna: nenhuma proposta criada, uma referência não bate com os arquivos')
      return {
        kind: 'question',
        text: `A Luna não conseguiu montar a proposta sem ambiguidade: ${messageOf(err)}. Diga qual é, para tentar de novo.`,
      }
    }
    const proposal = this.deps.planning.addProposal({
      id: this.newId(),
      source: IRIS_SOURCE,
      createdAt: this.now().getTime(),
      operations: answer.operations,
    })
    return { kind: 'proposal', proposal, profile: answer.profile ?? null }
  }

  /** Drops the context kept for `token`, without sending it. */
  cancel(token: string): void {
    if (this.pending?.token === token) this.pending = undefined
  }

  private async ask(context: string): Promise<IrisAnswer> {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), this.deps.timeoutMs ?? IRIS_TIMEOUT_MS)
    let raw: unknown
    try {
      raw = await this.deps.interpreter.interpret(context, ac.signal)
    } catch (err) {
      if (ac.signal.aborted) {
        this.deps.log.warn('Luna: a resposta demorou demais')
        throw new Error(TIMEOUT, { cause: err })
      }
      if (err instanceof IrisUnavailable) {
        this.deps.log.warn('Luna: não foi possível consultar o Claude')
        throw new Error(err.message, { cause: err })
      }
      this.deps.log.warn('Luna: falha ao consultar o Claude')
      throw new Error(UNAVAILABLE, { cause: err })
    } finally {
      clearTimeout(timer)
    }
    try {
      return parseIrisAnswer(jsonOf(raw))
    } catch (err) {
      if (err instanceof Error && err.message === REFUSED_MESSAGE) {
        this.deps.log.warn('Luna: pedido de concluir tarefa recusado')
        throw new Error(REFUSED_MESSAGE, { cause: err })
      }
      this.deps.log.warn('Luna: resposta fora do formato, descartada')
      throw new Error(IRIS_NOT_UNDERSTOOD, { cause: err })
    }
  }

  private refresh(vault: string): void {
    this.deps.tasks.remember(vault, readTasks(vault))
    this.deps.agenda.read(vault)
  }
}
