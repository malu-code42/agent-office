import { projectFor } from './projects'
import { STATUSES } from './tickets'
import type { ProjectFloor, Ticket } from './types'

// The tickets a squad may take. The order is the order of the board: by column, then
// by the position inside the column. The first ticket the player chooses is the one
// the squad works on; the others wait in its queue.

const column = new Map(STATUSES.map((s, i) => [s.value, i]))

/** The order of the board: by column, then by the position inside the column. */
export function byBoardOrder(a: Ticket, b: Ticket): number {
  return (column.get(a.status) ?? 0) - (column.get(b.status) ?? 0) || a.order - b.order
}

/** The tickets of a floor that nobody has taken yet, in the order of the board. */
export function pendingTickets(tickets: readonly Ticket[], projects: readonly ProjectFloor[], projectId: string): Ticket[] {
  return tickets
    .filter((t) => !t.closedAt)
    .filter((t) => projectFor(projects, t.cwd)?.id === projectId)
    .filter((t) => t.status === 'backlog' || t.status === 'todo')
    .filter((t) => !t.assignee)
    .sort(byBoardOrder)
}

/**
 * The tickets the player chose, in the order of the board. A ticket that someone else
 * took in the meantime stays in the list: the approval says so instead of forgetting it.
 */
export function orderedTickets(
  tickets: readonly Ticket[],
  projects: readonly ProjectFloor[],
  projectId: string,
  ids: readonly string[],
): Ticket[] {
  const wanted = new Set(ids)
  return tickets
    .filter((t) => wanted.has(t.id))
    .filter((t) => projectFor(projects, t.cwd)?.id === projectId)
    .sort(byBoardOrder)
}
