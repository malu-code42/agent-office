import { describe, expect, it } from 'vitest'
import { buildAgendaView, parseAgenda, parseClasses, weekProgress } from '../src/shared/agenda'
import { routineWeekMarks, type PersonalRoutineWeekRow } from '../src/shared/routine-personal'
import { mediaAgendaLinks } from '../src/shared/media'

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
  it('parses editable weekly classes and date-specific cancellation/overrides', () => {
    const parsed = parseClasses(
      [
        '# Aulas',
        '## Regras semanais',
        '- id: aula-a | dia: segunda | hora: 09:00 | título: Aula A (SIMULADO)',
        '## Exceções',
        '- id: aula-a | data: 2026-10-19 | hora: 10:00 | título: Aula especial (SIMULADO)',
        '- id: aula-a | data: 2026-10-26 | cancelar',
      ].join('\r\n'),
    )
    expect(parsed.rules).toEqual([{ id: 'aula-a', weekday: 1, time: '09:00', title: 'Aula A (SIMULADO)' }])
    expect(parsed.exceptions).toEqual([
      { id: 'aula-a', date: '2026-10-19', time: '10:00', title: 'Aula especial (SIMULADO)' },
      { id: 'aula-a', date: '2026-10-26', cancelled: true },
    ])
    expect(parsed.warnings).toEqual([])
  })

  it('expands local weekly classes and applies exceptions only to their date', () => {
    const source = [
      '- id: aula-a | dia: segunda | hora: 09:00 | título: Aula A (SIMULADO)',
      '- id: aula-b | dia: domingo | hora: 12:00 | título: Aula B (SIMULADO)',
      '- id: aula-a | data: 2026-10-19 | hora: 10:00 | título: Reposição (SIMULADO)',
      '- id: aula-b | data: 2026-10-25 | cancelar',
    ].join('\n')
    const view = buildAgendaView(null, '', new Date(2026, 9, 19, 0, 30), source)
    expect(view.found).toBe(false)
    expect(view.classesFound).toBe(true)
    expect(view.week[0]!.entries).toEqual([{ kind: 'class', id: 'aula-a', time: '10:00', title: 'Reposição (SIMULADO)' }])
    expect(view.week[6]!.entries).toEqual([])
    expect(buildAgendaView(null, '', new Date(2026, 9, 26), source).today.entries).toEqual([
      { kind: 'class', id: 'aula-a', time: '09:00', title: 'Aula A (SIMULADO)' },
    ])
  })

  it('shows malformed content warnings and rejects invalid or duplicate rule identifiers', () => {
    expect(parseClasses('- id: aula-a | dia: segunda | hora: 09:00 | título: Aula A (SIMULADO)\nlinha perdida').warnings).toContain(
      'Linha 2: conteúdo não reconhecido em aulas.md: "linha perdida".',
    )
    expect(
      parseClasses(
        [
          '- id: aula-a | dia: segunda | hora: 09:00 | título: Aula A (SIMULADO)',
          '- id: aula-a | dia: domingo | hora: 10:00 | título: Outra (SIMULADO)',
          '- id: aula-c | dia: segunda | hora: 25:00 | título: Inválida',
          '- id: aula-d | data: 2026-02-31 | cancelar',
        ].join('\n'),
      ).warnings,
    ).toHaveLength(3)
    expect(parseClasses(null)).toEqual({ rules: [], exceptions: [], attended: new Set(), warnings: [] })
  })

  it('deduplicates exact class/commitment entries and marks distinct same-time entries as conflicts', () => {
    const agendaText = '## 2026-10-19\n- 09:00 Aula A (SIMULADO)\n- 09:00 Outro compromisso'
    const classText =
      '- id: aula-a | dia: segunda | hora: 09:00 | título: Aula A (SIMULADO)\n- id: aula-b | dia: segunda | hora: 09:00 | título: Aula B (SIMULADO)'
    const view = buildAgendaView(agendaText, '', new Date(2026, 9, 19), classText)
    expect(view.today.entries).toEqual([
      { kind: 'class', id: 'aula-a', time: '09:00', title: 'Aula A (SIMULADO)', conflict: true },
      { kind: 'commitment', time: '09:00', title: 'Outro compromisso', conflict: true },
      { kind: 'class', id: 'aula-b', time: '09:00', title: 'Aula B (SIMULADO)', conflict: true },
    ])
  })

  it('replaces a matched commitment in place before later agenda entries', () => {
    const view = buildAgendaView(
      '## 2026-10-19\n- 09:00 Aula A (SIMULADO)\n- 10:00 Compromisso posterior (SIMULADO)',
      '',
      new Date(2026, 9, 19),
      '- id: aula-a | dia: segunda | hora: 09:00 | título: Aula A (SIMULADO)',
    )

    expect(view.today.entries).toEqual([
      { kind: 'class', id: 'aula-a', time: '09:00', title: 'Aula A (SIMULADO)' },
      { kind: 'commitment', time: '10:00', title: 'Compromisso posterior (SIMULADO)' },
    ])
  })

  it('merges a class with matching commitment and resolved task entries into one class without conflict', () => {
    const view = buildAgendaView(
      '## 2026-10-19\n- 09:00 Aula A (SIMULADO)\n- 09:00 ↦ ^tabc123',
      '## Casa\n- [ ] Aula A (SIMULADO) ^tabc123',
      new Date(2026, 9, 19),
      '- id: aula-a | dia: segunda | hora: 09:00 | título: Aula A (SIMULADO)',
    )

    expect(view.today.entries).toEqual([{ kind: 'class', id: 'aula-a', time: '09:00', title: 'Aula A (SIMULADO)' }])
  })

  it('replaces a matching resolved task reference with the class view entry', () => {
    const view = buildAgendaView(
      '## 2026-10-19\n- 09:00 ↦ ^tabc123',
      '## Casa\n- [ ] Aula A (SIMULADO) ^tabc123',
      new Date(2026, 9, 19),
      '- id: aula-a | dia: segunda | hora: 09:00 | título: Aula A (SIMULADO)',
    )

    expect(view.today.entries).toEqual([{ kind: 'class', id: 'aula-a', time: '09:00', title: 'Aula A (SIMULADO)' }])
  })

  it('preserves repeated unmatched commitments, unresolved task references, and unknown lines', () => {
    const view = buildAgendaView(
      '## 2026-10-19\n- 08:00 Repetido (SIMULADO)\n- 08:00 Repetido (SIMULADO)\n- 09:00 ↦ ^tzzzzzz\n- 09:00 ↦ ^tzzzzzz\nAnotação sem formato',
      '',
      new Date(2026, 9, 19),
      '- id: aula-a | dia: segunda | hora: 10:00 | título: Aula A (SIMULADO)',
    )

    expect(view.today.entries).toEqual([
      { kind: 'commitment', time: '08:00', title: 'Repetido (SIMULADO)', conflict: true },
      { kind: 'commitment', time: '08:00', title: 'Repetido (SIMULADO)', conflict: true },
      { kind: 'task', time: '09:00', id: 'tzzzzzz', text: null, conflict: true },
      { kind: 'task', time: '09:00', id: 'tzzzzzz', text: null, conflict: true },
      { kind: 'unknown', text: 'Anotação sem formato' },
      { kind: 'class', id: 'aula-a', time: '10:00', title: 'Aula A (SIMULADO)' },
    ])
  })

  it('allows time-only and title-only exceptions for one date, preserving the weekly rule', () => {
    const source = [
      '- id: aula-a | dia: segunda | hora: 09:00 | título: Aula A (SIMULADO)',
      '- id: aula-a | data: 2026-10-19 | hora: 10:00',
      '- id: aula-a | data: 2026-10-26 | título: Aula especial (SIMULADO)',
    ].join('\n')

    expect(parseClasses(source).warnings).toEqual([])
    expect(buildAgendaView(null, '', new Date(2026, 9, 19), source).today.entries).toEqual([
      { kind: 'class', id: 'aula-a', time: '10:00', title: 'Aula A (SIMULADO)' },
    ])
    expect(buildAgendaView(null, '', new Date(2026, 9, 26), source).today.entries).toEqual([
      { kind: 'class', id: 'aula-a', time: '09:00', title: 'Aula especial (SIMULADO)' },
    ])
    expect(buildAgendaView(null, '', new Date(2026, 10, 2), source).today.entries).toEqual([
      { kind: 'class', id: 'aula-a', time: '09:00', title: 'Aula A (SIMULADO)' },
    ])
  })

  it('rejects an exception without cancellation or any override', () => {
    expect(parseClasses('- id: aula-a | data: 2026-10-19 |').warnings).toHaveLength(1)
  })

  it('keeps classes out of media commitment links', () => {
    const view = buildAgendaView(
      '## 2026-10-19\n- 11:00 Compromisso (SIMULADO)',
      '',
      new Date(2026, 9, 19),
      '- id: aula-a | dia: segunda | hora: 09:00 | título: Aula A (SIMULADO)',
    )
    expect(mediaAgendaLinks(view)).toEqual([{ day: '2026-10-19', time: '11:00', title: 'Compromisso (SIMULADO)' }])
  })
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

