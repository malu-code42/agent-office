import { focusKey, type ArchivedTask, type Step } from '@shared/planning'
import { describeOperation, isAgendaOperation, type AgendaOperation, type Proposal, type ProposalOperation } from '@shared/proposals'
import { ARCHIVE_LIST, parseTasksFile } from '@shared/tasks'
import { planAddCommitment, planMoveCommitment, planRemoveCommitment, type AgendaWriter } from './agenda-write'
import { dayKey } from './backups'
import type { PlanningStore } from './planning'
import { lineOfId, planDiscard, planReschedule, type TaskWriter } from './tasks-write'

/**
 * Applies a proposal (AO-10): all of its operations or none. Every operation is planned in memory first,
 * against the files as the review read them; only when all of them plan does anything get written. The
 * order of the writes is tarefas.md, then planning.json (focus, steps and archive), then agenda.md. A failure
 * before the first write writes nothing. If agenda.md fails after tarefas.md was written, the proposal stays
 * pending with only its agenda operations, and the failure is marked on it: nothing is silently half-applied.
 * planProposal is the planning alone: the Luna uses it to check a proposal before the user sees it, and writes nothing.
 */

const NOT_FOUND = 'Não encontrei essa tarefa no tarefas.md. Abra o quadro Tarefas de novo.'
const NOT_IN_FOCUS = 'Só tarefas em foco podem ter passo de hoje.'

/** An operation that could not be planned. Nothing was written: the message names the operation, in pt-BR. */
export class ProposalFailed extends Error {
  readonly index: number

  constructor(index: number, message: string) {
    super(message)
    this.index = index
  }
}

export interface ApplyDeps {
  tasks: TaskWriter
  agenda: AgendaWriter
  planning: PlanningStore
  now?: () => Date
  newId?: () => string
}

/** The focus set, the archive records and the steps as the operations plan them, applied to planning.json at the end. */
interface Steps {
  focus: Set<string>
  archived: { id: string; record: ArchivedTask }[]
  steps: { id: string; step: Step }[]
  now: () => Date
  newId: (() => string) | undefined
}

/** What a proposal would write, computed without writing anything. */
export interface ProposalPlan {
  tasksBefore: string
  tasksText: string
  agendaBefore: string
  agendaText: string
  agendaOps: { index: number; op: AgendaOperation }[]
  focus: string[]
  archived: { id: string; record: ArchivedTask }[]
  steps: { id: string; step: Step }[]
}

/** The error's text without its final period, so a sentence can follow it. */
const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err)).replace(/\.$/, '')

/** One task operation planned on the text of tarefas.md; returns the new text. */
function planTaskOperation(text: string, op: Exclude<ProposalOperation, AgendaOperation>, steps: Steps): string {
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
    case 'step':
      if (!steps.focus.has(key)) throw new Error(NOT_IN_FOCUS)
      steps.steps.push({ id: key, step: { date: dayKey(steps.now()), text: op.text.trim() } })
      return text
  }
}

/** One agenda operation planned on the text of agenda.md; returns the new text. */
function planAgendaOperation(text: string, op: AgendaOperation): string {
  switch (op.kind) {
    case 'move-commitment':
      return planMoveCommitment(text, { from: op.from, to: op.to })
    case 'add-commitment':
      return planAddCommitment(text, { day: op.day, time: op.time, title: op.title })
    case 'remove-commitment':
      return planRemoveCommitment(text, { day: op.day, time: op.time, title: op.title })
  }
}

/**
 * Plans every operation of `proposal` against the files as they are now (the writers must have read them).
 * Throws a ProposalFailed naming the operation that cannot be planned; writes nothing.
 */
export function planProposal(vault: string, proposal: Proposal, deps: ApplyDeps): ProposalPlan {
  const { tasks, agenda, planning } = deps
  const steps: Steps = {
    focus: new Set(planning.focus()),
    archived: [],
    steps: [],
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
  const agendaOps: { index: number; op: AgendaOperation }[] = []
  proposal.operations.forEach((op, index) => {
    if (isAgendaOperation(op)) {
      agendaOps.push({ index, op })
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
    for (const { index, op } of agendaOps) {
      try {
        agendaText = planAgendaOperation(agendaText, op)
      } catch (err) {
        fail(index, err)
      }
    }
  }

  return {
    tasksBefore,
    tasksText,
    agendaBefore,
    agendaText,
    agendaOps,
    focus: [...steps.focus],
    archived: steps.archived,
    steps: steps.steps,
  }
}

/**
 * Applies `proposal` to the vault at `vault`. Throws a message for the user when it cannot: a ProposalFailed
 * names the operation, any other error is about the files (changed, missing, not read).
 */
export function applyProposal(vault: string, proposal: Proposal, deps: ApplyDeps): void {
  const { tasks, agenda, planning } = deps
  const plan = planProposal(vault, proposal, deps)

  // Every operation planned: the writes start now.
  if (plan.tasksText !== plan.tasksBefore) tasks.write(vault, plan.tasksBefore, plan.tasksText)
  const remaining = plan.agendaOps.map((a) => a.op)
  try {
    planning.settleProposal(proposal.id, { focus: plan.focus, archived: plan.archived, steps: plan.steps, operations: remaining })
  } catch (err) {
    if (plan.tasksText !== plan.tasksBefore) {
      throw new Error('O tarefas.md foi alterado, mas não consegui salvar o planning.json. Abra a proposta de novo para ver o que falta.', {
        cause: err,
      })
    }
    throw err
  }
  if (!plan.agendaOps.length) return

  try {
    agenda.write(vault, plan.agendaBefore, plan.agendaText)
  } catch (err) {
    const message = `As tarefas e o foco foram salvos, mas não consegui gravar o agenda.md: ${messageOf(err)}. Os compromissos desta proposta continuam pendentes.`
    planning.settleProposal(proposal.id, { operations: remaining, failure: { index: 0, message } })
    throw new Error(message, { cause: err })
  }
  planning.removeProposal(proposal.id)
}
