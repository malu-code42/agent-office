import { describe, expect, it } from 'vitest'
import { buildAgendaView, parseAgenda } from '../src/shared/agenda'

const agenda = [
  '# Agenda',
  '## 2026-10-17',
  '- 09:00 Reunião com Ana',
  '- 10:30 ↦ ^tabc123',
  '- 11:00 ↦ ^tzzzzzz',
  'Anotar o almoço',
  '## 2026-10-18',
  '- 08:00 Corrida',
  '## 2026-02-31',
  '- 07:00 Fantasma',
  '## Notas',
  '- 06:00 Sem dia',
  '- 25:00 Hora errada',
  '- 12:00 ↦ ^xyz',
].join('\n')

const tasks = '## Casa\n- [ ] Lavar roupa ^tabc123\n- [x] Passar pano ✅ 2026-10-12 ^tdef456\n'

describe('agenda parse', () => {
  it('groups commitments, task references and unknown lines by date heading, in file order', () => {
    const { days, undated } = parseAgenda(agenda)

    expect(days.get('2026-10-17')).toEqual([
      { kind: 'commitment', time: '09:00', title: 'Reunião com Ana' },
      { kind: 'task', time: '10:30', id: 'tabc123' },
      { kind: 'task', time: '11:00', id: 'tzzzzzz' },
      { kind: 'unknown', text: 'Anotar o almoço' },
    ])
    expect(days.get('2026-10-18')).toEqual([{ kind: 'commitment', time: '08:00', title: 'Corrida' }])
    expect(days.has('2026-02-31')).toBe(false)
    expect(undated).toEqual([
      { kind: 'unknown', text: '# Agenda' },
      { kind: 'unknown', text: '## 2026-02-31' },
      { kind: 'commitment', time: '07:00', title: 'Fantasma' },
      { kind: 'unknown', text: '## Notas' },
      { kind: 'commitment', time: '06:00', title: 'Sem dia' },
      { kind: 'unknown', text: '- 25:00 Hora errada' },
      { kind: 'unknown', text: '- 12:00 ↦ ^xyz' },
    ])
  })

  it('reads a file with CRLF line endings and a BOM, and an empty file as no days', () => {
    const { days } = parseAgenda('\uFEFF## 2026-10-17\r\n- 09:00 Reunião\r\n')

    expect(days.get('2026-10-17')).toEqual([{ kind: 'commitment', time: '09:00', title: 'Reunião' }])
    expect(parseAgenda('')).toEqual({ days: new Map(), undated: [] })
  })
})

describe('agenda view', () => {
  it('shows the local day and the Monday-to-Sunday week, for a Sunday', () => {
    const view = buildAgendaView(agenda, tasks, new Date(2026, 9, 18, 9))

    expect(view.found).toBe(true)
    expect(view.today.date).toBe('2026-10-18')
    expect(view.week.map((day) => day.date)).toEqual([
      '2026-10-12',
      '2026-10-13',
      '2026-10-14',
      '2026-10-15',
      '2026-10-16',
      '2026-10-17',
      '2026-10-18',
    ])
    expect(view.today.entries).toEqual([{ kind: 'commitment', time: '08:00', title: 'Corrida' }])
  })

  it('shows the week that starts on the Monday, for a Monday', () => {
    const view = buildAgendaView(agenda, tasks, new Date(2026, 9, 19, 9))

    expect(view.today.date).toBe('2026-10-19')
    expect(view.week[0]!.date).toBe('2026-10-19')
    expect(view.week[6]!.date).toBe('2026-10-25')
  })

  it('resolves a task reference to its text, and shows a missing id with no text', () => {
    const view = buildAgendaView(agenda, tasks, new Date(2026, 9, 17, 9))

    expect(view.today.entries).toEqual([
      { kind: 'commitment', time: '09:00', title: 'Reunião com Ana' },
      { kind: 'task', time: '10:30', id: 'tabc123', text: 'Lavar roupa' },
      { kind: 'task', time: '11:00', id: 'tzzzzzz', text: null },
      { kind: 'unknown', text: 'Anotar o almoço' },
    ])
  })

  it('matches an id regardless of case', () => {
    const view = buildAgendaView('## 2026-10-17\n- 10:30 ↦ ^TABC123\n', tasks, new Date(2026, 9, 17))

    expect(view.today.entries).toEqual([{ kind: 'task', time: '10:30', id: 'TABC123', text: 'Lavar roupa' }])
  })

  it('has no days and no lines when the vault has no agenda.md, and keeps the week', () => {
    const view = buildAgendaView(null, tasks, new Date(2026, 9, 17))

    expect(view.found).toBe(false)
    expect(view.today).toEqual({ date: '2026-10-17', entries: [] })
    expect(view.week).toHaveLength(7)
    expect(view.undated).toEqual([])
  })
})