describe('weekProgress', () => {
  // Week of Monday 2026-10-26; "now" is Wednesday 28 at 12:00.
  const now = new Date(2026, 9, 28, 12, 0)
  const agendaText = [
    '## 2026-10-26',
    '- 09:00 Dentista',
    '- 10:00 ↦ ^tabc123',
    '## 2026-10-28',
    '- 08:00 Reunião',
    '- 15:00 Revisar contrato',
    '## 2026-10-30',
    '- 10:00 Banco',
  ].join('\n')
  const tasksText = [
    '## Hoje',
    '- [x] Pagar boleto ✅ 2026-10-26 ^tabc123',
    '- [x] Ligar para a Ana ✅ 27.10.2026',
    '- [x] Tarefa da rotina ✅ 2026-10-27 ^trot001',
    '- [x] Fora da semana ✅ 2026-10-19',
    '- [-] Desistiu ❌ 28.10.2026 — descartada: sem tempo',
    '- [ ] Aberta',
  ].join('\n')

  it('soma concluídos e previstos por dia com tarefas e rotinas; o relógio não conclui compromissos', () => {
    const view = buildAgendaView(agendaText, tasksText, now)
    const routines = [
      { day: '2026-10-26', done: true },
      { day: '2026-10-27', done: true, taskId: 'trot001' },
      { day: '2026-10-28', done: false },
      { day: '2026-10-29', done: false },
    ]
    const progress = weekProgress(view.week, tasksText, routines)
    expect(progress.days.map((d) => `${d.done}/${d.planned}`)).toEqual(['2/3', '2/2', '0/3', '0/1', '0/1', '0/0', '0/0'])
    expect(progress.tasksDone).toBe(2)
    expect(progress.tasksDiscarded).toBe(1)
    expect(progress.routinesDone).toBe(2)
    expect(progress.routinesPlanned).toBe(4)
  })

  it('aula passada é prevista; só conta como concluída com presença registrada', () => {
    const classes = '- id: aula-a | dia: segunda | hora: 09:00 | título: Aula A'
    const week = (source: string) => buildAgendaView(null, '', now, source).week
    expect(weekProgress(week(classes), '', []).days[0]).toEqual({ date: '2026-10-26', done: 0, planned: 1 })
    const attended = `${classes}
- id: aula-a | data: 2026-10-26 | presença`
    expect(weekProgress(week(attended), '', []).days[0]).toEqual({ date: '2026-10-26', done: 1, planned: 1 })
    expect(week(attended)[0]!.entries[0]).toMatchObject({ kind: 'class', attended: true })
  })

  it('objetivo alcançado conta como concluído no dia da data ✅', () => {
    const week = buildAgendaView(null, '', now).week
    expect(weekProgress(week, '', [], ['2026-10-27']).days[1]).toEqual({ date: '2026-10-27', done: 1, planned: 1 })
  })

  it('não mostra mais concluídos que previstos num dia', () => {
    const tasks = ['## Hoje', '- [x] A ✅ 2026-10-27', '- [x] B ✅ 2026-10-27'].join('\n')
    expect(weekProgress(buildAgendaView(null, tasks, now).week, tasks, []).days[1]).toEqual({
      date: '2026-10-27',
      done: 2,
      planned: 2,
    })
  })
})

