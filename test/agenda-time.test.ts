import { describe, expect, it } from 'vitest'
import type { AgendaDay, AgendaView } from '../src/shared/agenda'
import { summarizeRange, type FocusSegment } from '../src/shared/focusLog'
import { layoutDayEvents } from '../src/renderer/src/ui/agenda-day-layout'
import {
  TASK_PALETTE_SIZE,
  collectDays,
  dayInputs,
  focusShares,
  formatFocus,
  hourWindow,
  longestTask,
  sharedRange,
  taskBlocks,
  taskColorClass,
  taskColorIndex,
  weekAverage,
  weekDates,
} from '../src/renderer/src/ui/agenda-time'

const MIN = 60_000
const T0 = new Date(2026, 10, 6, 14, 0, 0).getTime()
const seg = (id: string, startMin: number, durMin: number, kind: 'foco' | 'pausa' = 'foco', extra = {}): FocusSegment => ({
  taskId: id,
  taskText: `Tarefa ${id}`,
  kind,
  start: T0 + startMin * MIN,
  end: T0 + (startMin + durMin) * MIN,
  ...extra,
})

describe('cor da tarefa', () => {
  it('é estável para o mesmo id e sempre cai dentro da paleta', () => {
    for (const id of ['tabc123', 'tzzz999', 'tA1b2c3', 'x']) {
      expect(taskColorIndex(id)).toBe(taskColorIndex(id))
      expect(taskColorIndex(id)).toBeGreaterThanOrEqual(0)
      expect(taskColorIndex(id)).toBeLessThan(TASK_PALETTE_SIZE)
    }
  })

  it('usa todas as cores da paleta para ids diferentes', () => {
    const ids = Array.from({ length: 40 }, (_, i) => `t${i.toString(36).padStart(6, 'a')}`)
    expect(new Set(ids.map(taskColorIndex)).size).toBe(TASK_PALETTE_SIZE)
  })

  it('a tarefa em andamento fica laranja; as outras usam a cor do id', () => {
    expect(taskColorClass('tabc123', true)).toBe('tl-tk-run')
    expect(taskColorClass('tabc123', false)).toBe(`tl-tk-${taskColorIndex('tabc123')}`)
  })
})

describe('formatFocus', () => {
  it('minutos abaixo de uma hora, horas com minutos de dois dígitos', () => {
    expect(formatFocus(0)).toBe('0 min')
    expect(formatFocus(12 * MIN)).toBe('12 min')
    expect(formatFocus(25 * MIN)).toBe('25 min')
    expect(formatFocus(75 * MIN)).toBe('1h15')
    expect(formatFocus(187 * MIN)).toBe('3h07')
    expect(formatFocus(60 * MIN)).toBe('1h00')
  })
})

describe('taskBlocks', () => {
  it('junta pomodoros seguidos da mesma tarefa num bloco com a faixa foco/pausa', () => {
    const blocks = taskBlocks([seg('A', 0, 25), seg('A', 25, 5, 'pausa'), seg('A', 30, 25), seg('B', 60, 25)])
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toMatchObject({ taskId: 'A', focusMs: 50 * MIN, pomodoros: 2, start: T0, end: T0 + 55 * MIN })
    expect(blocks[0].parts.map((p) => p.kind)).toEqual(['foco', 'pausa', 'foco'])
    expect(blocks[1].taskId).toBe('B')
  })

  it('uma pausa longa do usuário separa a tarefa em dois blocos', () => {
    const blocks = taskBlocks([seg('A', 0, 25), seg('A', 180, 25)])
    expect(blocks.map((b) => b.start)).toEqual([T0, T0 + 180 * MIN])
  })

  it('uma folga curta dentro do bloco vira trecho vazio na faixa', () => {
    const [b] = taskBlocks([seg('A', 0, 25), seg('A', 35, 10)])
    expect(b.parts.map((p) => p.kind)).toEqual(['foco', 'vazio', 'foco'])
    expect(b.parts[1].ms).toBe(10 * MIN)
  })

  it('marca em andamento e concluída', () => {
    const [run] = taskBlocks([seg('A', 0, 12, 'foco', { running: true })])
    expect(run.running).toBe(true)
    expect(run.pomodoros).toBe(0)
    const [done] = taskBlocks([seg('A', 0, 25, 'foco', { done: true })])
    expect(done.done).toBe(true)
  })

  it('sem segmentos, sem blocos', () => {
    expect(taskBlocks([])).toEqual([])
  })
})

