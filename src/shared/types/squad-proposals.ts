// ---------- squad creation proposals (ticket 04) ----------
// A proposal is a composition the player asked for and has not approved yet. It lives in
// the app's own data, never in the project folder: a proposal is not a squad, and nothing
// it says exists on disk until "Aprovar e criar squad" is pressed.

/** Roles a member of a proposed squad may have. Closed list: the schema refuses anything else. */
export const SQUAD_ROLES = ['implementer', 'reviewer', 'analyst', 'tester', 'writer', 'researcher'] as const
export type SquadRole = (typeof SQUAD_ROLES)[number]

/** The label of each role, in pt-BR (the proposal and the pipeline speak pt-BR). */
export const SQUAD_ROLE_LABELS: Record<SquadRole, string> = {
  implementer: 'Implementador',
  reviewer: 'Revisor independente',
  analyst: 'Analista',
  tester: 'Testador',
  writer: 'Redator',
  researcher: 'Pesquisador',
}

/** Members besides the coordinator: the room holds from two to six (HANDOFF §3.4). */
export const SQUAD_MIN_MEMBERS = 2
export const SQUAD_MAX_MEMBERS = 6
/** The name of a squad: it may not be empty and it is short (HANDOFF §3.4.2). */
export const SQUAD_NAME_MAX = 60
/** Squad rooms per project floor: three, and never more (ticket 04). */
export const SQUAD_ROOM_COUNT = 3
/** Models a member may run on; '' = the default of Claude Code. */
export const SQUAD_MODELS = ['', 'fable', 'opus', 'sonnet', 'haiku'] as const
/** The label of each model, as the agent form shows them. */
export const SQUAD_MODEL_LABELS: Record<string, string> = { fable: 'Fable', opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku' }

/** "Claude Code · Opus · conta pessoal": what a member of the proposal runs with. */
export function memberEngineLine(member: { model: string; account: string }): string {
  const model = member.model ? (SQUAD_MODEL_LABELS[member.model] ?? member.model) : 'padrão do Claude Code'
  const account = member.account || 'conta do projeto'
  return `Claude Code · ${model} · ${account}`
}

/**
 * What the approval does with the tickets the player chose: the first one in the order
 * of the board works, the others wait in the queue of the squad.
 */
export function ticketAttribution(tickets: { key: string }[]): string {
  if (!tickets.length) return 'Sem tickets escolhidos: o squad nasce Disponível, sem ticket ativo.'
  const first = tickets[0]!
  const rest = tickets.slice(1)
  const waiting = rest.length ? `; ${rest.map((t) => t.key).join(', ')} ${rest.length > 1 ? 'aguardam' : 'aguarda'} na fila do squad` : ''
  return `Depois de aprovar: ${first.key} fica ativo${waiting}. Um ticket ativo por squad.`
}

/** A member of a proposed squad, as the player reviews it. */
export interface SquadProposalMember {
  /** File-safe id: it becomes a subagent type and a file name. */
  id: string
  name: string
  role: SquadRole
  /** Motor do integrante: squads run on Claude Code; nothing else is approved. */
  engine: 'claude'
  /** Model of the member: '' = the default of Claude Code. */
  model: string
  /** Account the member runs on: '' = the pool of the project. */
  account: string
  /** One line: what this member does. */
  focus: string
}

/** The proposed composition: a name and the members, in the order their desks are made. */
export interface SquadProposalComposition {
  name: string
  members: SquadProposalMember[]
}

/** Where the proposal is in its life. */
export type SquadProposalStatus = 'generating' | 'pending' | 'created' | 'assigned'

export interface SquadProposal {
  id: string
  /** Floor the room belongs to. */
  projectId: string
  /** Project folder (the one that holds squads/). */
  cwd: string
  /** Room of the floor: 0, 1 or 2. */
  room: number
  createdAt: number
  updatedAt: number
  /** What the player asked for (required). */
  brief: string
  /** Tickets the player chose, in the order of the board. */
  ticketIds: string[]
  /** What the player asked to change, oldest first. */
  adjustments: string[]
  /** Name of the squad, editable until the approval. */
  name: string
  /** The proposed composition; null while it is being generated. */
  composition: SquadProposalComposition | null
  status: SquadProposalStatus
  /** Code of squads/<code>, once the folder was created. */
  code?: string
}

/** The queue of a squad: the ticket it works on and the ones waiting for it. */
export interface SquadQueue {
  /** Squad code. */
  code: string
  /** Project folder of the squad. */
  cwd: string
  /** The ticket the squad is working on now; null when it has none. */
  active: string | null
  /** Tickets waiting, in order. */
  queue: string[]
  /** Pull requests already opened for this squad; each ticket keeps its own review record. */
  pendingPRs?: SquadPullRequest[]
  /** Durable pointer to the active ticket's isolated worktree, including startup gaps. */
  cycle?: {
    ticketId: string
    resultId?: string
    publicationError?: string
    /** Startup/resume error for this ticket cycle; distinct from publication failure. */
    startupError?: string
    worktree: { path: string; root: string; repo: string; branch: string; base: string }
  }
  updatedAt: number
}

export interface SquadPullRequest {
  ticketId: string
  ticketKey: string
  title: string
  url: string
  branch: string
  createdAt: number
}

/**
 * A proposal that still holds the room of a floor: it already has a composition and
 * no squad was published from it. While the composition is being redone (an
 * adjustment) the room keeps its amber outline; the first generation has no
 * composition yet, so the room stays dark (HANDOFF §3.4.2).
 */
export function holdsRoom(proposal: SquadProposal): boolean {
  return proposal.composition !== null && (proposal.status === 'pending' || proposal.status === 'generating')
}

/**
 * The rooms of a floor that the proposals hold: nobody else takes them. A proposal
 * whose composition is being redone holds its room too.
 */
export function heldRooms(projectId: string, proposals: readonly SquadProposal[]): number[] {
  return proposals.filter((p) => p.projectId === projectId && holdsRoom(p)).map((p) => p.room)
}

/** The steps of the window of a proposal. */
export type ProposalStep = 'brief' | 'loading' | 'error' | 'proposal'

/** What closing the window of a proposal does with it. */
export type ProposalCloseAction =
  /** The explicit "Cancelar": the proposal is thrown away. */
  | 'discard'
  /** The first composition is still being generated: the id the page chose goes away. */
  | 'discard-id'
  /** The proposal stays pending and the name the player edited is saved. */
  | 'keep'
  /** There is nothing to do: no proposal, or the squad was already created. */
  | 'none'

/**
 * What closing the window does with the proposal. The proposal on the screen stays
 * pending when the window closes (the room keeps its amber outline); only the
 * explicit "Cancelar" throws it away. A generation in flight never leaves anything
 * behind: while the first composition is being made there is no proposal yet, and
 * the id the page chose goes away with it.
 */
export function proposalCloseAction(input: {
  /** The player pressed "Cancelar" (and not Esc, the X or a click outside). */
  discard: boolean
  /** There is a proposal on the screen. */
  hasProposal: boolean
  /** The step the window is on. */
  step: ProposalStep
  /** The squad was already created: the name of the proposal no longer changes. */
  assigned: boolean
}): ProposalCloseAction {
  if (input.assigned) return 'none'
  if (input.discard) return input.hasProposal ? 'discard' : 'none'
  if (!input.hasProposal) return input.step === 'loading' ? 'discard-id' : 'none'
  // An existing proposal is not pending while its adjustment is being generated.
  // Closing then discards it just like closing the initial generation.
  if (input.step === 'loading' || input.step === 'error') return 'discard'
  return 'keep'
}
