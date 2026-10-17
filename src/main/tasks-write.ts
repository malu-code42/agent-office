import { randomInt } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ArchivedTask } from '@shared/planning'
import {
  ARCHIVE_LIST,
  dayLabel,
  isDateDDMMAAAA,
  isNewFormatLine,
  parseTasksFile,
  rescheduleLine,
  retargetListField,
  taskDraftProblem,
  type NewTaskDraft,
  type ParsedBoard,
  type Task,
  type TaskList,
} from '@shared/tasks'
import { dayKey } from './backups'
import { writeFileAtomic } from './fs-safe'

/**
 * Creates a task in tarefas.md: one new line at the end of its list, nothing else changes.
 * Moves a task to the end of another list: its line goes, the same text comes back under the
 * target heading. Completes a task: its line goes to the Archive with the day it was done.
 * Discards a task (AO-06): the same move, with [-], ❌ and the reason, and no ✅. Reopens a
 * completed or discarded task: back to its origin list with the marks gone.
 * planNewTask, planMoveTask, planComplete, planDiscard and planReopen are pure (text in, text out).
 * createTaskWriter does the file: it checks the file still matches what the board read, backs it
 * up once per session, then writes it atomically. No Electron here, so it runs in unit tests against a temporary vault.
 */

export const TASKS_FILE = 'tarefas.md'
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'
const ID_ATTEMPTS = 100
const CHANGED = 'O tarefas.md mudou desde que você abriu o quadro, então nada foi escrito. Abra o quadro Tarefas de novo e tente outra vez.'
const UNDO_CHANGED = 'O tarefas.md mudou desde a conclusão, então nada foi desfeito. Abra o quadro Tarefas para ver o estado atual.'
const NOT_FOUND = 'Não encontrei essa tarefa no tarefas.md. Abra o quadro Tarefas de novo.'
const BROKEN_ID = 'Essa tarefa tem um identificador repetido ou inválido no tarefas.md. Corrija a linha e tente de novo.'
const CHECKBOX_OPEN = /^(\s*[-*]\s+)\[ \]/
const CHECKBOX_ANY = /^(\s*[-*]\s+)\[[ xX-]\]/
/** The mark a completed or discarded line ends with, before its id: ✅ or ❌, the day, and for a discard the reason. */
const DONE_MARK = /\s+[✅❌]\s+(?:\d{4}-\d{2}-\d{2}|\d{2}\.\d{2}\.\d{4})(?:\s+[—-]\s+.*)?$/
const REASON_MAX = 200
const NO_REASON = 'Escreva o motivo para descartar a tarefa.'
const NOT_DONE = 'Essa tarefa não está concluída nem descartada, então não há o que reabrir.'

/** A new id: ^t and six lowercase letters or digits, from the system's secure random source. */
export function randomTaskId(): string {
  let id = 't'
  for (let i = 0; i < 6; i++) id += ALPHABET[randomInt(ALPHABET.length)]
  return id
}

/** Every id token in the file (the Archive too), lowercased, as the reader stores them: t + chars. */
export function taskIdsIn(text: string): Set<string> {
  return new Set([...text.matchAll(/\^t[a-z0-9]+/gi)].map((m) => m[0].slice(1).toLowerCase()))
}

function pickId(taken: Set<string>, newId: () => string): string {
  for (let i = 0; i < ID_ATTEMPTS; i++) {
    const id = newId()
    if (!taken.has(id.toLowerCase())) return id
  }
  throw new Error('Não consegui gerar um identificador único para a tarefa. Tente de novo.')
}

/**
 * The text of tarefas.md with the new task at the end of its list, and the task's id.
 * Throws the message the form shows when the draft cannot be written.
 */
