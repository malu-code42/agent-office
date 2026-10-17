import { focusKey, type ArchivedTask } from '@shared/planning'
import { describeOperation, type CommitmentMove, type Proposal, type ProposalOperation } from '@shared/proposals'
import { ARCHIVE_LIST, parseTasksFile } from '@shared/tasks'
import { planMoveCommitment, type AgendaWriter } from './agenda-write'
import type { PlanningStore } from './planning'
import { lineOfId, planDiscard, planReschedule, type TaskWriter } from './tasks-write'

/**
 * Applies a proposal (AO-10): all of its operations or none. Every operation is planned in memory first,
 * against the files as the review read them; only when all of them plan does anything get written. The
 * order of the writes is tarefas.md, then planning.json (focus and archive), then agenda.md. A failure
 * before the first write writes nothing. If agenda.md fails after tarefas.md was written, the proposal stays
 * pending with only its agenda operations, and the failure is marked on it: nothing is silently half-applied.
 */

const NOT_FOUND = 'Não encontrei essa tarefa no tarefas.md. Abra o quadro Tarefas de novo.'

/** An operation that could not be planned. Nothing was written: the message names the operation, in pt-BR. */
export class ProposalFailed extends Error {
  readonly index: number

  constructor(index: number, message: string) {
    super(message)
    this.index = index
  }
}

type MoveOp = ProposalOperation & { kind: 'move-commitment' }

export interface ApplyDeps {
  tasks: TaskWriter
  agenda: AgendaWriter
  planning: PlanningStore
  now?: () => Date
  newId?: () => string
}

/** The focus set and the archive records as the operations plan them, applied to planning.json at the end. */
interface Steps {
  focus: Set<string>
  archived: { id: string; record: ArchivedTask }[]
  now: () => Date
  newId: (() => string) | undefined
}

/** The error's text without its final period, so a sentence can follow it. */
const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err)).replace(/\.$/, '')

/** One task operation planned on the text of tarefas.md; returns the new text. */
function planTaskOperation(text: string, op: Exclude<ProposalOperation, { kind: 'move-commitment' }>, steps: Steps): string {
  const key = focusKey(op.id)
  switch (op.kind) {
    case 'focus': {
      const found = parseTasksFile(text)
        .lists.map((list) => ({ list: list.name, task: list.tasks.find((t) => t.id?.toLowerCase() === key) }))
        .find((x) => x.task)
      if (!found?.task) throw new Error(NOT_FOUND)
      if (found.list === ARCHIVE_LIST) throw new Error('As tarefas do Archive não podem ir para o foco.')
      if (found.task.status !== 'open') throw new Error('Só tarefas abertas podem ir para o foco.')
      steps.focus.add(key)
      return text
    }
    case 'unfocus':
      if (!steps.focus.has(key)) throw new Error('Essa tarefa não está em foco.')
      steps.focus.delete(key)
      return text
    case 'reschedule':
      return planReschedule(text, lineOfId(text, op.id), op.date)
    case 'discard': {
      const done = planDiscard(text, lineOfId(text, op.id), op.reason, steps.now(), steps.newId)
      steps.focus.delete(key)
      steps.archived.push({ id: done.id, record: { origin: done.origin, completedAt: done.completedAt, originalLine: done.originalLine } })
      return done.text
    }
  }
}

/**
 * Applies `proposal` to the vault at `vault`. Throws a message for the user when it cannot: a ProposalFailed
 * names the operation, any other error is about the files (changed, missing, not read).
 */
export function applyProposal(vault: string, proposal: Proposal, deps: ApplyDeps): void {
  const { tasks, agenda, planning } = deps
  const steps: Steps = {
    focus: new Set(planning.focus()),
    archived: [],
    now: deps.now ?? (() => new Date()),
    newId: deps.newId,
  }

  const tasksBefore = tasks.current(vault)
  const titles = new Map<string, string>()
  for (const list of parseTasksFile(tasksBefore).lists) for (const t of list.tasks) if (t.id) titles.set(t.id.toLowerCase(), t.text)
  const titleOf = (id: string) => titles.get(focusKey(id))
  const fail = (index: number, err: unknown): never => {
    const what = describeOperation(proposal.operations[index]!, titleOf)
    throw new ProposalFailed(index, `Não consegui aplicar a operação ${index + 1} (${what}): ${messageOf(err)}. Nada foi escrito.`)
  }

  let tasksText = tasksBefore
  const agendaOps: { index: number; move: CommitmentMove; op: MoveOp }[] = []
  proposal.operations.forEach((op, index) => {
    if (op.kind === 'move-commitment') {
      agendaOps.push({ index, move: { from: op.from, to: op.to }, op })
      return
    }
    try {
      tasksText = planTaskOperation(tasksText, op, steps)
    } catch (err) {
      fail(index, err)
    }
  })

  let agendaBefore = ''
  let agendaText = ''
  if (agendaOps.length) {
    agendaBefore = agenda.current(vault)
    agendaText = agendaBefore
    for (const { index, move } of agendaOps) {
      try {
        agendaText = planMoveCommitment(agendaText, move)
      } catch (err) {
        fail(index, err)
      }
    }
  }

  // Every operation planned: the writes start now.
  if (tasksText !== tasksBefore) tasks.write(vault, tasksBefore, tasksText)
  const focus = [...steps.focus]
  const remaining = agendaOps.map((a) => a.op)
  try {
    planning.settleProposal(proposal.id, { focus, archived: steps.archived, operations: remaining })
  } catch (err) {
    if (tasksText !== tasksBefore) {
      throw new Error('O tarefas.md foi alterado, mas não consegui salvar o planning.json. Abra a proposta de novo para ver o que falta.', {
        cause: err,
      })
    }
    throw err
  }
  if (!agendaOps.length) return

  try {
    agenda.write(vault, agendaBefore, agendaText)
  } catch (err) {
    const message = `As tarefas e o foco foram salvos, mas não consegui gravar o agenda.md: ${messageOf(err)}. Os compromissos desta proposta continuam pendentes.`
    planning.settleProposal(proposal.id, { operations: remaining, failure: { index: 0, message } })
    throw new Error(message, { cause: err })
  }
  planning.removeProposal(proposal.id)
}
