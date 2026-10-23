import { addDays } from './review'
import type { CommitmentRef, Proposal, ProposalOperation } from './proposals'
import { type ProfileId, type UserProfile } from './profiles'
import { ARCHIVE_LIST, type Task, type TaskList } from './tasks'

/**
 * Luna (AO-13): a request in words becomes a proposal, and only a confirmed proposal changes a file. This
 * file is the model and the text, with no file access (src/main/iris.ts reads the files and sends the text).
 * The context sent to the AI is built here and nowhere else: the request, the commitments of the next seven
 * days and only the tasks the request cites or matches. The Archive, the focus timer, the steps of earlier days,
 * the vault's notes and the rest of agenda.md are not in it, so they cannot leave the computer.
 */

/** The source a proposal of the Luna carries: the caixa de entrada shows it as the chip's name. */
export const IRIS_SOURCE = 'Luna'
export const IRIS_NOT_UNDERSTOOD = 'A Luna não entendeu o pedido.'
export const IRIS_REQUEST_MAX = 2000
/** The commitments the context keeps: from today, for this many days. */
export const IRIS_WEEK_DAYS = 7
const MAX_TASKS = 30

/** What the AI answers: operations to propose, or one question for the user (then no operation is proposed). */
export interface IrisAnswer {
  operations: ProposalOperation[]
  question?: string | null | undefined
  /** At most one built-in profile for a clear new task; the renderer starts a fresh task in that scope. */
  profile?: ProfileId | null | undefined
}

/** Sending gives an organization proposal, a task profile to launch, or a question to answer in the same box. */
export type IrisResult =
  | { kind: 'task'; profile: ProfileId }
  | { kind: 'proposal'; proposal: Proposal; profile?: ProfileId | null | undefined }
  | { kind: 'question'; text: string }

/** The exact text the Luna will receive, with the token that sends that same text. */
export interface IrisPreview {
  token: string
  context: string
}

/** What the context is built from: the request, every commitment of agenda.md, the lists of tarefas.md and the profile list. */
export interface IrisContextInput {
  request: string
  /** Today as AAAA-MM-DD. */
  today: string
  commitments: CommitmentRef[]
  lists: TaskList[]
  /** The reusable profiles, as they are: only id, name and scope go to the context. */
  profiles: readonly UserProfile[]
}

const STOP_WORDS = new Set([
  'para',
  'com',
  'uma',
  'uns',
  'umas',
  'amanha',
  'hoje',
  'semana',
  'depois',
  'antes',
  'essa',
  'esse',
  'isso',
  'tarefa',
  'reserve',
  'marque',
  'marcar',
  'mova',
  'mover',
  'mude',
  'mudar',
  'remova',
  'remover',
  'coloque',
  'agende',
  'agendar',
  'reagende',
  'reagendar',
  'foco',
  'passo',
  'descarte',
  'descartar',
  'quero',
  'favor',
  'horas',
  'hora',
  'dia',
  'sobre',
  'entre',
])

const normalize = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

const STATUS_WORD = { open: 'aberta', completed: 'concluída', discarded: 'descartada' } as const

/** The day and month of a task, as DD.MM, from its date field or its due date. */
function dayMonthOf(task: Task): string | undefined {
  if (task.date) return task.date.slice(0, 5)
  if (task.dueDate) return `${task.dueDate.slice(8, 10)}.${task.dueDate.slice(5, 7)}`
  return undefined
}

/**
 * The tasks a request cites: by id, by date (DD.MM) or time (HH:MM, or 15h), or by a word of the title or
 * the list. The Archive is never one of them. In the order of tarefas.md, at most MAX_TASKS.
 */
export function matchingTasks(request: string, lists: readonly TaskList[]): { list: string; task: Task }[] {
  const text = normalize(request)
  const ids = new Set([...text.matchAll(/\bt[a-z0-9]{6}\b/g)].map((m) => m[0]))
  const dates = new Set([...text.matchAll(/\b(\d{2})[./](\d{2})\b/g)].map((m) => `${m[1]}.${m[2]}`))
  const times = new Set([...text.matchAll(/\b(\d{1,2})(?::|h)(\d{2})?\b/g)].map((m) => `${m[1]!.padStart(2, '0')}:${m[2] ?? '00'}`))
  const words = [...new Set(text.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4 && !STOP_WORDS.has(w)))]
  const out: { list: string; task: Task }[] = []
  for (const list of lists) {
    if (list.name === ARCHIVE_LIST) continue
    const listName = normalize(list.name)
    for (const task of list.tasks) {
      const title = normalize(task.text)
      const hit =
        (!!task.id && ids.has(task.id.toLowerCase())) ||
        (!!task.time && times.has(task.time)) ||
        (!!dayMonthOf(task) && dates.has(dayMonthOf(task)!)) ||
        words.some((w) => title.includes(w) || listName.includes(w))
      if (hit) out.push({ list: list.name, task })
      if (out.length === MAX_TASKS) return out
    }
  }
  return out
}

/**
 * The text sent to the Luna, line by line so the user can read every line of it before it leaves. Only
 * the request, the commitments of the next seven days, the matching tasks and the fixed profile list are in it.
 */
export function irisContext(input: IrisContextInput): string {
  const days = Array.from({ length: IRIS_WEEK_DAYS }, (_, i) => addDays(input.today, i))
  const commitments = input.commitments
    .filter((c) => days.includes(c.day))
    .sort((a, b) => a.day.localeCompare(b.day) || a.time.localeCompare(b.time))
  const tasks = matchingTasks(input.request, input.lists)
  const lines = [
    'Pedido:',
    input.request.trim(),
    '',
    `Hoje: ${input.today}`,
    `Compromissos de ${days[0]} a ${days[days.length - 1]} (agenda.md):`,
    ...(commitments.length ? commitments.map((c) => `- ${c.day} ${c.time} ${c.title}`) : ['(nenhum)']),
    '',
    'Tarefas citadas ou parecidas com o pedido (tarefas.md):',
    ...(tasks.length
      ? tasks.map(({ list, task }) => {
          const when = [task.date ?? task.dueDate, task.time].filter(Boolean).join(' ') || '-'
          const id = task.id ? `^${task.id}` : 'sem id'
          return `- ${id} | ${list} | ${when} | ${STATUS_WORD[task.status]} | ${task.text}`
        })
      : ['(nenhuma)']),
    '',
    'Perfis aprovados disponíveis para iniciar tarefas novas:',
    ...input.profiles.map((p) => `- ${p.id} | ${p.name} | ${p.scope}`),
  ]
  return lines.join('\n')
}
