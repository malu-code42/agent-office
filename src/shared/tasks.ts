export type TaskStatus = 'open' | 'completed' | 'discarded'

export interface Task {
  text: string
  line: number
  status: TaskStatus
  id?: string
  dueDate?: string
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

const TASK_LINE = /^\s*[-*]\s+\[([ xX-])\]\s+(.+?)\s*$/
const BLOCK_ID = /\s+(\^t\S+)$/i
const VALID_BLOCK_ID = /^\^t[a-z0-9]{6}$/i
const SCHEDULED_DATE = /\s+📅\s+(\d{4}-\d{2}-\d{2})$/
const BOLD_DATE = /^\*\*(\d{2}\.\d{2}(?:\.\d{4})?)\*\*\s*(?:\|\s*)?/
const COMPLETED_DATE = /\s+✅\s+(\d{4}-\d{2}-\d{2})$/
const DISCARDED_DATE = /\s+❌\s+(\d{4}-\d{2}-\d{2})(?:\s+[—-]\s+descartada:\s*(.*))?$/i

/**
 * Reads Obsidian task-list headings without changing the source. Unknown non-empty
 * lines outside metadata and structural headings are warnings, never coerced into cards.
 */
export function parseTasksFile(content: string): ParsedBoard & { original: string } {
  const lines = content.split(/\r?\n/)
  const lists: TaskList[] = []
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

    // The vault writes `**06.10.2026** | título`; the date is shown as written, never converted.
    const bold = BOLD_DATE.exec(text)
    if (bold) {
      task.dueDate ??= bold[1]
      text = text.slice(bold.index + bold[0].length).trimStart()
    }

    task.text = text
    if (!task.text) {
      warnings.push(`Linha ${i + 1}: a tarefa não tem título.`)
      continue
    }
    currentList.tasks.push(task)
  }

  return { lists, warnings, original: content }
}
