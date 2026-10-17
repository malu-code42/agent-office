export type TaskStatus = 'open' | 'completed' | 'discarded'

export interface Task {
  text: string
  line: number
  status: TaskStatus
  id?: string
  dueDate?: string
  /** Data da linha no formato novo, como foi escrita: DD.MM.AAAA ou DD.MM. */
  date?: string
  /** Hora da linha no formato novo: HH:MM. */
  time?: string
  completedDate?: string
  reason?: string
}

export interface TaskList {
  name: string
  tasks: Task[]
}

export interface ParsedBoard {
  lists: TaskList[]
  warnings: string[]
}

/** A task typed in the "Nova tarefa" form. Optional fields are empty or missing when not given. */
export interface NewTaskDraft {
  title: string
  list: string
  date?: string
  time?: string
}

/** The list whose tasks are read-only on the board: they cannot be moved, and nothing moves into it. */
export const ARCHIVE_LIST = 'Archive'

/** A card dragged or sent to another list: its line in tarefas.md as the board read it, and the list. */
export interface TaskMove {
  line: number
  list: string
}

/** The task to complete: its line as the board read it, or its id (the focus popup has no line). */
export type TaskRef = { line: number } | { id: string }

/** A task to discard: the task, and the reason the form asks for (required, never empty). */
export interface TaskDiscard {
  target: TaskRef
  reason: string
}

/** A task to reopen: the task, and the list to put it back in when its origin list no longer exists. */
export interface TaskReopen {
  target: TaskRef
  list?: string
}

/** How long a completed task can be undone, in milliseconds. */
export const UNDO_WINDOW_MS = 10_000

const TASK_LINE = /^\s*[-*]\s+\[([ xX-])\]\s+(.+?)\s*$/
const BLOCK_ID = /\s+(\^t\S+)$/i
const VALID_BLOCK_ID = /^\^t[a-z0-9]{6}$/i
const SCHEDULED_DATE = /\s+📅\s+(\d{4}-\d{2}-\d{2})$/
const COMPLETED_DATE = /\s+✅\s+(\d{4}-\d{2}-\d{2}|\d{2}\.\d{2}\.\d{4})$/
// The date is DD.MM.AAAA (AO-06); the ISO day and "descartada: motivo" of the first lines are still read.
const DISCARDED_DATE = /\s+❌\s+(\d{4}-\d{2}-\d{2}|\d{2}\.\d{2}\.\d{4})(?:\s+[—-]\s+(?:descartada:\s*)?(.*))?$/i
/** Fields of the new format: "data | hora | lista | tarefa"; a field that is absent is not written. */
const FIELD_SEPARATOR = /\s+\|\s+/
const READ_DATE = /^\d{2}\.\d{2}(?:\.\d{4})?$/
const READ_TIME = /^\d{2}:\d{2}$/
export const DATE_FORMAT = /^\d{2}\.\d{2}\.\d{4}$/
export const TIME_FORMAT = /^([01]\d|2[0-3]):[0-5]\d$/
const MAX_TITLE = 200

/**
 * Reads Obsidian task-list headings without changing the source. Unknown non-empty
 * lines outside metadata and structural headings are warnings, never coerced into cards.
 * `headings[i]` is the 0-based line of the `##` heading of `lists[i]`.
 */
