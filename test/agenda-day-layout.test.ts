import { describe, expect, it } from 'vitest'
import { EMPTY_RANGE, layoutDayEvents, MIN_EVENT_MINUTES, type DayEventInput } from '../src/renderer/src/ui/agenda-day-layout'

const hm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

/** Dois cartões se sobrepõem na tela quando dividem coluna e intervalo de tempo. */
function collisions(inputs: DayEventInput[]): number {
  const { events } = layoutDayEvents(inputs)
  let n = 0
  for (const a of events)
    for (const b of events) {
      if (a.index >= b.index || a.column !== b.column) continue
      if (a.top < b.top + b.height && b.top < a.top + a.height) n++
    }
  return n
}

describe('layoutDayEvents', () => {
  it('dia vazio devolve o eixo padrão sem eventos', () => {
    expect(layoutDayEvents([])).toEqual({ events: [], range: EMPTY_RANGE })
  })

  it('um evento ocupa a largura toda e o eixo ganha uma hora de folga nos dois lados', () => {
    const { events, range } = layoutDayEvents([{ at: '09:30' }])
    expect(events[0]).toMatchObject({ column: 0, columns: 1, startMin: 570, endMin: 620 })
    expect(range.from).toBe(8 * 60)
    expect(range.to).toBe(12 * 60)
    expect(events[0]!.top).toBe(570 - range.from)
  })

  it('dois eventos no mesmo horário ficam lado a lado em duas colunas', () => {
    const { events } = layoutDayEvents([{ at: '08:55' }, { at: '08:55', defaultMinutes: 60 }])
    expect(events.map((e) => [e.column, e.columns])).toEqual([
      [1, 2],
      [0, 2],
    ])
    expect(events[0]!.top).toBe(events[1]!.top)
  })

  it('três em cadeia: A e C reaproveitam colunas e o grupo todo divide em 2', () => {
    // A 08:00-09:00, B 08:30-09:30, C 09:10-10:00: A não toca C.
    const { events } = layoutDayEvents([
      { at: '08:00', end: '09:00' },
      { at: '08:30', end: '09:30' },
      { at: '09:10', end: '10:00' },
    ])
    expect(events.map((e) => [e.column, e.columns])).toEqual([
      [0, 2],
      [1, 2],
      [0, 2],
    ])
  })

  it('grupos separados no tempo não dividem a largura', () => {
    const { events } = layoutDayEvents([{ at: '07:00' }, { at: '07:50' }, { at: '08:55' }, { at: '08:55' }])
    expect(events.map((e) => e.columns)).toEqual([1, 1, 2, 2])
  })

  it('fim menor que o início atravessa a meia-noite e vai até 24h', () => {
    const { events, range } = layoutDayEvents([{ at: '22:00', end: '01:00' }])
    expect(events[0]!.endMin).toBe(24 * 60)
    expect(range.to).toBe(24 * 60)
  })

  it('sem fim usa a duração padrão, e o mínimo legível vale para eventos curtos', () => {
    const [a, b] = layoutDayEvents([{ at: '10:00' }, { at: '12:00', end: '12:05' }]).events
    expect(a!.height).toBe(50)
    expect(b!.height).toBe(MIN_EVENT_MINUTES)
  })

  it('evento colado no fim do dia não ultrapassa o eixo', () => {
    const { events, range } = layoutDayEvents([{ at: '23:50' }])
    expect(events[0]!.top + events[0]!.height + range.from).toBeLessThanOrEqual(range.to)
  })

  it('eixo se ajusta ao intervalo dos eventos, em horas cheias, sem espaço vazio até 23h', () => {
    const { range } = layoutDayEvents([{ at: '07:00' }, { at: '15:10' }])
    expect(range).toEqual({ from: 6 * 60, to: 17 * 60 })
  })

  it('eixo respeita o mínimo e fica dentro do dia', () => {
    const early = layoutDayEvents([{ at: '00:10' }]).range
    expect(early.from).toBe(0)
    expect(early.to - early.from).toBeGreaterThanOrEqual(4 * 60)
    const late = layoutDayEvents([{ at: '23:00' }]).range
    expect(late.to).toBe(24 * 60)
    expect(late.to - late.from).toBeGreaterThanOrEqual(4 * 60)
  })

  it('dia 06/11 do ticket: 10 aulas e 1 compromisso às 08:55 não colidem', () => {
    const aulas = ['07:00', '07:50', '08:55', '09:45', '10:50', '11:40', '13:30', '14:20', '15:25', '16:15']
    const inputs: DayEventInput[] = [...aulas.map((at) => ({ at })), { at: '08:55' }]
    const { events, range } = layoutDayEvents(inputs)
    expect(collisions(inputs)).toBe(0)
    // Só a Lab POO (08:55) e o compromisso dividem a linha.
    expect(events.filter((e) => e.columns === 2).map((e) => e.index)).toEqual([2, 10])
    expect(events.filter((e) => e.columns === 1)).toHaveLength(9)
    expect(range).toEqual({ from: 6 * 60, to: 19 * 60 })
    expect(hm(range.from)).toBe('06:00')
  })

  it('muitos eventos simultâneos dividem a largura e nunca colidem na mesma coluna', () => {
    const inputs: DayEventInput[] = Array.from({ length: 5 }, (_, i) => ({ at: hm(9 * 60 + i * 10) }))
    expect(collisions(inputs)).toBe(0)
    expect(new Set(layoutDayEvents(inputs).events.map((e) => e.columns))).toEqual(new Set([5]))
  })
})