describe('routineWeekMarks', () => {
  const week = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']
  const row = (over: Partial<PersonalRoutineWeekRow>): PersonalRoutineWeekRow => ({
    routineId: 'r',
    line: 1,
    title: 'R',
    cadence: 'diária',
    confirmed: true,
    occurrenceIds: [],
    completed: 0,
    ...over,
  })

  it('põe a rotina diária em todos os dias e a semanal só nos dias dela', () => {
    const marks = routineWeekMarks(
      [
        row({ routineId: 'agua' }),
        row({ routineId: 'violao', cadence: 'semanal', occurrenceIds: ['violao:2026-10-27', 'violao:2026-10-29'] }),
      ],
      [
        { id: 'agua:2026-10-26', routineId: 'agua', day: '2026-10-26', status: 'completed' },
        { id: 'violao:2026-10-27', routineId: 'violao', day: '2026-10-27', status: 'completed', taskId: 'tvio001' },
      ],
      week,
    )
    expect(marks.filter((m) => m.day === '2026-10-26')).toEqual([{ day: '2026-10-26', done: true }])
    expect(marks).toHaveLength(9)
    expect(marks).toContainEqual({ day: '2026-10-27', done: true, taskId: 'tvio001' })
    expect(marks).toContainEqual({ day: '2026-10-29', done: false })
  })

  it('conta a ocorrência feita fora dos dias distribuídos', () => {
    const marks = routineWeekMarks(
      [row({ routineId: 'meta', cadence: 'semanal', target: 3 })],
      [{ id: 'meta:2026-10-30', routineId: 'meta', day: '2026-10-30', status: 'completed' }],
      week,
    )
    expect(marks).toEqual([{ day: '2026-10-30', done: true }])
  })
})
