import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { dayPt, isIsoDay, type CommitmentMove, type CommitmentRef } from '@shared/proposals'
import { TIME_FORMAT } from '@shared/tasks'
import { writeFileAtomic } from './fs-safe'

/**
 * agenda.md of the vault: "## AAAA-MM-DD" headings, each with its commitments as "- HH:MM título". A
 * proposal can move one commitment to another time or day (AO-10). A line that is not a commitment (a
 * task reference, a note, a blank) is never changed, and it stays where it is.
 * planMoveCommitment is pure (text in, text out). createAgendaWriter does the file with the same safety
 * as tasks-write.ts: the file must still be the one the review read, a copy is taken once per session, and
 * the write is atomic. Nothing here knows about the vault's other files.
 */

export const AGENDA_FILE = 'agenda.md'
const DATE_HEADING = /^##\s+(\d{4}-\d{2}-\d{2})$/
/** The commitment shape on the line itself: indent and dash, the time, then the rest (its spacing and title). */
const COMMITMENT = /^(\s*-\s+)(\d{2}:\d{2})(\s.*)$/
const TASK_REFERENCE = '↦'
const NOT_READ = 'Abra a proposta de novo antes de confirmar: o agenda.md ainda não foi lido.'
const CHANGED = 'O agenda.md mudou desde que você abriu a proposta, então nada foi escrito. Abra a proposta de novo e tente outra vez.'
const MISSING = 'Não encontrei o agenda.md no vault. Crie o arquivo ou tire os compromissos desta proposta.'

/** A date section: the lines from heading + 1 up to `end` (exclusive) belong to the day, until any other heading. */
interface Section {
  day: string
  heading: number
  end: number
}

function sectionsOf(lines: string[]): Section[] {
  const out: Section[] = []
  let open: Section | undefined
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i]!.trim()
    if (!t.startsWith('#')) continue
    if (open) open.end = i
    open = undefined
    const m = DATE_HEADING.exec(t)
    if (m && isIsoDay(m[1]!)) {
      open = { day: m[1]!, heading: i, end: lines.length }
      out.push(open)
    }
  }
  return out
}

const bodyOf = (s: Section): number[] => Array.from({ length: s.end - s.heading - 1 }, (_, k) => s.heading + 1 + k)

/** The time and title a line holds as a commitment, or null: a task reference (↦) is not one. */
function commitmentOf(raw: string): { prefix: string; time: string; rest: string; title: string } | null {
  const m = COMMITMENT.exec(raw.replace(/\r$/, ''))
  if (!m || !TIME_FORMAT.test(m[2]!)) return null
  const title = m[3]!.trim()
  if (!title || title.includes(TASK_REFERENCE)) return null
  return { prefix: m[1]!, time: m[2]!, rest: m[3]!, title }
}

/** The same line with its time changed. Only the time moves: the dash, the spacing, the title and the line break stay. */
function retimed(raw: string, time: string): string {
  const c = commitmentOf(raw)!
  const eol = raw.endsWith('\r') ? '\r' : ''
  return `${c.prefix}${time}${c.rest}${eol}`
}

const matches = (raw: string, from: CommitmentRef): boolean => {
  const c = commitmentOf(raw)
  return !!c && c.time === from.time && c.title === from.title
}

/**
 * The text of agenda.md with the commitment moved. The same day: only its time changes. Another day: the
 * line is taken out of its section and put after the last filled line of the target day, so the blank
 * lines and unknown lines of both days stay where they are. The target day must already have its heading.
 */
