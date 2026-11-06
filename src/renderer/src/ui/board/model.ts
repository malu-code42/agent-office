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

// ---------- ordenação das listas (AO-77) ----------

/**
 * Como as colunas do quadro ordenam os cartões. 'manual' é o padrão e é a ordem de sempre: o `order` do ticket,
 * o mesmo que arrastar e soltar grava. Todas as outras só mudam o que é mostrado; nada é gravado no ticket.
 */
export type SortKey =
  | 'manual'
  | 'key-asc'
  | 'key-desc'
  | 'tag'
  | 'priority-desc'
  | 'priority-asc'
  | 'type'
  | 'created-desc'
  | 'created-asc'
  | 'updated-desc'
  | 'updated-asc'

export const DEFAULT_SORT: SortKey = 'manual'

export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'manual', label: 'Ordem manual' },
  { value: 'key-asc', label: 'Número (menor primeiro)' },
  { value: 'key-desc', label: 'Número (maior primeiro)' },
  { value: 'tag', label: 'Etiqueta' },
  { value: 'priority-desc', label: 'Prioridade (maior primeiro)' },
  { value: 'priority-asc', label: 'Prioridade (menor primeiro)' },
  { value: 'type', label: 'Tipo' },
  { value: 'created-desc', label: 'Criação (mais recentes)' },
  { value: 'created-asc', label: 'Criação (mais antigos)' },
  { value: 'updated-desc', label: 'Atualização (mais recentes)' },
  { value: 'updated-asc', label: 'Atualização (mais antigos)' },
]

/** Valor salvo (ou digitado) que não é uma opção conhecida volta ao padrão. */
export function resolveSort(value: unknown): SortKey {
  return SORT_OPTIONS.some((o) => o.value === value) ? (value as SortKey) : DEFAULT_SORT
}

/** A ordem manual de sempre: `order` crescente. */
export function manualOrder(a: Ticket, b: Ticket): number {
  return a.order - b.order
}

/** Número da chave ("AO-12" vira 12), para AO-9 vir antes de AO-10. Sem número, vai para o fim. */
export function keyNumber(key: string): number {
  const m = /(\d+)\s*$/.exec(key)
  return m ? Number(m[1]) : Number.POSITIVE_INFINITY
}

/** Primeira etiqueta em ordem alfabética (pt-BR); null quando o ticket não tem etiqueta. */
export function firstTag(t: Ticket): string | null {
  if (!t.tags.length) return null
  return [...t.tags].sort((a, b) => a.localeCompare(b, 'pt-BR'))[0]
}

const PRIORITY_RANK: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 }
const TYPE_RANK: Record<string, number> = { task: 0, feature: 1, improvement: 2, bug: 3 }

function compareBy(sort: SortKey): (a: Ticket, b: Ticket) => number {
  const rank = (m: Record<string, number>, v: string) => m[v] ?? Number.MAX_SAFE_INTEGER
  switch (sort) {
    case 'key-asc':
    case 'key-desc': {
      const dir = sort === 'key-asc' ? 1 : -1
      return (a, b) => {
        const x = keyNumber(a.key)
        const y = keyNumber(b.key)
        // Infinity - Infinity é NaN: chaves sem número empatam.
        return x === y ? 0 : dir * (x < y ? -1 : 1)
      }
    }
    case 'tag':
      return (a, b) => {
        const ta = firstTag(a)
        const tb = firstTag(b)
        if (ta === null || tb === null) return ta === tb ? 0 : ta === null ? 1 : -1
        return ta.localeCompare(tb, 'pt-BR')
      }
    case 'priority-desc':
      return (a, b) => rank(PRIORITY_RANK, b.priority) - rank(PRIORITY_RANK, a.priority)
    case 'priority-asc':
      return (a, b) => rank(PRIORITY_RANK, a.priority) - rank(PRIORITY_RANK, b.priority)
    case 'type':
      return (a, b) => rank(TYPE_RANK, a.type) - rank(TYPE_RANK, b.type)
    case 'created-desc':
      return (a, b) => b.createdAt - a.createdAt
    case 'created-asc':
      return (a, b) => a.createdAt - b.createdAt
    case 'updated-desc':
      return (a, b) => b.updatedAt - a.updatedAt
    case 'updated-asc':
      return (a, b) => a.updatedAt - b.updatedAt
    default:
      return () => 0
  }
}

/**
 * Ordena uma cópia da lista. Empates (e a ordem manual inteira) seguem o `order` do ticket, então a ordenação é
 * estável sobre o que a usuária arrumou à mão.
 */
export function sortTickets(tickets: readonly Ticket[], sort: SortKey): Ticket[] {
  const byChoice = compareBy(sort)
  return [...tickets].sort((a, b) => {
    const c = byChoice(a, b)
    return Number.isNaN(c) || c === 0 ? manualOrder(a, b) : c
  })
}

/** Chave do localStorage com a ordenação escolhida por andar. */
export const SORT_STORAGE_KEY = 'agent-office.board.sort'

/** Lê o mapa andar → ordenação; qualquer coisa inválida (JSON quebrado, valor desconhecido) é descartada. */
export function parseSortMap(raw: string | null): Record<string, SortKey> {
  if (!raw) return {}
  try {
    const data: unknown = JSON.parse(raw)
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {}
    const out: Record<string, SortKey> = {}
    for (const [floor, v] of Object.entries(data)) {
      const sort = resolveSort(v)
      if (sort !== DEFAULT_SORT) out[floor] = sort
    }
    return out
  } catch {
    // JSON corrompido: começa do padrão em vez de quebrar o quadro.
    return {}
  }
}

/** Atualiza o mapa de um andar; o padrão não precisa ficar salvo. */
export function withSort(map: Record<string, SortKey>, floor: string, sort: SortKey): Record<string, SortKey> {
  const next = { ...map }
  if (sort === DEFAULT_SORT) delete next[floor]
  else next[floor] = sort
  return next
}
