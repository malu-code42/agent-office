import { projectFor } from '@shared/projects'
import type { AgentSummary, ProjectFloor, Ticket } from '@shared/types'

// The board's floor and card rules, without the DOM, so they can be tested on their own.

/** Floor filter value for tickets outside every project folder. */
export const GROUND = 'ground'

/** Floor filter value for every floor. */
export const ALL_FLOORS = ''

/** The floor the board shows each time it opens, whatever floor the player stands on: no ticket hides behind it. */
export function defaultFloor(_player: ProjectFloor | null): string {
  return ALL_FLOORS
}

export interface FloorTab {
  value: string
  label: string
}

/** The board's tabs: every floor, the ground floor, then one per project. */
export function floorTabs(projects: ProjectFloor[]): FloorTab[] {
  return [
    { value: ALL_FLOORS, label: 'Todos os andares' },
    { value: GROUND, label: 'Casa' },
    ...projects.map((p) => ({ value: p.id, label: p.name })),
  ]
}

/** The floor a ticket belongs to: the project holding its folder, or the ground floor. */
export function ticketFloor(t: Ticket, projects: ProjectFloor[]): string {
  return projectFor(projects, t.cwd)?.id ?? GROUND
}

/** The label on an elevator floor button: 'C' for the ground floor (Casa), the number for the floors above. */
export function elevatorFloorLabel(n: number): string {
  return n === 0 ? 'C' : String(n)
}

export function ticketsOnFloor(tickets: Ticket[], floor: string, projects: ProjectFloor[]): Ticket[] {
  return tickets.filter((t) => !floor || ticketFloor(t, projects) === floor)
}

/** The agent on a card: name, shirt colour, and the office id when it is still around to open. */
export interface CardAgent {
  name: string
  color: string | null
  id: string | null
}

/** Only for a ticket in progress with an agent on it. The agent may have left the office: then there is no id to open. */
export function cardAgent(t: Ticket, agents: ReadonlyMap<string, AgentSummary>): CardAgent | null {
  if (t.status !== 'doing' || t.assignee?.kind !== 'agent') return null
  const agent = t.assignee.id ? agents.get(t.assignee.id) : undefined
  const color = agent?.look.shirt ?? null
  return {
    name: agent?.name ?? t.assignee.name,
    color: color && /^#[0-9a-f]{6}$/i.test(color) ? color : null,
    id: agent ? agent.id : null,
  }
}

// ---------- filtros do quadro (AO-71) ----------

/** Etiquetas usadas nos tickets, sem repetir e em ordem alfabética (pt-BR). */
export function tagOptions(tickets: readonly Ticket[]): string[] {
  return [...new Set(tickets.flatMap((t) => t.tags))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
}

/** A etiqueta escolhida só vale se ainda existir nas opções do andar; senão volta para "Todas" (''). */
export function resolveTag(tag: string, options: readonly string[]): string {
  return options.includes(tag) ? tag : ''
}

export interface BoardFilters {
  /** Busca de texto, já em minúsculas e sem espaços nas pontas. */
  query: string
  type: string
  priority: string
  who: 'all' | 'me' | 'agents' | 'none' | ''
  tag: string
}

/** Todos os filtros combinam em E lógico; campo vazio não filtra. */
export function matchesFilters(t: Ticket, f: BoardFilters): boolean {
  if (f.type && t.type !== f.type) return false
  if (f.priority && t.priority !== f.priority) return false
  if (f.who === 'me' && t.assignee?.kind !== 'player') return false
  if (f.who === 'agents' && t.assignee?.kind !== 'agent') return false
  if (f.who === 'none' && t.assignee) return false
  if (f.tag && !t.tags.includes(f.tag)) return false
  return !f.query || [t.key, t.title, t.description, ...t.tags].some((v) => v.toLowerCase().includes(f.query))
}