describe('dayInputs: aulas, compromissos e tarefas na mesma grade', () => {
  it('um bloco de tarefa que se sobrepõe a um compromisso divide a largura com ele', () => {
    const blocks = taskBlocks([seg('A', 180, 50)]) // 17:00 a 17:50
    const inputs = dayInputs([{ at: '17:00', end: '18:00' }], blocks)
    expect(inputs).toHaveLength(2)
    const { events } = layoutDayEvents(inputs)
    expect(events[0].columns).toBe(2)
    expect(events[1].columns).toBe(2)
    expect(events[0].column).not.toBe(events[1].column)
  })

  it('pomodoros de 25 min em seguida, de tarefas diferentes, não se sobrepõem', () => {
    const blocks = taskBlocks([seg('A', 0, 25), seg('B', 25, 25)])
    const { events } = layoutDayEvents(dayInputs([], blocks))
    expect(events.map((e) => e.columns)).toEqual([1, 1])
  })

  it('bloco que termina à meia-noite vai até 24:00', () => {
    const late = new Date(2026, 10, 6, 23, 30).getTime()
    const blocks = taskBlocks([{ taskId: 'A', taskText: 'A', kind: 'foco', start: late, end: late + 30 * MIN }])
    expect(dayInputs([], blocks)[0]).toMatchObject({ at: '23:30', end: '24:00' })
  })
})

describe('sharedRange', () => {
  it('une os eixos dos dias que têm eventos e ignora os vazios', () => {
    const a = layoutDayEvents([{ at: '07:00' }])
    const b = layoutDayEvents([{ at: '17:00' }])
    const empty = layoutDayEvents([])
    const r = sharedRange([a, empty, b])
    expect(r.from).toBe(a.range.from)
    expect(r.to).toBe(b.range.to)
  })

  it('sem nenhum evento usa o eixo padrão', () => {
    expect(sharedRange([layoutDayEvents([])])).toEqual(layoutDayEvents([]).range)
  })
})

describe('collectDays e weekDates', () => {
  const day = (date: string): AgendaDay => ({ date, entries: [{ kind: 'unknown', text: date }] })
  const view = (dates: string[]): Pick<AgendaView, 'week' | 'today'> => ({ week: dates.map(day), today: day(dates[0]) })

  it('junta dias de duas semanas lidas e preenche o que faltar com dia vazio', () => {
    const w1 = view(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'])
    const w2 = view(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12'])
    const days = collectDays([w1, w2], ['2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-12', '2026-11-13'])
    expect(days.map((d) => d.date)).toEqual(['2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-12', '2026-11-13'])
    expect(days[0].entries).toHaveLength(1)
    expect(days[5].entries).toEqual([])
  })

  it('weekDates devolve segunda a domingo da semana da data', () => {
    expect(weekDates('2026-11-06')).toEqual([
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
      '2026-11-07',
      '2026-11-08',
    ])
    expect(weekDates('2026-11-08')[0]).toBe('2026-11-02')
    expect(weekDates('2026-11-09')[0]).toBe('2026-11-09')
  })
})

describe('resumos', () => {
  it('focusShares divide em percentuais que somam 100', () => {
    const shares = focusShares([
      { taskId: 'A', focusMs: 75 * MIN },
      { taskId: 'B', focusMs: 25 * MIN },
      { taskId: 'C', focusMs: 75 * MIN },
    ])
    expect(shares.reduce((a, s) => a + s.pct, 0)).toBe(100)
    expect(shares.map((s) => s.pct)).toEqual([43, 14, 43])
    expect(focusShares([])).toEqual([])
    expect(focusShares([{ taskId: 'A', focusMs: 0 }])).toEqual([{ taskId: 'A', pct: 0 }])
  })

  it('weekAverage é a média dos dias com foco', () => {
    const s = summarizeRange({ '2026-11-02': [seg('A', 0, 60)], '2026-11-03': [seg('A', 0, 120)] }, [
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
    ])
    expect(weekAverage(s)).toBe(90 * MIN)
    expect(weekAverage(summarizeRange({}, ['2026-11-02']))).toBe(0)
  })

  it('longestTask escolhe a de mais foco', () => {
    expect(longestTask([{ focusMs: 10 }, { focusMs: 30 }, { focusMs: 20 }] as never)?.focusMs).toBe(30)
    expect(longestTask([])).toBeUndefined()
  })

  it('hourWindow cobre do primeiro ao último com foco, com pelo menos 4 colunas', () => {
    expect(hourWindow([{ hour: 14 }, { hour: 18 }])).toEqual({ from: 14, to: 18 })
    expect(hourWindow([{ hour: 14 }])).toEqual({ from: 14, to: 17 })
    expect(hourWindow([{ hour: 23 }])).toEqual({ from: 20, to: 23 })
    expect(hourWindow([])).toBeUndefined()
  })
})