export function planNewTask(text: string, draft: NewTaskDraft, newId: () => string = randomTaskId): { text: string; id: string } {
  const board = parseTasksFile(text)
  const problem = taskDraftProblem(
    draft,
    board.lists.map((l) => l.name),
  )
  if (problem) throw new Error(problem)

  const list = draft.list.trim()
  const index = board.lists.findIndex((l) => l.name === list)
  const section = board.lists[index]
  const id = pickId(taskIdsIn(text), newId)
  const fields = [draft.date?.trim(), draft.time?.trim(), list, draft.title.trim()].filter((f): f is string => !!f)
  const line = `- [ ] ${fields.join(' | ')} ^${id}`

  // After the section's last task; with no task yet, right under its heading.
  const lines = text.split('\n')
  const last = section.tasks.at(-1)
  const after = last ? last.line - 1 : board.headings[index]
  const eol = lines[after].endsWith('\r') ? '\r' : ''
  lines.splice(after + 1, 0, line + eol)
  return { text: lines.join('\n'), id }
}

/**
 * The text of tarefas.md with the task on `line` moved to the end of the `target` list, and the
 * task's id. The line keeps its text; a new-format line gets its list field changed, and a task
 * without an id gets one now. Its children (indented lines) stay where they are. Same list: the text comes back as it was.
 */
export function planMoveTask(
  text: string,
  line: number,
  target: string,
  newId: () => string = randomTaskId,
): { text: string; id?: string } {
  const board = parseTasksFile(text)
  const from = board.lists.findIndex((l) => l.tasks.some((t) => t.line === line))
  const task = from < 0 ? undefined : board.lists[from]!.tasks.find((t) => t.line === line)
  if (!task) throw new Error(NOT_FOUND)
  if (board.lists[from]!.name === ARCHIVE_LIST) throw new Error('As tarefas do Archive não podem ser movidas pelo quadro.')
  if (target === ARCHIVE_LIST) throw new Error('Não é possível mover tarefas para o Archive pelo quadro.')
  const to = board.lists.findIndex((l) => l.name === target)
  if (to < 0) throw new Error(`Não encontrei a lista “${target}” no tarefas.md. Escolha uma lista que exista.`)
  if (target.includes('|')) throw new Error('Essa lista tem o caractere “|” no nome. Renomeie a lista no tarefas.md.')
  if (from === to) return { text, id: task.id }

  const lines = text.split('\n')
  let moved = lines[line - 1]!.replace(/\r$/, '')
  let id = task.id
  if (id) moved = retargetListField(moved, target)
  else {
    id = pickId(taskIdsIn(text), newId)
    moved = `${moved} ^${id}`
  }

  lines.splice(line - 1, 1)
  const rest = parseTasksFile(lines.join('\n'))
  const section = rest.lists[to]!
  const last = section.tasks.at(-1)
  // After the section's last task; with no task yet, right under its heading.
  const at = last ? last.line : rest.headings[to]! + 1
  const eol = lines[at - 1]!.endsWith('\r') ? '\r' : ''
  lines.splice(at, 0, moved + eol)
  return { text: lines.join('\n'), id }
}

/** What completing a task left behind: the file as it was and as it is now, and what the record keeps. */
export interface TaskCompletion {
  id: string
  origin: string
  completedAt: string
  originalLine: string
  before: string
  after: string
}

/** The line of the task with this id, as the board reads it. */
export function lineOfId(text: string, id: string): number {
  const key = id.toLowerCase()
  for (const list of parseTasksFile(text).lists) {
    for (const task of list.tasks) if (task.id?.toLowerCase() === key) return task.line
  }
  throw new Error(NOT_FOUND)
}

/**
 * The text of tarefas.md with the open task on `line` completed. Its line gets [x] and " ✅ DD.MM.AAAA"
 * before its id, and goes to the end of the Archive section (the Archive is made at the end of the
 * file when there is none). Its fields stay as they are; a task without an id gets one now.
 * Nothing else changes.
 */
