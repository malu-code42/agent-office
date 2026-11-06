import { describe, expect, it } from 'vitest'
import { barPause, barResume, barStart, barView, type BarTimerView } from '../src/shared/barTimer'
import {
  closeSpan,
  dayKeysBetween,
  dayKeyOf,
  focusByHour,
  focusByHourTask,
  heartbeatSpan,
  markDone,
  parseFocusLog,
  POMODORO_MS,
  recoverSpan,
  splitByDay,
  summarizeDay,
  summarizeRange,
  syncSpan,
  withRunning,
  type FocusSegment,
  type OpenSpan,
} from '../src/shared/focusLog'

const MIN = 60_000
const T0 = new Date(2026, 10, 5, 9, 0, 0).getTime()
const task = { id: 'tAAA111', text: 'Escrever relatório' }

/** A view of the running timer, as the main process reads it. */
const run = (mode: 25 | 5 | 15, at: number, t = task): BarTimerView => barView(barStart(mode, t, at), at)!

describe('syncSpan: acumulação do tempo em andamento', () => {
  it('um pomodoro completo de foco fecha um segmento de 25 minutos', () => {
    const a = syncSpan(undefined, run(25, T0), T0)
    expect(a.closed).toEqual([])
    expect(a.open).toMatchObject({ taskId: task.id, kind: 'foco', start: T0 })
    // Ao zerar, o usuário zera o Timer: o segmento fecha no prazo, não depois.
    const b = syncSpan(a.open, null, T0 + 27 * MIN)
    expect(b.open).toBeUndefined()
    expect(b.closed).toEqual([{ taskId: task.id, taskText: task.text, kind: 'foco', start: T0, end: T0 + 25 * MIN }])
  })

  it('pausa do usuário não conta: o tempo parado fica fora e a retomada abre outro segmento', () => {
    const started = barStart(25, task, T0)
    const a = syncSpan(undefined, barView(started, T0), T0)
    const paused = barPause(started, T0 + 10 * MIN)
    const b = syncSpan(a.open, barView(paused, T0 + 10 * MIN), T0 + 10 * MIN)
    expect(b.closed).toHaveLength(1)
    expect(b.closed[0]).toMatchObject({ start: T0, end: T0 + 10 * MIN, kind: 'foco' })
    expect(b.open).toBeUndefined()
    const resumed = barResume(paused, T0 + 40 * MIN)
    const c = syncSpan(b.open, barView(resumed, T0 + 40 * MIN), T0 + 40 * MIN)
    expect(c.open).toMatchObject({ start: T0 + 40 * MIN })
    const d = syncSpan(c.open, null, T0 + 55 * MIN)
    expect(d.closed[0]).toMatchObject({ start: T0 + 40 * MIN, end: T0 + 55 * MIN })
  })

  it('timer cancelado registra só o que rodou', () => {
    const a = syncSpan(undefined, run(25, T0), T0)
    const b = syncSpan(a.open, null, T0 + 7 * MIN)
    expect(b.closed).toEqual([{ taskId: task.id, taskText: task.text, kind: 'foco', start: T0, end: T0 + 7 * MIN }])
  })

  it('a pausa curta de 5 minutos vira segmento de tipo pausa', () => {
    const a = syncSpan(undefined, run(5, T0), T0)
    expect(a.open?.kind).toBe('pausa')
    const b = syncSpan(a.open, null, T0 + 5 * MIN)
    expect(b.closed[0]).toMatchObject({ kind: 'pausa', end: T0 + 5 * MIN })
  })

  it('troca de tarefa no meio fecha o segmento da primeira e abre o da segunda', () => {
    const a = syncSpan(undefined, run(25, T0), T0)
    const other = { id: 'tBBB222', text: 'Revisar slides' }
    const swapped = { ...run(25, T0, other), endsAt: T0 + 25 * MIN }
    const b = syncSpan(a.open, swapped, T0 + 10 * MIN)
    expect(b.closed).toEqual([{ taskId: task.id, taskText: task.text, kind: 'foco', start: T0, end: T0 + 10 * MIN }])
    expect(b.open).toMatchObject({ taskId: other.id, start: T0 + 10 * MIN, endsAt: T0 + 25 * MIN })
  })

  it('timer sem tarefa não gera registro', () => {
    const view: BarTimerView = barView(barStart(25, undefined, T0), T0)!
    expect(syncSpan(undefined, view, T0)).toEqual({ closed: [] })
  })

  it('o mesmo estado lido duas vezes não duplica nem fecha o segmento', () => {
    const v = run(25, T0)
    const a = syncSpan(undefined, v, T0)
    const b = syncSpan(a.open, v, T0 + MIN)
    expect(b.closed).toEqual([])
    expect(b.open).toEqual({ ...a.open, seen: T0 + MIN })
  })

  it('timer novo sobre o anterior sem leitura no meio fecha o anterior no prazo', () => {
    const a = syncSpan(undefined, run(25, T0), T0)
    const b = syncSpan(a.open, run(25, T0 + 30 * MIN), T0 + 30 * MIN)
    expect(b.closed[0]).toMatchObject({ start: T0, end: T0 + 25 * MIN })
    expect(b.open).toMatchObject({ start: T0 + 30 * MIN })
  })
})

