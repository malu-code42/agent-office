import { isIsoDay } from './proposals'

export const GOALS_FILE = 'objetivos.md'
export const GOAL_ID_RE = /^g[a-z0-9]{8}$/
export const GOAL_TASK_ID_RE = /^t[a-z0-9]{6}$/i

export interface GoalMilestone {
  text: string
  done: boolean
}

export interface Goal {
  id: string
  title: string
  target: string
  deadline: string
  achieved: boolean
  milestones: GoalMilestone[]
  taskIds: string[]
}

export interface GoalDocument {
  lines: string[]
  goals: Goal[]
  eol: '\n' | '\r\n'
  trailingNewline: boolean
}

export interface GoalProgress {
  complete: number
  total: number
  percent: number
}

const HEADING = /^## (.+)$/
const ID = /^- ID: (g[a-z0-9]{8})$/
const TARGET = /^- Alvo: (.+)$/
const DEADLINE = /^- Prazo: (\d{4}-\d{2}-\d{2})$/
const STATUS = /^- Estado: (ativo|alcançado)$/
const MILESTONE = /^- Marco: \[([ x])\] (.+)$/
const TASK = /^- Tarefa: \^(t[a-z0-9]{6})$/i

/** Parses objetivos.md while retaining every original line for lossless read/write round trips. */
export function parseGoals(text: string): GoalDocument {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const trailingNewline = text.endsWith('\n')
  const lines = text.split(/\r?\n/)
  if (trailingNewline) lines.pop()
  const goals: Goal[] = []
  let start = -1
  let current: Partial<Goal> | undefined
  const finish = (end: number) => {
    if (!current) return
    if (current.id && current.title && current.target && current.deadline && current.achieved !== undefined) {
      goals.push({
        id: current.id,
        title: current.title,
        target: current.target,
        deadline: current.deadline,
        achieved: current.achieved,
        milestones: current.milestones ?? [],
        taskIds: [...new Set(current.taskIds ?? [])],
      })
    }
    start = end
  }

  for (let i = 0; i < lines.length; i++) {
    const heading = HEADING.exec(lines[i]!)
    if (heading) {
      finish(i)
      current = { title: heading[1]!.trim(), milestones: [], taskIds: [] }
      continue
    }
    if (!current || i < start) continue
    const line = lines[i]!
    const id = ID.exec(line)
    const target = TARGET.exec(line)
    const deadline = DEADLINE.exec(line)
    const status = STATUS.exec(line)
    const milestone = MILESTONE.exec(line)
    const task = TASK.exec(line)
    if (id) current.id = id[1]!
    else if (target) current.target = target[1]!.trim()
    else if (deadline && isIsoDay(deadline[1]!)) current.deadline = deadline[1]!
    else if (status) current.achieved = status[1] === 'alcançado'
    else if (milestone) current.milestones!.push({ done: milestone[1] === 'x', text: milestone[2]!.trim() })
    else if (task) current.taskIds!.push(task[1]!.toLowerCase())
  }
  finish(lines.length)
  return { lines, goals, eol, trailingNewline }
}

/** Serializes the untouched document exactly, including unknown lines and original line endings. */
export function serializeGoals(document: GoalDocument): string {
  return document.lines.join(document.eol) + (document.trailingNewline ? document.eol : '')
}

/** Equal contribution for each milestone and unique linked task. A zero denominator is zero progress. */
export function goalProgress(goal: Goal, completedTaskIds: ReadonlySet<string>): GoalProgress {
  const taskIds = [...new Set(goal.taskIds.map((id) => id.toLowerCase()))]
  const total = goal.milestones.length + taskIds.length
  if (total === 0) return { complete: 0, total: 0, percent: 0 }
  const completed = new Set([...completedTaskIds].map((id) => id.toLowerCase()))
  const complete = goal.milestones.filter((milestone) => milestone.done).length + taskIds.filter((id) => completed.has(id)).length
  return { complete, total, percent: Math.floor((complete / total) * 100) }
}

export interface GoalDraft {
  id: string
  title: string
  target: string
  deadline: string
  milestones: GoalMilestone[]
  taskIds: string[]
}