export function planComplete(
  text: string,
  line: number,
  day: Date,
  newId: () => string = randomTaskId,
): { text: string; id: string; origin: string; originalLine: string; completedAt: string } {
  const board = parseTasksFile(text)
  const from = board.lists.findIndex((l) => l.tasks.some((t) => t.line === line))
  const task = from < 0 ? undefined : board.lists[from]!.tasks.find((t) => t.line === line)
  if (!task) throw new Error(NOT_FOUND)
  const origin = board.lists[from]!.name
  if (origin === ARCHIVE_LIST) throw new Error('As tarefas do Archive já estão concluídas.')
  if (task.status !== 'open') throw new Error('Só tarefas abertas podem ser concluídas.')

  const lines = text.split('\n')
  const raw = lines[line - 1]!
  const eol = raw.endsWith('\r') ? '\r' : ''
  const content = raw.slice(0, raw.length - eol.length)
  // A second id token would make the line read as a task with two ids: refuse it instead.
  if (!task.id && /\s\^t\S*\s*$/i.test(content)) throw new Error(BROKEN_ID)
  const id = task.id ?? pickId(taskIdsIn(text), newId)
  const body = content.trimEnd()
  const block = /\s+\^t\S+$/i.exec(body)
  const head = (block ? body.slice(0, block.index) : body).replace(CHECKBOX_OPEN, '$1[x]')
  const completed = `${head} ✅ ${dayLabel(day)} ^${id}`
  return { text: moveToArchive(text, line, completed), id, origin, originalLine: content, completedAt: dayKey(day) }
}

/**
 * The text with the line `line` taken out and `done` put at the end of the Archive section. The
 * Archive is made at the end of the file when there is none. Other lines and line endings stay.
 */
function moveToArchive(text: string, line: number, done: string): string {
  const lines = text.split('\n')
  lines.splice(line - 1, 1)
  const rest = parseTasksFile(lines.join('\n'))
  const archive = rest.lists.findIndex((l) => l.name === ARCHIVE_LIST)
  if (archive >= 0) {
    // After the section's last task; with no task yet, right under its heading.
    const last = rest.lists[archive]!.tasks.at(-1)
    const at = last ? last.line : rest.headings[archive]! + 1
    const eolAt = lines[at - 1]!.endsWith('\r') ? '\r' : ''
    lines.splice(at, 0, done + eolAt)
    return lines.join('\n')
  }
  // A new section at the end, after one blank line; the file keeps its last line break.
  const crlf = text.includes('\r\n') ? '\r' : ''
  const trailing = lines.at(-1) === ''
  const out = trailing ? lines.slice(0, -1) : lines
  if (out.length && out.at(-1)!.trim() !== '') out.push(crlf)
  out.push(`## ${ARCHIVE_LIST}${crlf}`, done + crlf)
  if (trailing) out.push('')
  return out.join('\n')
}

/** The text of tarefas.md as it was before a completion. Refused, with nothing written, when the file has changed since. */
export function planUndoComplete(text: string, done: Pick<TaskCompletion, 'before' | 'after'>): string {
  if (text !== done.after) throw new Error(UNDO_CHANGED)
  return done.before
}

/** What discarding a task left behind: the id, the list it came from, the day it left and the line as it was. */
export interface TaskDiscarded {
  id: string
  origin: string
  completedAt: string
  originalLine: string
}

/**
 * The text of tarefas.md with the open task on `line` discarded, and its id. The line gets [-] and
 * " ❌ DD.MM.AAAA — motivo" before its id, and goes to the end of the Archive. Discarding is not
 * completing: no ✅ is written. The reason is required, and a "|", a line break or "^t" is refused,
 * since each would break the fields of the line.
 */
export function planDiscard(
  text: string,
  line: number,
  reason: string,
  day: Date,
  newId: () => string = randomTaskId,
): { text: string } & TaskDiscarded {
  const motivo = reason.trim()
  if (!motivo) throw new Error(NO_REASON)
  if ([...motivo].length > REASON_MAX) throw new Error(`O motivo pode ter até ${REASON_MAX} caracteres.`)
  if (/[\r\n|]|\^t[a-z0-9]/i.test(motivo))
    throw new Error('O motivo não pode ter “|”, quebra de linha nem “^t”, que separam os campos da linha.')

  const board = parseTasksFile(text)
  const from = board.lists.findIndex((l) => l.tasks.some((t) => t.line === line))
  const task = from < 0 ? undefined : board.lists[from]!.tasks.find((t) => t.line === line)
  if (!task) throw new Error(NOT_FOUND)
  const origin = board.lists[from]!.name
  if (origin === ARCHIVE_LIST) throw new Error('As tarefas do Archive não podem ser descartadas.')
  if (task.status !== 'open') throw new Error('Só tarefas abertas podem ser descartadas.')

  const lines = text.split('\n')
  const raw = lines[line - 1]!
  const eol = raw.endsWith('\r') ? '\r' : ''
  const content = raw.slice(0, raw.length - eol.length)
  if (!task.id && /\s\^t\S*\s*$/i.test(content)) throw new Error(BROKEN_ID)
  const id = task.id ?? pickId(taskIdsIn(text), newId)
  const body = content.trimEnd()
  const block = /\s+\^t\S+$/i.exec(body)
  const head = (block ? body.slice(0, block.index) : body).replace(CHECKBOX_OPEN, '$1[-]')
  const discarded = `${head} ❌ ${dayLabel(day)} — ${motivo} ^${id}`
  return { text: moveToArchive(text, line, discarded), id, origin, originalLine: content, completedAt: dayKey(day) }
}