export function parseTasksFile(content: string): ParsedBoard & { original: string; headings: number[] } {
  const lines = content.split(/\r?\n/)
  const lists: TaskList[] = []
  const headings: number[] = []
  const warnings: string[] = []
  let currentList: TaskList | null = null
  let inFrontmatter = false
  let inSettings = false
  const seenIds = new Set<string>()

  for (let i = 0; i < lines.length; i++) {
    const line = i === 0 ? lines[i].replace(/^\uFEFF/, '') : lines[i]
    const trimmed = line.trim()

    if (i === 0 && trimmed === '---') {
      inFrontmatter = true
      continue
    }
    if (inFrontmatter) {
      if (trimmed === '---') inFrontmatter = false
      continue
    }

    if (/^%%\s*kanban:settings\s*%%$/i.test(trimmed)) continue
    if (/^%%\s*kanban:settings\s*$/i.test(trimmed)) {
      inSettings = true
      continue
    }
    if (inSettings) {
      if (/^%%\s*$/.test(trimmed)) inSettings = false
      continue
    }

    if (/^##\s+/.test(trimmed)) {
      currentList = { name: trimmed.replace(/^##\s+/, '').trim(), tasks: [] }
      lists.push(currentList)
      headings.push(i)
      continue
    }

    // Markdown headings are structure, not tasks; report other unknown content even before a list.
    if (/^#{1,6}\s+/.test(trimmed) || !trimmed) continue

    const match = TASK_LINE.exec(line)
    if (!match) {
      warnings.push(`Linha ${i + 1}: "${trimmed}" não é uma tarefa reconhecida.`)
      continue
    }
    if (!currentList) {
      warnings.push(`Linha ${i + 1}: tarefa fora de uma lista (adicione um título iniciado por ##).`)
      continue
    }

    const [, checkbox, rawText] = match
    let text = rawText.trim()
    const task: Task = {
      text,
      line: i + 1,
      status: checkbox.toLowerCase() === 'x' ? 'completed' : checkbox === '-' ? 'discarded' : 'open',
    }

    const id = BLOCK_ID.exec(text)
    if (id) {
      const blockId = id[1].slice(1)
      if (!VALID_BLOCK_ID.test(id[1])) {
        warnings.push(`Linha ${i + 1}: identificador de tarefa inválido; esperado ^t seguido por seis caracteres alfanuméricos.`)
      } else if (seenIds.has(blockId.toLowerCase())) {
        warnings.push(`Linha ${i + 1}: identificador de tarefa duplicado (${blockId}).`)
      } else {
        task.id = blockId
        seenIds.add(blockId.toLowerCase())
      }
      text = text.slice(0, id.index).trimEnd()
    }

    // The new format: the last field is the task, the one before it the list; the fields before
    // those are recognised by their pattern (date, time) and not by position.
    const fields = text.split(FIELD_SEPARATOR)
    const prefix = fields.slice(0, -2)
    if (fields.length > 1 && prefix.every((f) => READ_DATE.test(f) || READ_TIME.test(f))) {
      for (const f of prefix) {
        if (READ_DATE.test(f)) task.date = f
        else task.time = f
      }
      text = fields[fields.length - 1]
    }

    if (task.status === 'completed') {
      const date = COMPLETED_DATE.exec(text)
      if (date) {
        task.completedDate = date[1]
        text = text.slice(0, date.index).trimEnd()
      }
    } else if (task.status === 'discarded') {
      const date = DISCARDED_DATE.exec(text)
      if (date) {
        task.completedDate = date[1]
        if (date[2]) task.reason = date[2]
        text = text.slice(0, date.index).trimEnd()
      }
    }

    const due = SCHEDULED_DATE.exec(text)
    if (due) {
      task.dueDate = due[1]
      text = text.slice(0, due.index).trimEnd()
    }

    task.text = text
    if (!task.text) {
      warnings.push(`Linha ${i + 1}: a tarefa não tem título.`)
      continue
    }
    currentList.tasks.push(task)
  }

  return { lists, headings, warnings, original: content }
}

/** Whether a task line is in the new format: "data | hora | lista | tarefa", with the date and time optional. */
export function isNewFormatLine(line: string): boolean {
  const head = /^\s*[-*]\s+\[[ xX-]\]\s+/.exec(line)
  if (!head) return false
  const body = line.slice(head[0].length).trimEnd()
  const id = BLOCK_ID.exec(body)
  const fields = (id ? body.slice(0, id.index) : body).split(FIELD_SEPARATOR)
  return fields.length > 1 && fields.slice(0, -2).every((f) => READ_DATE.test(f) || READ_TIME.test(f))
}

/**
 * The line with its list field set to `list`, when it is in the new format with an id
 * ("data | hora | lista | tarefa ^ID"). Any other line, and a line without an id, comes back as it was.
 */
export function retargetListField(line: string, list: string): string {
  const head = /^\s*[-*]\s+\[[ xX-]\]\s+/.exec(line)
  if (!head) return line
  const rest = line.slice(head[0].length)
  const body = rest.trimEnd()
  const id = BLOCK_ID.exec(body)
  if (!id || !VALID_BLOCK_ID.test(id[1])) return line
  const parts = body.slice(0, id.index).split(/(\s+\|\s+)/)
  const fields = parts.filter((_, i) => i % 2 === 0)
  if (fields.length < 2 || !fields.slice(0, -2).every((f) => READ_DATE.test(f) || READ_TIME.test(f))) return line
  parts[2 * (fields.length - 2)] = list
  return head[0] + parts.join('') + body.slice(id.index) + rest.slice(body.length)
}

const isRealDate = (date: string): boolean => {
  const [d, m, y] = date.split('.').map(Number)
  const parsed = new Date(y, m - 1, d)
  return parsed.getFullYear() === y && parsed.getMonth() === m - 1 && parsed.getDate() === d
}

/** What is wrong with a new task, in words the form shows; null when it can be written. */
export function taskDraftProblem(draft: NewTaskDraft, listNames: readonly string[]): string | null {
  const title = draft.title.trim()
  if (!title) return 'Escreva o título da tarefa.'
  if (title.length > MAX_TITLE) return `O título pode ter até ${MAX_TITLE} caracteres.`
  if (/[\r\n]/.test(title)) return 'O título precisa caber em uma linha.'
  if (title.includes('|')) return 'O título não pode ter o caractere “|”, que separa os campos da linha.'
  if (/\^t[a-z0-9]/i.test(title)) return 'O título não pode ter “^t”, que marca o identificador da tarefa.'
  const list = draft.list.trim()
  if (!list) return 'Escolha a lista da tarefa.'
  if (list.includes('|')) return 'Essa lista tem o caractere “|” no nome. Renomeie a lista no tarefas.md.'
  if (!listNames.includes(list)) return `Não encontrei a lista “${list}” no tarefas.md. Escolha uma lista que exista.`
  const date = draft.date?.trim()
  if (date && (!DATE_FORMAT.test(date) || !isRealDate(date))) return 'Data inválida. Use DD.MM.AAAA, por exemplo 16.10.2026.'
  const time = draft.time?.trim()
  if (time && !TIME_FORMAT.test(time)) return 'Hora inválida. Use HH:MM, por exemplo 09:00.'
  return null
}

/** A task moved to another day: its line in tarefas.md as the board read it, and the day as DD.MM.AAAA. */
export interface TaskReschedule {
  line: number
  date: string
}

/** A date written DD.MM.AAAA for a day that exists in the calendar (no 31.02). */
export function isDateDDMMAAAA(date: string): boolean {
  return DATE_FORMAT.test(date) && isRealDate(date)
}

/** The date and time a card shows, as written in the line ("16.10.2026 09:00"); null when the line has neither. */
export function taskWhen(task: Pick<Task, 'date' | 'dueDate' | 'time'>): string | null {
  return [task.date ?? task.dueDate, task.time].filter(Boolean).join(' ') || null
}

/** A local day as DD.MM.AAAA, the way the lines of tarefas.md write dates. */
export const dayLabel = (d: Date): string =>
  `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`

/** A card of the completed list: the list it sits in and the task. */
export interface CompletedView {
  list: string
  task: Task
}

/** What the Tarefas board draws: one column per list but the Archive, without the completed tasks. */
export interface BoardView {
  columns: TaskList[]
  completed: CompletedView[]
}

/**
 * The columns and the completed tasks of the board. The Archive is not a column; a completed
 * task, wherever it is, leaves its column and is listed under "Mostrar concluídas", with the
 * discarded tasks of the Archive too: both can be reopened from there (AO-06).
 */
export function boardView(lists: readonly TaskList[]): BoardView {
  const columns: TaskList[] = []
  const completed: CompletedView[] = []
  for (const list of lists) {
    for (const task of list.tasks) {
      if (task.status === 'completed' || (task.status === 'discarded' && list.name === ARCHIVE_LIST))
        completed.push({ list: list.name, task })
    }
    if (list.name === ARCHIVE_LIST) continue
    columns.push({ name: list.name, tasks: list.tasks.filter((task) => task.status !== 'completed') })
  }
  return { columns, completed }
}

/** The days the Reagendar menu offers, from the local "today": tomorrow, in three days, and the Monday of next week. */
export function rescheduleTargets(today: Date): { label: string; date: string }[] {
  const daysAhead = (n: number) => dayLabel(new Date(today.getFullYear(), today.getMonth(), today.getDate() + n))
  // Sunday (0) gives 1 day, Monday (1) gives 7: always the Monday after today.
  const toMonday = (1 - today.getDay() + 7) % 7 || 7
  return [
    { label: 'Amanhã', date: daysAhead(1) },
    { label: 'Em 3 dias', date: daysAhead(3) },
    { label: 'Próxima semana', date: daysAhead(toMonday) },
  ]
}

/**
 * The line with its date field set to `date` (DD.MM.AAAA). A date already there is replaced where it
 * is; without one it goes first, before the time. Time, list, task and id stay as they are.
 * null when the line is not in the new format: a legacy line is never rewritten here.
 */
export function rescheduleLine(line: string, date: string): string | null {
  const head = /^\s*[-*]\s+\[[ xX-]\]\s+/.exec(line)
  if (!head) return null
  const rest = line.slice(head[0].length)
  const body = rest.trimEnd()
  const id = BLOCK_ID.exec(body)
  const content = id ? body.slice(0, id.index) : body
  const parts = content.split(/(\s+\|\s+)/)
  const fields = parts.filter((_, i) => i % 2 === 0)
  if (fields.length < 2 || !fields.slice(0, -2).every((f) => READ_DATE.test(f) || READ_TIME.test(f))) return null
  if (fields.length > 2 && READ_DATE.test(fields[0]!)) parts[0] = date
  else parts.unshift(date, parts[1]!)
  return head[0] + parts.join('') + (id ? body.slice(id.index) : '') + rest.slice(body.length)
}
