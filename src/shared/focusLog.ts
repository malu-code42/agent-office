/**
 * O registro de foco por tarefa (AO-92): quanto tempo cada tarefa teve de Timer da barra em andamento.
 * Aritmética pura, sem I/O: o arquivo vive num store do processo principal (focus-log.json).
 *
 * Regras: só o tempo "em andamento" conta; pausa do usuário não conta (o segmento fecha ao pausar e a
 * retomada abre outro); timer zerado registra só o que rodou; um prazo vencido com o app fechado conta
 * só até a última vez em que o app viu o timer (`seen`), nunca até o prazo. Timer sem tarefa não registra.
 * Um pomodoro é um bloco de 25 min de foco.
 */
import type { BarTimerView } from './barTimer'

export const POMODORO_MS = 25 * 60_000

export type FocusKind = 'foco' | 'pausa'

/** Um trecho contínuo de Timer em andamento numa tarefa. */
export interface FocusSegment {
  taskId: string
  taskText: string
  kind: FocusKind
  start: number
  end: number
  /** A tarefa foi concluída depois deste segmento (o último dela). */
  done?: true
  /** Só nas leituras: o segmento ainda está correndo (não vai para o arquivo). */
  running?: true
}

/** O trecho que está correndo agora; vai para o arquivo para sobreviver a um fechamento do app. */
export interface OpenSpan {
  taskId: string
  taskText: string
  kind: FocusKind
  start: number
  /** Última vez em que o app confirmou que o timer corria. */
  seen: number
  /** Prazo absoluto do intervalo: serve para reconhecer o mesmo trecho e para limitar o fim. */
  endsAt: number
}

