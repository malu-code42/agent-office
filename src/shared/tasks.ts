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

const TASK_LINE = /^\s*[-*]\s+\[([ xX-])\]\s+(.+?)\s*$/
const BLOCK_ID = /\s+(\^t\S+)$/i
const VALID_BLOCK_ID = /^\^t[a-z0-9]{6}$/i
const SCHEDULED_DATE = /\s+📅\s+(\d{4}-\d{2}-\d{2})$/
const COMPLETED_DATE = /\s+✅\s+(\d{4}-\d{2}-\d{2})$/
const DISCARDED_DATE = /\s+❌\s+(\d{4}-\d{2}-\d{2})(?:\s+[—-]\s+descartada:\s*(.*))?$/i
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
