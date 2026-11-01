import { isIsoDay } from './proposals'

export const GOALS_FILE = 'objetivos.md'
/** Accepted names, in order of preference: the vault may keep the plain-text checklist instead. */
export const GOALS_FILES = [GOALS_FILE, 'objetivos.txt'] as const
export const GOAL_ID_RE = /^g[a-z0-9]{8}$/
export const GOAL_TASK_ID_RE = /^t[a-z0-9]{6}$/i

export interface GoalMilestone {
  text: string
  done: boolean
}

/** A topic of the study trail that counts for a goal: done when its study cycle concluded with the retest. */
export interface GoalTrailTopic {
  label: string
  discipline: string
  done: boolean
  /** AAAA-MM-DD the cycle concluded. */
  day?: string
}

export interface Goal {
  id: string
  title: string
  target: string
  deadline: string
  achieved: boolean
  milestones: GoalMilestone[]
  taskIds: string[]
  /** Plain checklist item (`- [ ] title`): no target, deadline, milestones or tasks. `line` is its index. */
  simple?: boolean
  line?: number
  /** AAAA-MM-DD the app first saw the goal achieved; filled by the main process, never written to the vault file. */
  achievedDate?: string
  /** Trail discipline ids (`- Trilha: P1-ICC, P2-ED`): the goal counts their topics too. */
  trail?: string[]
  /** The topics of those disciplines, filled by the main process from the trail and the cycles; never written. */
  trailTopics?: GoalTrailTopic[]
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
const TRAIL = /^- Trilha: (.+)$/
const CHECKLIST = /^\s*[-*] \[([ xX])\] (.+?)\s*$/

/** Stable id for a checklist goal (nothing is written to the file): FNV-1a of the title, plus the repeat count. */
function simpleGoalId(title: string, seen: Map<string, number>): string {
  const n = (seen.get(title) ?? 0) + 1
  seen.set(title, n)
  let hash = 0x811c9dc5
  for (const ch of `${title}\u0000${n}`) hash = Math.imul(hash ^ ch.codePointAt(0)!, 0x01000193) >>> 0
  return `g${hash.toString(36).padStart(8, '0').slice(-8)}`
}

/** Parses objetivos.md while retaining every original line for lossless read/write round trips. */
export function parseGoals(text: string): GoalDocument {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const trailingNewline = text.endsWith('\n')
  const lines = text.split(/\r?\n/)
  if (trailingNewline) lines.pop()
  const goals: Goal[] = []
  const seenTitles = new Map<string, number>()
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
        ...(current.trail?.length ? { trail: current.trail } : {}),
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
    const checklist = current ? null : CHECKLIST.exec(lines[i]!)
    if (checklist) {
      const title = checklist[2]!
      goals.push({
        id: simpleGoalId(title, seenTitles),
        title,
        target: '',
        deadline: '',
        achieved: checklist[1] !== ' ',
        milestones: [],
        taskIds: [],
        simple: true,
        line: i,
      })
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
    const trail = TRAIL.exec(line)
    if (id) current.id = id[1]!
    else if (target) current.target = target[1]!.trim()
    else if (deadline && isIsoDay(deadline[1]!)) current.deadline = deadline[1]!
    else if (status) current.achieved = status[1] === 'alcançado'
    else if (milestone) current.milestones!.push({ done: milestone[1] === 'x', text: milestone[2]!.trim() })
    else if (task) current.taskIds!.push(task[1]!.toLowerCase())
    else if (trail) current.trail = trail[1]!.split(',').map((item) => item.trim()).filter(Boolean)
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
  if (goal.simple) return goal.achieved ? { complete: 1, total: 1, percent: 100 } : { complete: 0, total: 1, percent: 0 }
  const taskIds = [...new Set(goal.taskIds.map((id) => id.toLowerCase()))]
  const topics = goal.trailTopics ?? []
  const total = goal.milestones.length + taskIds.length + topics.length
  // An achieved goal is whole, whatever its marks say.
  if (goal.achieved) return { complete: total || 1, total: total || 1, percent: 100 }
  if (total === 0) return { complete: 0, total: 0, percent: 0 }
  const completed = new Set([...completedTaskIds].map((id) => id.toLowerCase()))
  const complete = goal.milestones.filter((milestone) => milestone.done).length + taskIds.filter((id) => completed.has(id)).length + topics.filter((topic) => topic.done).length
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
export function appendGoal(text: string, draft: GoalDraft, simple = isChecklist(text)): string {
  const document = parseGoals(text)
  if (document.goals.some((goal) => goal.id === draft.id)) throw new Error('Esse objetivo já existe no arquivo.')
  if (simple) {
    // The user's checklist keeps its shape: one `- [ ] title` line, nothing else.
    const title = draft.title.trim()
    if (!title || title.length > 200 || /[\r\n]/.test(title)) throw new Error('Informe um título de uma linha, com até 200 caracteres.')
    return `${text}${text && !text.endsWith('\n') ? document.eol : ''}- [ ] ${title}${document.eol}`
  }
  validateDraft(draft)
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

/** True when the text only holds checklist goals (and at least one). */
function isChecklist(text: string): boolean {
  const { goals } = parseGoals(text)
  return goals.length > 0 && goals.every((goal) => goal.simple)
}

const SIMPLE_ONLY = 'Este objetivo é um item simples do objetivos.txt, sem marcos nem tarefas vinculadas.'

/** Changes one milestone, preserving all lines the codec does not own. */
export function setGoalMilestone(text: string, id: string, index: number, done: boolean): string {
  const document = parseGoals(text)
  const goal = document.goals.find((item) => item.id === id)
  if (goal?.simple) throw new Error(SIMPLE_ONLY)
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
  if (goal.simple) throw new Error(SIMPLE_ONLY)
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
  if (goal.simple) {
    const lines = [...document.lines]
    lines[goal.line!] = lines[goal.line!]!.replace(/\[[ xX]\]/, '[x]')
    return serializeGoals({ ...document, lines })
  }
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