export interface FocusLog {
  days: Record<string, FocusSegment[]>
  open?: OpenSpan
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** AAAA-MM-DD no fuso local. */
export function dayKeyOf(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const kindOf = (mode: number): FocusKind => (mode === 25 ? 'foco' : 'pausa')

function openFrom(view: BarTimerView | null | undefined, now: number): OpenSpan | undefined {
  if (!view || view.state !== 'em andamento' || view.endsAt === undefined) return undefined
  if (view.taskId === undefined || view.taskText === undefined) return undefined
  return { taskId: view.taskId, taskText: view.taskText, kind: kindOf(view.mode), start: now, seen: now, endsAt: view.endsAt }
}

const sameSpan = (a: OpenSpan, b: OpenSpan): boolean => a.taskId === b.taskId && a.kind === b.kind && a.endsAt === b.endsAt

/** Fecha o trecho em `at`, nunca depois do prazo; trecho de duração zero não vira registro. */
export function closeSpan(open: OpenSpan, at: number): FocusSegment | undefined {
  const end = Math.min(at, open.endsAt)
  if (!(end > open.start)) return undefined
  return { taskId: open.taskId, taskText: open.taskText, kind: open.kind, start: open.start, end }
}

/**
 * Concilia o trecho aberto com o que o Timer mostra agora: o mesmo trecho segue, qualquer outra coisa
 * (pausa, zerar, outra tarefa, outro intervalo) fecha o antigo e, se houver timer correndo, abre um novo.
 */
export function syncSpan(
  open: OpenSpan | undefined,
  view: BarTimerView | null | undefined,
  now: number,
): { open?: OpenSpan; closed: FocusSegment[] } {
  const next = openFrom(view, now)
  if (open && next && sameSpan(open, next)) return { open: heartbeatSpan(open, now), closed: [] }
  const closed: FocusSegment[] = []
  if (open) {
    const seg = closeSpan(open, now)
    if (seg) closed.push(seg)
  }
  return next ? { open: next, closed } : { closed }
}

/** Marca que o app viu o timer correndo agora (sem passar do prazo). */
export function heartbeatSpan(open: OpenSpan, now: number): OpenSpan {
  return { ...open, seen: Math.max(open.seen, Math.min(now, open.endsAt)) }
}

/** O app abriu e encontrou um trecho aberto: só vale até a última vez em que ele foi visto correndo. */
export function recoverSpan(open: OpenSpan): FocusSegment | undefined {
  return closeSpan(open, open.seen)
}

/** Divide um segmento pelos dias locais que ele atravessa. */
export function splitByDay(s: FocusSegment): { day: string; seg: FocusSegment }[] {
  const out: { day: string; seg: FocusSegment }[] = []
  let from = s.start
  while (from < s.end) {
    const d = new Date(from)
    const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()
    const to = Math.min(s.end, midnight)
    out.push({ day: dayKeyOf(from), seg: { ...s, start: from, end: to } })
    from = to
  }
  return out
}

/** Acrescenta segmentos fechados aos dias (sem alterar o original). */
export function addSegments(days: Record<string, FocusSegment[]>, closed: FocusSegment[]): Record<string, FocusSegment[]> {
  const next = { ...days }
  for (const s of closed) {
    for (const { day, seg } of splitByDay(s)) next[day] = [...(next[day] ?? []), seg]
  }
  return next
}

/** A tarefa foi concluída: o último segmento dela leva a marca. Sem registro, nada muda. */
export function markDone(days: Record<string, FocusSegment[]>, taskId: string): Record<string, FocusSegment[]> {
  let where: { day: string; index: number } | undefined
  let latest = -Infinity
  for (const [day, segs] of Object.entries(days)) {
    segs.forEach((s, index) => {
      if (s.taskId === taskId && s.end >= latest) {
        latest = s.end
        where = { day, index }
      }
    })
  }
  if (!where) return days
  const { day, index } = where
  return { ...days, [day]: days[day].map((s, i) => (i === index ? { ...s, done: true as const } : s)) }
}

/** Os registros do dia mais o trecho que corre agora, terminado em `now` (ou no prazo, se já passou). */
export function withRunning(segs: FocusSegment[], open: OpenSpan | undefined, now: number): FocusSegment[] {
  if (!open) return segs
  const live = closeSpan(open, now)
  if (!live) return segs
  return [...segs, now < open.endsAt ? { ...live, running: true as const } : live]
}

export interface TaskTotal {
  taskId: string
  taskText: string
  focusMs: number
  pauseMs: number
  /** Blocos inteiros de 25 min de foco. */
  pomodoros: number
  /** O que sobra do último bloco de 25 min. */
  partialMs: number
  done: boolean
  running: boolean
}

export interface DaySummary {
  focusMs: number
  pauseMs: number
  pomodoros: number
  /** Na ordem do primeiro registro de cada tarefa. */
  tasks: TaskTotal[]
}

export function summarizeDay(segs: FocusSegment[]): DaySummary {
  const byTask = new Map<string, TaskTotal>()
  const ordered = [...segs].sort((a, b) => a.start - b.start)
  for (const s of ordered) {
    let t = byTask.get(s.taskId)
    if (!t) {
      t = { taskId: s.taskId, taskText: s.taskText, focusMs: 0, pauseMs: 0, pomodoros: 0, partialMs: 0, done: false, running: false }
      byTask.set(s.taskId, t)
    }
    t.taskText = s.taskText
    if (s.kind === 'foco') t.focusMs += s.end - s.start
    else t.pauseMs += s.end - s.start
    if (s.done) t.done = true
    if (s.running) t.running = true
  }
  const tasks = [...byTask.values()]
  for (const t of tasks) {
    t.pomodoros = Math.floor(t.focusMs / POMODORO_MS)
    t.partialMs = t.focusMs - t.pomodoros * POMODORO_MS
  }
  return {
    focusMs: tasks.reduce((a, t) => a + t.focusMs, 0),
    pauseMs: tasks.reduce((a, t) => a + t.pauseMs, 0),
    pomodoros: tasks.reduce((a, t) => a + t.pomodoros, 0),
    tasks,
  }
}

/** Foco (ms) em cada hora do dia, 0 a 23; pausa não entra. */
export function focusByHour(segs: FocusSegment[]): number[] {
  const hours = new Array<number>(24).fill(0)
  for (const s of segs) {
    if (s.kind !== 'foco') continue
    let from = s.start
    while (from < s.end) {
      const d = new Date(from)
      const nextHour = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1).getTime()
      const to = Math.min(s.end, nextHour)
      hours[d.getHours()] += to - from
      from = to
    }
  }
  return hours
}

export interface RangeSummary {
  days: (DaySummary & { date: string })[]
  focusMs: number
  pomodoros: number
  /** Tarefas distintas que terminaram dentro do período. */
  doneTasks: number
  /** Tempo de foco por tarefa no período, do maior para o menor. */
  ranking: { taskId: string; taskText: string; focusMs: number; done: boolean }[]
}

/** Agrega vários dias (na ordem de `keys`); dia sem registro fica vazio. */
export function summarizeRange(days: Record<string, FocusSegment[]>, keys: string[]): RangeSummary {
  const perDay = keys.map((date) => ({ date, ...summarizeDay(days[date] ?? []) }))
  const rank = new Map<string, { taskId: string; taskText: string; focusMs: number; done: boolean }>()
  for (const d of perDay) {
    for (const t of d.tasks) {
      const r = rank.get(t.taskId) ?? { taskId: t.taskId, taskText: t.taskText, focusMs: 0, done: false }
      r.taskText = t.taskText
      r.focusMs += t.focusMs
      r.done = r.done || t.done
      rank.set(t.taskId, r)
    }
  }
  const ranking = [...rank.values()].filter((r) => r.focusMs > 0).sort((a, b) => b.focusMs - a.focusMs)
  return {
    days: perDay,
    focusMs: perDay.reduce((a, d) => a + d.focusMs, 0),
    pomodoros: perDay.reduce((a, d) => a + d.pomodoros, 0),
    doneTasks: [...rank.values()].filter((r) => r.done).length,
    ranking,
  }
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

function parseSegment(v: unknown): FocusSegment | undefined {
  if (!v || typeof v !== 'object') return undefined
  const s = v as Record<string, unknown>
  if (typeof s.taskId !== 'string' || typeof s.taskText !== 'string') return undefined
  if (s.kind !== 'foco' && s.kind !== 'pausa') return undefined
  if (!isNum(s.start) || !isNum(s.end) || s.end <= s.start) return undefined
  return {
    taskId: s.taskId,
    taskText: s.taskText,
    kind: s.kind,
    start: s.start,
    end: s.end,
    ...(s.done === true ? { done: true as const } : {}),
  }
}

function parseOpen(v: unknown): OpenSpan | undefined {
  if (!v || typeof v !== 'object') return undefined
  const s = v as Record<string, unknown>
  if (typeof s.taskId !== 'string' || typeof s.taskText !== 'string') return undefined
  if (s.kind !== 'foco' && s.kind !== 'pausa') return undefined
  if (!isNum(s.start) || !isNum(s.seen) || !isNum(s.endsAt)) return undefined
  return { taskId: s.taskId, taskText: s.taskText, kind: s.kind, start: s.start, seen: s.seen, endsAt: s.endsAt }
}

/** Lê o arquivo de dados: o que não se pode usar é descartado, nunca adivinhado. */
export function parseFocusLog(v: unknown): FocusLog {
  if (!v || typeof v !== 'object') return { days: {} }
  const raw = v as { days?: unknown; open?: unknown }
  const days: Record<string, FocusSegment[]> = {}
  if (raw.days && typeof raw.days === 'object' && !Array.isArray(raw.days)) {
    for (const [day, list] of Object.entries(raw.days as Record<string, unknown>)) {
      if (!DAY_RE.test(day) || !Array.isArray(list)) continue
      const segs = list.map(parseSegment).filter((s): s is FocusSegment => !!s)
      if (segs.length) days[day] = segs
    }
  }
  const open = parseOpen(raw.open)
  return { days, ...(open ? { open } : {}) }
}

/** O que a interface lê: os segmentos dos dias pedidos, já com o trecho que corre agora. */
export interface FocusRangeView {
  days: Record<string, FocusSegment[]>
  now: number
}

/** Os dias de `from` a `to` (AAAA-MM-DD, inclusive). Entrada inválida ou invertida dá lista vazia; no máximo `max` dias. */
export function dayKeysBetween(from: string, to: string, max = 62): string[] {
  if (!DAY_RE.test(from) || !DAY_RE.test(to) || from > to) return []
  const [y, m, d] = from.split('-').map(Number)
  const keys: string[] = []
  for (let i = 0; i < max; i++) {
    const key = dayKeyOf(new Date(y, m - 1, d + i).getTime())
    if (key > to) break
    keys.push(key)
  }
  return keys
}

/** Foco de cada hora do dia por tarefa (só as horas com foco), da mais cedo para a mais tarde. */
export function focusByHourTask(segs: FocusSegment[]): { hour: number; totalMs: number; parts: { taskId: string; ms: number }[] }[] {
  const grid = new Map<number, Map<string, number>>()
  for (const s of segs) {
    if (s.kind !== 'foco') continue
    let from = s.start
    while (from < s.end) {
      const d = new Date(from)
      const nextHour = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1).getTime()
      const to = Math.min(s.end, nextHour)
      const row = grid.get(d.getHours()) ?? new Map<string, number>()
      row.set(s.taskId, (row.get(s.taskId) ?? 0) + (to - from))
      grid.set(d.getHours(), row)
      from = to
    }
  }
  return [...grid.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([hour, row]) => {
      const parts = [...row.entries()].map(([taskId, ms]) => ({ taskId, ms }))
      return { hour, totalMs: parts.reduce((a, p) => a + p.ms, 0), parts }
    })
}