/** Adds a readable goal section without rewriting existing or unrecognized Markdown. */
export function appendGoal(text: string, draft: GoalDraft): string {
  const document = parseGoals(text)
  validateDraft(draft)
  if (document.goals.some((goal) => goal.id === draft.id)) throw new Error('Esse objetivo já existe no arquivo.')
  const block = [
    `## ${draft.title.trim()}`,
    `- ID: ${draft.id}`,
    `- Alvo: ${draft.target.trim()}`,
    `- Prazo: ${draft.deadline}`,
    '- Estado: ativo',
    ...draft.milestones.map((milestone) => `- Marco: [${milestone.done ? 'x' : ' '}] ${milestone.text.trim()}`),
    ...[...new Set(draft.taskIds.map((id) => id.toLowerCase()))].map((id) => `- Tarefa: ^${id}`),
  ].join(document.eol)
  const prefix = text && !text.endsWith('\n') ? document.eol : ''
  return `${text}${prefix}${text ? document.eol : ''}${block}${document.eol}`
}

/** Changes one milestone, preserving all lines the codec does not own. */
export function setGoalMilestone(text: string, id: string, index: number, done: boolean): string {
  const document = parseGoals(text)
  const goal = document.goals.find((item) => item.id === id)
  if (!goal || !Number.isInteger(index) || index < 0 || index >= goal.milestones.length)
    throw new Error('Não encontrei esse marco no arquivo objetivos.md.')
  const section = sectionOf(document, id)
  let remaining = index
  const lines = [...document.lines]
  for (let i = section.start; i < section.end; i++) {
    const line = lines[i]!
    const match = MILESTONE.exec(line)
    if (!match) continue
    if (remaining-- === 0) {
      lines[i] = `- Marco: [${done ? 'x' : ' '}] ${match[2]}`
      break
    }
  }
  return serializeGoals({ ...document, lines })
}

/** Adds a canonical task link once; it never edits tarefas.md or completes the task. */
export function linkGoalTask(text: string, id: string, taskId: string): string {
  const document = parseGoals(text)
  const goal = document.goals.find((item) => item.id === id)
  if (!goal) throw new Error('Não encontrei esse objetivo no arquivo objetivos.md.')
  if (!GOAL_TASK_ID_RE.test(taskId)) throw new Error('O identificador da tarefa é inválido.')
  if (goal.taskIds.includes(taskId.toLowerCase())) return text
  const { end } = sectionOf(document, id)
  const lines = [...document.lines]
  lines.splice(end, 0, `- Tarefa: ^${taskId.toLowerCase()}`)
  return serializeGoals({ ...document, lines })
}

/** Marks a goal achieved only when the caller has explicitly confirmed it. */
export function markGoalAchieved(text: string, id: string): string {
  const document = parseGoals(text)
  const goal = document.goals.find((item) => item.id === id)
  if (!goal) throw new Error('Não encontrei esse objetivo no arquivo objetivos.md.')
  const section = sectionOf(document, id)
  const statusIndex = document.lines.findIndex((line, index) => index >= section.start && index < section.end && STATUS.test(line))
  if (statusIndex < 0) throw new Error('O estado desse objetivo não está reconhecido no arquivo objetivos.md.')
  const lines = [...document.lines]
  lines[statusIndex] = '- Estado: alcançado'
  return serializeGoals({ ...document, lines })
}

function sectionOf(document: GoalDocument, id: string): { start: number; end: number } {
  const idLine = document.lines.findIndex((line) => line === `- ID: ${id}`)
  if (idLine < 0) throw new Error('Não encontrei esse objetivo no arquivo objetivos.md.')
  let start = idLine
  while (start > 0 && !HEADING.test(document.lines[start]!)) start--
  let end = document.lines.findIndex((line, index) => index > start && HEADING.test(line))
  if (end < 0) end = document.lines.length
  return { start, end }
}

function validateDraft(draft: GoalDraft): void {
  if (!GOAL_ID_RE.test(draft.id)) throw new Error('O identificador do objetivo é inválido.')
  if (!draft.title.trim() || draft.title.trim().length > 200 || /[\r\n]/.test(draft.title))
    throw new Error('Informe um título de uma linha, com até 200 caracteres.')
  if (!draft.target.trim() || draft.target.trim().length > 500 || /[\r\n]/.test(draft.target))
    throw new Error('Informe um alvo mensurável em uma linha, com até 500 caracteres.')
  if (!isIsoDay(draft.deadline)) throw new Error('Informe um prazo válido no formato AAAA-MM-DD.')
  if (draft.milestones.some((milestone) => !milestone.text.trim() || /[\r\n]/.test(milestone.text) || milestone.text.length > 500)) {
    throw new Error('Cada marco precisa ter texto em uma linha, com até 500 caracteres.')
  }
  if (draft.taskIds.some((id) => !GOAL_TASK_ID_RE.test(id))) throw new Error('Um identificador de tarefa é inválido.')
}