describe('closeSpan e recoverSpan', () => {
  const open: OpenSpan = { taskId: 'tA', taskText: 'A', kind: 'foco', start: T0, seen: T0 + 4 * MIN, endsAt: T0 + 25 * MIN }

  it('nunca passa do prazo e ignora fim antes do início', () => {
    expect(closeSpan(open, T0 + 99 * MIN)?.end).toBe(T0 + 25 * MIN)
    expect(closeSpan(open, T0 - 5)).toBeUndefined()
    expect(closeSpan(open, T0)).toBeUndefined()
  })

  it('prazo vencido com o app fechado conta só até a última vez em que o app viu o timer', () => {
    const seg = recoverSpan(open)
    expect(seg).toMatchObject({ start: T0, end: T0 + 4 * MIN })
  })

  it('heartbeat avança o visto sem passar do prazo', () => {
    expect(heartbeatSpan(open, T0 + 10 * MIN).seen).toBe(T0 + 10 * MIN)
    expect(heartbeatSpan(open, T0 + 90 * MIN).seen).toBe(T0 + 25 * MIN)
  })
})

describe('splitByDay e virada de dia', () => {
  it('divide o segmento que atravessa a meia-noite em dois dias', () => {
    const start = new Date(2026, 10, 5, 23, 50).getTime()
    const end = new Date(2026, 10, 6, 0, 10).getTime()
    const parts = splitByDay({ taskId: 'tA', taskText: 'A', kind: 'foco', start, end })
    expect(parts.map((p) => [p.day, p.seg.end - p.seg.start])).toEqual([
      ['2026-11-05', 10 * MIN],
      ['2026-11-06', 10 * MIN],
    ])
  })

  it('dayKeyOf usa o dia local', () => {
    expect(dayKeyOf(new Date(2026, 0, 2, 23, 59).getTime())).toBe('2026-01-02')
  })
})

const seg = (id: string, text: string, startMin: number, durMin: number, kind: 'foco' | 'pausa' = 'foco', extra = {}): FocusSegment => ({
  taskId: id,
  taskText: text,
  kind,
  start: T0 + startMin * MIN,
  end: T0 + (startMin + durMin) * MIN,
  ...extra,
})

describe('summarizeDay', () => {
  it('vários pomodoros na mesma tarefa somam e contam blocos de 25 min de foco', () => {
    const segs = [seg('tA', 'A', 0, 25), seg('tA', 'A', 25, 5, 'pausa'), seg('tA', 'A', 30, 25), seg('tA', 'A', 55, 10)]
    const d = summarizeDay(segs)
    expect(d.focusMs).toBe(60 * MIN)
    expect(d.pauseMs).toBe(5 * MIN)
    expect(d.tasks).toHaveLength(1)
    expect(d.tasks[0]).toMatchObject({ taskId: 'tA', focusMs: 60 * MIN, pomodoros: 2, partialMs: 10 * MIN })
    expect(d.pomodoros).toBe(2)
  })

  it('separa por tarefa na ordem do primeiro registro e marca a concluída', () => {
    const segs = [seg('tB', 'B', 0, 25), seg('tA', 'A', 30, 25, 'foco', { done: true }), seg('tB', 'B', 60, 25)]
    const d = summarizeDay(segs)
    expect(d.tasks.map((t) => t.taskId)).toEqual(['tB', 'tA'])
    expect(d.tasks[0]).toMatchObject({ pomodoros: 2 })
    expect(d.tasks[1].done).toBe(true)
    expect(d.pomodoros).toBe(3)
  })

  it('segmento em andamento entra no total e aparece como em andamento', () => {
    const open: OpenSpan = { taskId: 'tA', taskText: 'A', kind: 'foco', start: T0, seen: T0, endsAt: T0 + 25 * MIN }
    const live = withRunning([], open, T0 + 12 * MIN)
    expect(live).toEqual([{ taskId: 'tA', taskText: 'A', kind: 'foco', start: T0, end: T0 + 12 * MIN, running: true }])
    const d = summarizeDay(live)
    expect(d.focusMs).toBe(12 * MIN)
    expect(d.tasks[0].running).toBe(true)
    expect(d.pomodoros).toBe(0)
  })

  it('segmento em andamento passado do prazo termina no prazo e não conta como em andamento', () => {
    const open: OpenSpan = { taskId: 'tA', taskText: 'A', kind: 'foco', start: T0, seen: T0, endsAt: T0 + 25 * MIN }
    expect(withRunning([], open, T0 + 40 * MIN)).toEqual([{ taskId: 'tA', taskText: 'A', kind: 'foco', start: T0, end: T0 + 25 * MIN }])
  })

  it('dia vazio devolve zeros', () => {
    expect(summarizeDay([])).toEqual({ focusMs: 0, pauseMs: 0, pomodoros: 0, tasks: [] })
  })

  it('o texto mais recente da tarefa é o que fica', () => {
    const d = summarizeDay([seg('tA', 'Velho', 0, 10), seg('tA', 'Novo', 20, 10)])
    expect(d.tasks[0].taskText).toBe('Novo')
  })
})

