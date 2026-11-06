/**
 * Contas da agenda com tempo registrado (AO-92), sem DOM: cor estável de cada tarefa, blocos de tarefa feita
 * para a grade do dia, eixo comum do 7 dias e resumos do painel e da semana. Os dados vêm do registro de foco
 * (shared/focusLog.ts); aqui só se prepara o que a tela desenha.
 */
import type { AgendaDay, AgendaView } from '@shared/agenda'
import { POMODORO_MS, type FocusSegment, type RangeSummary, type TaskTotal } from '@shared/focusLog'
import { EMPTY_RANGE, type DayEventInput, type DayLayout } from './agenda-day-layout'

/** Quantas cores a paleta das tarefas tem (verde, rosa, âmbar e verde-água); o laranja é só da tarefa em andamento. */
export const TASK_PALETTE_SIZE = 4

/** Índice da cor de uma tarefa, derivado só do id: a mesma tarefa tem a mesma cor em todas as abas e em todos os dias. */
export function taskColorIndex(id: string): number {
  // FNV-1a: ids parecidos (t + 6 caracteres) caem em cores diferentes com mais frequência que a soma ponderada.
  let hash = 0x811c9dc5
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 0x01000193) >>> 0
  return (hash >>> 8) % TASK_PALETTE_SIZE
}

/** Classe CSS da cor da tarefa: laranja enquanto está em andamento, a da paleta nas demais horas. */
export const taskColorClass = (id: string, running: boolean): string => (running ? 'tl-tk-run' : `tl-tk-${taskColorIndex(id)}`)

/** "3h07", "1h15", "25 min": tempo de foco em palavras curtas. */
export function formatFocus(ms: number): string {
  const total = Math.max(0, Math.round(ms / 60_000))
  if (total < 60) return `${total} min`
  return `${Math.floor(total / 60)}h${String(total % 60).padStart(2, '0')}`
}

export type StripPart = { kind: 'foco' | 'pausa' | 'vazio'; ms: number }

/** Uma passada de trabalho numa tarefa: o que a grade do dia desenha como um cartão com a faixa de pomodoros. */
export type TaskBlock = {
  taskId: string
  taskText: string
  start: number
  end: number
  /** Faixa lateral: foco forte, pausa clara, vazio quando o usuário parou um pouco. */
  parts: StripPart[]
  focusMs: number
  pomodoros: number
  running: boolean
  done: boolean
}

/** Folga máxima entre dois trechos da mesma tarefa para continuarem no mesmo bloco. */
const BLOCK_GAP_MS = 20 * 60_000