/** How a reopen goes: the file with the task back in its list, or the lists to choose from when its origin is gone. */
export type ReopenPlan = { status: 'done'; text: string; id?: string; list: string } | { status: 'choose'; lists: string[] }

export interface ReopenOptions {
  /** The list to put the task back in. Missing: the list it was taken from. */
  list?: string
  /** The record planning.json keeps for a task, by id, when there is one. */
  archived: (id: string) => ArchivedTask | undefined
}

/**
 * The text of tarefas.md with a completed or discarded task back in its list. Its ✅ or ❌ mark,
 * its date and its reason go, the checkbox is [ ] again and its id stays. A legacy line goes back to
 * the text it had before, when the record still has it. The task goes to the end of its origin list,
 * or to `opts.list`; with no origin left, nothing is written and the lists to choose from come back.
 * A task that is open already (a record left by a reopen that failed to clear it) is only let go of.
 */
export function planReopen(text: string, target: number | string, opts: ReopenOptions): ReopenPlan {
  const board = parseTasksFile(text)
  const found = locate(board, target)
  if (!found) throw new Error(NOT_FOUND)
  const { list: from, task } = found
  const record = task.id ? opts.archived(task.id) : undefined

  if (task.status === 'open') {
    if (!record) throw new Error(NOT_DONE)
    return { status: 'done', text, id: task.id, list: from.name }
  }

  const lists = board.lists.map((l) => l.name).filter((name) => name !== ARCHIVE_LIST)
  if (opts.list !== undefined && !lists.includes(opts.list)) {
    throw new Error(`Não encontrei a lista “${opts.list}” no tarefas.md. Escolha uma lista que exista.`)
  }
  const dest = opts.list ?? record?.origin
  if (dest === undefined || !lists.includes(dest)) return { status: 'choose', lists }

  const lines = text.split('\n')
  const raw = lines[task.line - 1]!
  const eol = raw.endsWith('\r') ? '\r' : ''
  const restored = reopenedLine(raw.slice(0, raw.length - eol.length), task, record)

  lines.splice(task.line - 1, 1)
  const rest = parseTasksFile(lines.join('\n'))
  const to = rest.lists.findIndex((l) => l.name === dest)
  const last = rest.lists[to]!.tasks.at(-1)
  // After the section's last task; with no task yet, right under its heading.
  const at = last ? last.line : rest.headings[to]! + 1
  const eolAt = lines[at - 1]!.endsWith('\r') ? '\r' : ''
  lines.splice(at, 0, restored + eolAt)
  return { status: 'done', text: lines.join('\n'), id: task.id, list: dest }
}

function locate(board: ParsedBoard, target: number | string): { list: TaskList; task: Task } | undefined {
  const key = typeof target === 'number' ? '' : target.toLowerCase()
  for (const list of board.lists) {
    for (const task of list.tasks) {
      if (typeof target === 'number' ? task.line === target : task.id?.toLowerCase() === key) return { list, task }
    }
  }
  return undefined
}

/** The line of a completed or discarded task as it was before: marks out, checkbox open, id kept. */
function reopenedLine(content: string, task: Task, record: ArchivedTask | undefined): string {
  const body = content.trimEnd()
  const block = /\s+\^t\S+$/i.exec(body)
  const idPart = task.id ? ` ^${task.id}` : (block?.[0] ?? '')
  if (record && !isNewFormatLine(content)) {
    return record.originalLine.replace(/\s+\^t\S+$/i, '').replace(CHECKBOX_ANY, '$1[ ]') + idPart
  }
  const head = block ? body.slice(0, block.index) : body
  return head.replace(DONE_MARK, '').replace(CHECKBOX_ANY, '$1[ ]') + idPart
}

