/**
 * Propostas (AO-10): a list of operations that changes tarefas.md, planning.json and agenda.md, applied only
 * when the user confirms it. This file is the model and its text, with no file access (src/main/proposals.ts
 * does the files). "Concluir" is not an operation: a task is finished by the user on the board, with its undo.
 */

/** A commitment line of agenda.md. The lines have no id, so it is found by its day, its time and its title. */
export interface CommitmentRef {
  /** The day heading it sits under, AAAA-MM-DD. */
  day: string
  /** HH:MM */
  time: string
  title: string
}

/** A commitment moved to another time, or to another day heading of agenda.md. */
export interface CommitmentMove {
  from: CommitmentRef
  to: { day: string; time: string }
}

/** One change a proposal makes. Tasks are named by id: the lines move, the id does not. */
export type ProposalOperation =
  | { kind: 'focus'; id: string }
  | { kind: 'unfocus'; id: string }
  /** `date` is DD.MM.AAAA, as tarefas.md writes it. */
  | { kind: 'reschedule'; id: string; date: string }
  | { kind: 'discard'; id: string; reason: string }
  /** The step of today of a task in focus (planning.json, not tarefas.md). `text` is at most STEP_MAX characters. */
  | { kind: 'step'; id: string; text: string }
  | ({ kind: 'move-commitment' } & CommitmentMove)
  | ({ kind: 'add-commitment' } & CommitmentRef)
  | ({ kind: 'remove-commitment' } & CommitmentRef)

/** The operations that change agenda.md. The rest change tarefas.md or planning.json. */
export type AgendaOperation = Extract<ProposalOperation, { kind: 'move-commitment' | 'add-commitment' | 'remove-commitment' }>

export function isAgendaOperation(op: ProposalOperation): op is AgendaOperation {
  return op.kind === 'move-commitment' || op.kind === 'add-commitment' || op.kind === 'remove-commitment'
}

/** The kinds a proposal may never carry: finishing a task belongs to the board. */
export const REFUSED_KINDS: readonly string[] = ['concluir', 'complete']
export const REFUSED_MESSAGE = 'Concluir tarefa não faz parte de uma proposta: conclua a tarefa pelo quadro Tarefas.'

/** The operation that stopped the last confirmation: its place in the list the review shows, and why. */
export interface ProposalFailure {
  index: number
  message: string
}

/** A proposal waiting in the caixa de entrada. `source` is who proposed it, as the caller labels it ("revisão", "Luna"). */
export interface Proposal {
  id: string
  source: string
  createdAt: number
  operations: ProposalOperation[]
  failure?: ProposalFailure | undefined
}

/** A pending proposal as the caixa de entrada shows it. A click opens the review; the row never applies anything. */
export interface ProposalRow {
  id: string
  chip: 'proposta'
  name: string
  text: string
  createdAt: number
  failed: boolean
  action: 'review'
}

/** A real calendar day written AAAA-MM-DD (no 2026-02-31). */
export function isIsoDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  const parsed = new Date(y, m - 1, d)
  return parsed.getFullYear() === y && parsed.getMonth() === m - 1 && parsed.getDate() === d
}

/** AAAA-MM-DD as DD.MM.AAAA, the way the review and tarefas.md show a day. */
export function dayPt(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}

/** The task's title in quotes, or the bare id when the task is not in tarefas.md any more. */
function labelOf(id: string, titleOf: (id: string) => string | undefined): string {
  const title = titleOf(id)
  return title ? `“${title}”` : `a tarefa ${id}`
}

/** One operation in words the review shows, with the titles of its tasks when they are known. */
export function describeOperation(op: ProposalOperation, titleOf: (id: string) => string | undefined): string {
  switch (op.kind) {
    case 'focus':
      return `Pôr em foco ${labelOf(op.id, titleOf)}`
    case 'unfocus':
      return `Tirar do foco ${labelOf(op.id, titleOf)}`
    case 'reschedule':
      return `Reagendar ${labelOf(op.id, titleOf)} para ${op.date}`
    case 'discard':
      return `Descartar ${labelOf(op.id, titleOf)}, com o motivo: ${op.reason}`
    case 'step':
      return `Passo de hoje de ${labelOf(op.id, titleOf)}: ${op.text}`
    case 'move-commitment': {
      const { from, to } = op
      if (from.day === to.day) return `Mudar o compromisso “${from.title}” de ${from.time} para ${to.time} em ${dayPt(to.day)}`
      return `Mover o compromisso “${from.title}” de ${dayPt(from.day)} ${from.time} para ${dayPt(to.day)} às ${to.time}`
    }
    case 'add-commitment':
      return `Acrescentar o compromisso “${op.title}” em ${dayPt(op.day)} às ${op.time}`
    case 'remove-commitment':
      return `Tirar o compromisso “${op.title}” de ${dayPt(op.day)} às ${op.time}`
  }
}

/** The exact list of a proposal's operations, in the order they run. Nothing is applied by building it. */
export function describeProposal(p: Proposal, titleOf: (id: string) => string | undefined): string[] {
  return p.operations.map((op) => describeOperation(op, titleOf))
}

/** The caixa de entrada row of a pending proposal. */
export function proposalRow(p: Proposal): ProposalRow {
  const n = p.operations.length
  const count = `${n} ${n === 1 ? 'operação' : 'operações'}`
  return {
    id: p.id,
    chip: 'proposta',
    name: p.source,
    text: p.failure ? `${count} · a última tentativa falhou` : `${count} para revisar`,
    createdAt: p.createdAt,
    failed: !!p.failure,
    action: 'review',
  }
}