export function taskBlocks(segs: FocusSegment[], gapMs = BLOCK_GAP_MS): TaskBlock[] {
  const byTask = new Map<string, FocusSegment[]>()
  for (const s of [...segs].sort((a, b) => a.start - b.start)) byTask.set(s.taskId, [...(byTask.get(s.taskId) ?? []), s])
  const blocks: TaskBlock[] = []
  for (const list of byTask.values()) {
    let current: TaskBlock | undefined
    for (const s of list) {
      if (!current || s.start - current.end > gapMs) {
        current = {
          taskId: s.taskId,
          taskText: s.taskText,
          start: s.start,
          end: s.start,
          parts: [],
          focusMs: 0,
          pomodoros: 0,
          running: false,
          done: false,
        }
        blocks.push(current)
      }
      if (s.start > current.end) current.parts.push({ kind: 'vazio', ms: s.start - current.end })
      current.parts.push({ kind: s.kind, ms: s.end - s.start })
      current.end = s.end
      current.taskText = s.taskText
      if (s.kind === 'foco') current.focusMs += s.end - s.start
      if (s.running) current.running = true
      if (s.done) current.done = true
    }
  }
  for (const b of blocks) b.pomodoros = Math.floor(b.focusMs / POMODORO_MS)
  return blocks.sort((a, b) => a.start - b.start)
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** "HH:MM" do instante no fuso local; a meia-noite que fecha o dia vale 24:00, como o eixo da grade espera. */
export function hmOf(ms: number, dayStart: number): string {
  const d = new Date(ms)
  const sameDay = new Date(dayStart).toDateString() === d.toDateString()
  return sameDay ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : '24:00'
}

/** Altura mínima de um bloco de tarefa na grade: cabe o título e o tempo, mas não força 40 min como um compromisso. */
export const TASK_BLOCK_MIN_MINUTES = 20

/** As entradas da grade do dia: os eventos já existentes (na ordem recebida) e, depois, os blocos de tarefa. */
export function dayInputs(events: DayEventInput[], blocks: TaskBlock[]): DayEventInput[] {
  return [
    ...events,
    ...blocks.map((b) => ({
      at: hmOf(b.start, b.start),
      end: hmOf(b.end, b.start),
      minMinutes: TASK_BLOCK_MIN_MINUTES,
    })),
  ]
}

/** Eixo comum às colunas do 7 dias: junta o eixo dos dias com evento; sem nenhum, o eixo padrão. */
export function sharedRange(layouts: Pick<DayLayout, 'events' | 'range'>[]): { from: number; to: number } {
  const used = layouts.filter((l) => l.events.length > 0)
  if (!used.length) return { ...EMPTY_RANGE }
  return { from: Math.min(...used.map((l) => l.range.from)), to: Math.max(...used.map((l) => l.range.to)) }
}

/** Soma `n` dias a uma data AAAA-MM-DD, sem fuso. */
export function addDaysIso(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(y, m - 1, d + n)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Segunda a domingo da semana que contém `iso`. */
export function weekDates(iso: string): string[] {
  const [y, m, d] = iso.split('-').map(Number)
  const monday = addDaysIso(iso, -((new Date(y, m - 1, d).getDay() + 6) % 7))
  return Array.from({ length: 7 }, (_, i) => addDaysIso(monday, i))
}

/** Os dias pedidos, tirados das semanas lidas; dia que nenhuma leitura trouxe fica vazio. */
export function collectDays(views: Pick<AgendaView, 'week' | 'today'>[], dates: string[]): AgendaDay[] {
  const known = new Map<string, AgendaDay>()
  for (const v of views) for (const day of [...v.week, v.today]) if (!known.has(day.date)) known.set(day.date, day)
  return dates.map((date) => known.get(date) ?? { date, entries: [] })
}

/** Percentual de cada tarefa no foco, inteiro e somando 100 (o resto vai para as maiores frações). */
export function focusShares(tasks: { taskId: string; focusMs: number }[]): { taskId: string; pct: number }[] {
  const total = tasks.reduce((a, t) => a + t.focusMs, 0)
  if (total <= 0) return tasks.map((t) => ({ taskId: t.taskId, pct: 0 }))
  const raw = tasks.map((t) => (t.focusMs / total) * 100)
  const pct = raw.map(Math.floor)
  let left = 100 - pct.reduce((a, b) => a + b, 0)
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac || a.i - b.i)
  for (const { i } of order) {
    if (left <= 0) break
    pct[i]!++
    left--
  }
  return tasks.map((t, i) => ({ taskId: t.taskId, pct: pct[i]! }))
}

/** Foco médio por dia, contando só os dias em que houve foco. */
export function weekAverage(s: Pick<RangeSummary, 'days'>): number {
  const worked = s.days.filter((d) => d.focusMs > 0)
  return worked.length ? Math.round(worked.reduce((a, d) => a + d.focusMs, 0) / worked.length) : 0
}

export const longestTask = (tasks: TaskTotal[]): TaskTotal | undefined =>
  tasks.reduce<TaskTotal | undefined>((best, t) => (!best || t.focusMs > best.focusMs ? t : best), undefined)

/** Colunas do "foco por hora": do primeiro ao último com foco, com ao menos 4 horas (cabe no dia). */
export function hourWindow(hours: { hour: number }[], minCols = 4): { from: number; to: number } | undefined {
  if (!hours.length) return undefined
  let from = Math.min(...hours.map((h) => h.hour))
  let to = Math.max(...hours.map((h) => h.hour))
  if (to - from + 1 < minCols) {
    to = Math.min(23, from + minCols - 1)
    from = Math.max(0, to - minCols + 1)
  }
  return { from, to }
}
