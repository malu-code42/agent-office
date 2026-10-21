import { projectFor } from './projects'
import type { ProjectFloor, Ticket } from './types'

export const INVALID_BLOCKER_ID = '__invalid_blocker_data__'

export function blockerIdsFor(ticket: Ticket): string[] {
  const raw = (ticket as unknown as { blockedBy?: unknown }).blockedBy
  if (raw === undefined) return []
  if (!Array.isArray(raw) || raw.length > 200 || raw.some((id) => typeof id !== 'string' || !id)) return [INVALID_BLOCKER_ID]
  return [...new Set(raw as string[])]
}

export function hasBlockerPRSnapshot(ticket: Ticket, blockerId: string): boolean {
  const snapshots = ticket.blockerPRs as unknown
  return (
    !!snapshots &&
    typeof snapshots === 'object' &&
    !Array.isArray(snapshots) &&
    Object.prototype.hasOwnProperty.call(snapshots, blockerId) &&
    typeof (snapshots as Record<string, unknown>)[blockerId] === 'string' &&
    !!(snapshots as Record<string, string>)[blockerId]
  )
}

export function isTicketBlocked(ticket: Ticket, tickets: readonly Ticket[]): boolean {
  return unresolvedBlockerIds(ticket, tickets).length > 0
}

export function unresolvedBlockerIds(ticket: Ticket, tickets: readonly Ticket[]): string[] {
  const byId = new Map(tickets.map((item) => [item.id, item]))
  return blockerIdsFor(ticket).filter((id) => !hasBlockerPRSnapshot(ticket, id) && !byId.get(id)?.pullRequestUrl)
}

/** Validates same-project links and rejects self-links, duplicates, missing tickets, and cycles. */
export function validateTicketBlockers(
  ticketId: string,
  blockerIds: readonly string[],
  tickets: readonly Ticket[],
  projects: readonly ProjectFloor[],
): string | null {
  if (new Set(blockerIds).size !== blockerIds.length) return 'Um ticket bloqueador foi selecionado mais de uma vez.'
  const target = tickets.find((ticket) => ticket.id === ticketId)
  if (!target) return 'Esse ticket não existe mais.'
  const targetProject = projectFor(projects, target.cwd)
  if (!targetProject) return 'Defina um projeto para este ticket antes de adicionar bloqueios.'

  const byId = new Map(tickets.map((ticket) => [ticket.id, ticket]))
  for (const blockerId of blockerIds) {
    if (blockerId === ticketId) return 'Um ticket não pode bloquear a si mesmo.'
    const blocker = byId.get(blockerId)
    if (!blocker) return 'Um dos tickets bloqueadores não existe mais.'
    if (projectFor(projects, blocker.cwd)?.id !== targetProject.id) return 'Os tickets bloqueadores precisam ser do mesmo projeto.'

    const seen = new Set<string>()
    const reachesTarget = (id: string): boolean => {
      if (id === ticketId) return true
      if (seen.has(id)) return false
      seen.add(id)
      return (id === ticketId ? blockerIds : byId.get(id) ? blockerIdsFor(byId.get(id)!) : []).some(reachesTarget)
    }
    if (reachesTarget(blockerId)) return 'Esse vínculo criaria um ciclo entre tickets.'
  }
  return null
}

/** Returns queue ids in their original order, excluding the chosen active ticket. */
export function firstUnblockedTicketId(ids: readonly string[], tickets: readonly Ticket[]): string | null {
  const byId = new Map(tickets.map((ticket) => [ticket.id, ticket]))
  return ids.find((id) => {
    const ticket = byId.get(id)
    return !!ticket && !ticket.closedAt && !isTicketBlocked(ticket, tickets)
  }) ?? null
}