export function planMoveCommitment(text: string, move: CommitmentMove): string {
  const { from, to } = move
  if (!isIsoDay(from.day) || !isIsoDay(to.day) || !TIME_FORMAT.test(from.time) || !TIME_FORMAT.test(to.time)) {
    throw new Error('Data ou hora inválida no compromisso. Use AAAA-MM-DD e HH:MM.')
  }
  const lines = text.split('\n')
  const found = sectionsOf(lines)
    .filter((s) => s.day === from.day)
    .flatMap((s) => bodyOf(s).filter((i) => matches(lines[i]!, from)))
  if (found.length === 0) {
    throw new Error(
      `Não encontrei o compromisso “${from.title}” às ${from.time} em ${dayPt(from.day)} no agenda.md. Abra a proposta de novo.`,
    )
  }
  if (found.length > 1) {
    throw new Error(
      `Há mais de um compromisso “${from.title}” às ${from.time} em ${dayPt(from.day)} no agenda.md, e não sei qual deles mover. Diferencie-os no agenda.md.`,
    )
  }
  const at = found[0]!

  if (to.day === from.day) {
    if (to.time === from.time) throw new Error('O compromisso já está nessa data e hora.')
    lines[at] = retimed(lines[at]!, to.time)
    return lines.join('\n')
  }

  const moved = retimed(lines[at]!, to.time)
  lines.splice(at, 1)
  const target = sectionsOf(lines).find((s) => s.day === to.day)
  if (!target) throw new Error(`Não encontrei o dia ${dayPt(to.day)} no agenda.md. Crie o dia (## ${to.day}) e tente de novo.`)
  // After the day's last filled line; with none, right under its heading.
  let insertAt = target.heading + 1
  for (const i of bodyOf(target)) if (lines[i]!.trim() !== '') insertAt = i + 1
  lines.splice(insertAt, 0, moved)
  return lines.join('\n')
}

/**
 * The commitments of one day, in file order, for the review's Agenda step. Read only: it uses the same
 * line rules as the writer, so a task reference or a note is not a commitment and is not listed.
 */
export function commitmentsOn(text: string, day: string): { time: string; title: string }[] {
  const lines = text.split('\n')
  return sectionsOf(lines)
    .filter((s) => s.day === day)
    .flatMap((s) =>
      bodyOf(s).flatMap((i) => {
        const c = commitmentOf(lines[i]!)
        return c ? [{ time: c.time, title: c.title }] : []
      }),
    )
}

const stampOf = (d: Date): string => {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/** A copy of agenda.md in <vault>/backups/agenda/. Never overwrites an older copy. */
function backupAgenda(vault: string, text: string, at: Date): void {
  const dir = join(vault, 'backups', 'agenda')
  mkdirSync(dir, { recursive: true })
  const stamp = stampOf(at)
  let dest = join(dir, `agenda-${stamp}.md`)
  for (let n = 2; existsSync(dest); n++) dest = join(dir, `agenda-${stamp}-${n}.md`)
  writeFileAtomic(dest, text)
}

export interface AgendaWriterOptions {
  now?: () => Date
}

/**
 * One writer per app session, like the tasks writer. `read` is called when a review opens (the text it
 * returns is remembered); `current` refuses a write when agenda.md is missing, was never read, or changed since.
 */
export function createAgendaWriter(opts: AgendaWriterOptions = {}) {
  const lastRead = new Map<string, string>()
  const backedUp = new Set<string>()
  const now = opts.now ?? (() => new Date())
  const fileOf = (vault: string): string => join(vault, AGENDA_FILE)
  const readFile = (vault: string): string | null => {
    try {
      return readFileSync(fileOf(vault), 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    }
  }

  return {
    /** agenda.md as the review reads it, or null when the vault has none. */
    read(vault: string): string | null {
      const text = readFile(vault)
      if (text !== null) lastRead.set(vault, text)
      else lastRead.delete(vault)
      return text
    },
    /** The file as the review read it. Refused when it is missing, was not read, or has changed since. */
    current(vault: string): string {
      const text = readFile(vault)
      if (text === null) throw new Error(MISSING)
      const known = lastRead.get(vault)
      if (known === undefined) throw new Error(NOT_READ)
      if (text !== known) throw new Error(CHANGED)
      return text
    },
    /** Writes `after` in place of `before`, what `current` returned. Refused, with nothing written, when the file changed. */
    write(vault: string, before: string, after: string): void {
      if (readFile(vault) !== before) throw new Error(CHANGED)
      if (!backedUp.has(vault)) {
        backupAgenda(vault, before, now())
        backedUp.add(vault)
      }
      writeFileAtomic(fileOf(vault), after)
      lastRead.set(vault, after)
    },
  }
}

export type AgendaWriter = ReturnType<typeof createAgendaWriter>