/**
 * The text of tarefas.md with an id on the open task on `line`, and that id. A task that has one
 * keeps it and the text comes back as it was. Any other line gets " ^id" at its end and nothing else
 * changes: a legacy line keeps its format (rewriting it is ticket 19).
 */
export function planTaskId(text: string, line: number, newId: () => string = randomTaskId): { text: string; id: string } {
  const board = parseTasksFile(text)
  const list = board.lists.find((l) => l.tasks.some((t) => t.line === line))
  const task = list?.tasks.find((t) => t.line === line)
  if (!list || !task) throw new Error(NOT_FOUND)
  if (list.name === ARCHIVE_LIST) throw new Error('As tarefas do Archive não podem ir para o foco.')
  if (task.status !== 'open') throw new Error('Só tarefas abertas podem ir para o foco.')
  if (task.id) return { text, id: task.id }

  const lines = text.split('\n')
  const raw = lines[line - 1]!
  const eol = raw.endsWith('\r') ? '\r' : ''
  const content = raw.slice(0, raw.length - eol.length)
  // A second id token would make the line read as a task with two ids: refuse it instead.
  if (/\s\^t\S*\s*$/i.test(content))
    throw new Error('Essa tarefa tem um identificador repetido ou inválido no tarefas.md. Corrija a linha e tente de novo.')
  const id = pickId(taskIdsIn(text), newId)
  lines[line - 1] = `${content} ^${id}${eol}`
  return { text: lines.join('\n'), id }
}

/**
 * The text of tarefas.md with the date of the open task on `line` set to `date` (DD.MM.AAAA). Only
 * that field changes. A legacy line is refused, not rewritten: that is ticket 19.
 */
export function planReschedule(text: string, line: number, date: string): string {
  if (!isDateDDMMAAAA(date)) throw new Error('Data inválida. Use DD.MM.AAAA, por exemplo 16.10.2026.')
  const board = parseTasksFile(text)
  const list = board.lists.find((l) => l.tasks.some((t) => t.line === line))
  const task = list?.tasks.find((t) => t.line === line)
  if (!list || !task) throw new Error(NOT_FOUND)
  if (list.name === ARCHIVE_LIST) throw new Error('As tarefas do Archive não podem ser reagendadas pelo quadro.')
  if (task.status !== 'open') throw new Error('Só tarefas abertas podem ser reagendadas.')

  const lines = text.split('\n')
  const raw = lines[line - 1]!
  const eol = raw.endsWith('\r') ? '\r' : ''
  const next = rescheduleLine(raw.slice(0, raw.length - eol.length), date)
  if (next === null) throw new Error('Reescreva esta tarefa no novo formato antes de reagendar')
  lines[line - 1] = next + eol
  return lines.join('\n')
}