describe('focusByHour', () => {
  it('reparte o foco pelas horas e ignora pausa', () => {
    const segs = [seg('tA', 'A', 50, 25), seg('tA', 'A', 75, 5, 'pausa')]
    const h = focusByHour(segs)
    expect(h).toHaveLength(24)
    expect(h[9]).toBe(10 * MIN)
    expect(h[10]).toBe(15 * MIN)
    expect(h.reduce((a, b) => a + b, 0)).toBe(25 * MIN)
  })
})

describe('summarizeRange', () => {
  it('agrega a semana: dias sem dados vazios, ranking por tempo e tarefas concluídas', () => {
    const days = {
      '2026-11-04': [seg('tA', 'A', 0, 25), seg('tB', 'B', 30, 25, 'foco', { done: true })],
      '2026-11-05': [seg('tA', 'A', 0, 50, 'foco', { done: true })],
    }
    const s = summarizeRange(days, ['2026-11-03', '2026-11-04', '2026-11-05'])
    expect(s.days.map((d) => d.focusMs)).toEqual([0, 50 * MIN, 50 * MIN])
    expect(s.days[0].tasks).toEqual([])
    expect(s.focusMs).toBe(100 * MIN)
    expect(s.pomodoros).toBe(4)
    expect(s.ranking.map((r) => [r.taskId, r.focusMs])).toEqual([
      ['tA', 75 * MIN],
      ['tB', 25 * MIN],
    ])
    expect(s.doneTasks).toBe(2)
  })
})

describe('markDone', () => {
  it('marca o último segmento da tarefa e não toca nas outras', () => {
    const days = { '2026-11-05': [seg('tA', 'A', 0, 25), seg('tB', 'B', 30, 25), seg('tA', 'A', 60, 25)] }
    const next = markDone(days, 'tA')
    expect(next['2026-11-05'][2].done).toBe(true)
    expect(next['2026-11-05'][0].done).toBeUndefined()
    expect(next['2026-11-05'][1].done).toBeUndefined()
    expect(days['2026-11-05'][2].done).toBeUndefined()
  })

  it('tarefa sem registro deixa tudo como estava', () => {
    const days = { '2026-11-05': [seg('tB', 'B', 0, 25)] }
    expect(markDone(days, 'tZ')).toEqual(days)
  })
})

describe('parseFocusLog: entrada inválida', () => {
  it('descarta o que não presta e guarda o que presta', () => {
    const good = seg('tA', 'A', 0, 25)
    const log = parseFocusLog({
      days: {
        '2026-11-05': [good, { taskId: 3 }, null, { ...good, end: good.start - 1 }, { ...good, kind: 'x' }],
        lixo: [good],
      },
      open: { taskId: 'tA' },
    })
    expect(log.days).toEqual({ '2026-11-05': [good] })
    expect(log.open).toBeUndefined()
  })

  it('arquivo que não é objeto vira log vazio', () => {
    expect(parseFocusLog(42)).toEqual({ days: {} })
    expect(parseFocusLog(undefined)).toEqual({ days: {} })
  })

  it('mantém um segmento aberto válido', () => {
    const open: OpenSpan = { taskId: 'tA', taskText: 'A', kind: 'foco', start: T0, seen: T0 + MIN, endsAt: T0 + 25 * MIN }
    expect(parseFocusLog({ days: {}, open }).open).toEqual(open)
  })

  it('o pomodoro vale 25 minutos', () => {
    expect(POMODORO_MS).toBe(25 * MIN)
  })
})

describe('dayKeysBetween', () => {
  it('lista os dias inclusive, atravessando o mês', () => {
    expect(dayKeysBetween('2026-10-30', '2026-11-02')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02'])
  })
  it('entrada inválida, invertida ou longa demais', () => {
    expect(dayKeysBetween('x', '2026-11-02')).toEqual([])
    expect(dayKeysBetween('2026-11-03', '2026-11-02')).toEqual([])
    expect(dayKeysBetween('2026-01-01', '2026-12-31')).toHaveLength(62)
  })
})

describe('focusByHourTask', () => {
  it('reparte por hora e por tarefa, só com foco, em ordem de hora', () => {
    const segs = [seg('tA', 'A', 50, 25), seg('tB', 'B', 75, 20), seg('tB', 'B', 95, 5, 'pausa')]
    const rows = focusByHourTask(segs)
    expect(rows.map((r) => r.hour)).toEqual([9, 10])
    expect(rows[0]).toMatchObject({ totalMs: 10 * MIN, parts: [{ taskId: 'tA', ms: 10 * MIN }] })
    expect(rows[1].totalMs).toBe(35 * MIN)
    expect(rows[1].parts).toEqual([
      { taskId: 'tA', ms: 15 * MIN },
      { taskId: 'tB', ms: 20 * MIN },
    ])
  })
})