const stampOf = (d: Date): string => {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/** A copy of tarefas.md in <vault>/backups/tarefas/. Never overwrites an older copy. */
function backupTasks(vault: string, text: string, at: Date): void {
  const dir = join(vault, 'backups', 'tarefas')
  mkdirSync(dir, { recursive: true })
  const stamp = stampOf(at)
  let dest = join(dir, `tarefas-${stamp}.md`)
  for (let n = 2; existsSync(dest); n++) dest = join(dir, `tarefas-${stamp}-${n}.md`)
  writeFileAtomic(dest, text)
}

function readTasks(vault: string): string {
  const file = join(vault, TASKS_FILE)
  try {
    return readFileSync(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`tarefas.md não encontrado em ${vault}`, { cause: err })
    throw err
  }
}

export interface TaskWriterOptions {
  now?: () => Date
  newId?: () => string
}

/**
 * One writer per app session. `remember` is called with every text the board reads; a
 * create is refused unless the file on disk still has that same text.
 */
export function createTaskWriter(opts: TaskWriterOptions = {}) {
  const lastRead = new Map<string, string>()
  const backedUp = new Set<string>()
  const now = opts.now ?? (() => new Date())

  /** The file as the board read it last; throws when there was no read or the file changed since. */
  const unchanged = (vault: string): string => {
    const known = lastRead.get(vault)
    if (known === undefined) throw new Error('Abra o quadro Tarefas de novo antes de alterar o tarefas.md.')
    const text = readTasks(vault)
    if (text !== known) throw new Error(CHANGED)
    return text
  }

  const save = (vault: string, before: string, after: string): void => {
    if (!backedUp.has(vault)) {
      backupTasks(vault, before, now())
      backedUp.add(vault)
    }
    writeFileAtomic(join(vault, TASKS_FILE), after)
    lastRead.set(vault, after)
  }

  return {
    remember(vault: string, text: string): void {
      lastRead.set(vault, text)
    },
    /** Writes the task and returns its id. Nothing is written when a check fails. */
    create(vault: string, draft: NewTaskDraft): string {
      const text = unchanged(vault)
      const plan = planNewTask(text, draft, opts.newId)
      save(vault, text, plan.text)
      return plan.id
    },
    /** The id of the open task on `line` (as the board read it), given now when it has none. Returns the id. */
    assignId(vault: string, line: number): string {
      const text = unchanged(vault)
      const plan = planTaskId(text, line, opts.newId)
      if (plan.text !== text) save(vault, text, plan.text)
      return plan.id
    },
    /** Moves the task on `line` (as the board read it) to `list`. Nothing is written when it is already there. */
    move(vault: string, line: number, list: string): void {
      const text = unchanged(vault)
      const plan = planMoveTask(text, line, list, opts.newId)
      if (plan.text !== text) save(vault, text, plan.text)
    },
    /** Sets the date of the task on `line` (as the board read it) to `date`, DD.MM.AAAA. Nothing is written when it already is that date. */
    reschedule(vault: string, line: number, date: string): void {
      const text = unchanged(vault)
      const next = planReschedule(text, line, date)
      if (next !== text) save(vault, text, next)
    },
    /** Completes the task at `line` (as the board read it) or with this id, and returns what undo needs. */
    complete(vault: string, target: number | string): TaskCompletion {
      const text = unchanged(vault)
      const plan = planComplete(text, typeof target === 'number' ? target : lineOfId(text, target), now(), opts.newId)
      save(vault, text, plan.text)
      return {
        id: plan.id,
        origin: plan.origin,
        completedAt: plan.completedAt,
        originalLine: plan.originalLine,
        before: text,
        after: plan.text,
      }
    },
    /** Discards the open task on `line` or with this id, with its reason. Nothing is written when a check fails. */
    discard(vault: string, target: number | string, reason: string): TaskDiscarded {
      const text = unchanged(vault)
      const plan = planDiscard(text, typeof target === 'number' ? target : lineOfId(text, target), reason, now(), opts.newId)
      save(vault, text, plan.text)
      return { id: plan.id, origin: plan.origin, completedAt: plan.completedAt, originalLine: plan.originalLine }
    },
    /** Reopens the completed or discarded task on `line` or with this id. Writes nothing when it asks for a list instead. */
    reopen(vault: string, target: number | string, opts: ReopenOptions): ReopenPlan {
      const text = unchanged(vault)
      const plan = planReopen(text, target, opts)
      if (plan.status === 'done' && plan.text !== text) save(vault, text, plan.text)
      return plan
    },
    /** The file as the board or a review read it last. Refused when it changed since, so a proposal plans on what the user saw. */
    current(vault: string): string {
      return unchanged(vault)
    },
    /** Writes `after` in place of `before` (what `current` returned). Refused, with nothing written, when the file changed since. */
    write(vault: string, before: string, after: string): void {
      if (readTasks(vault) !== before) throw new Error(CHANGED)
      save(vault, before, after)
    },
    /** Gives back the text of tarefas.md from before `done`. Refused when the file is not the one `done` wrote. */
    undoComplete(vault: string, done: TaskCompletion): void {
      const text = readTasks(vault)
      save(vault, text, planUndoComplete(text, done))
    },
  }
}

export type TaskWriter = ReturnType<typeof createTaskWriter>
