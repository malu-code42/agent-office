import { describe, expect, it } from 'vitest'
import { buildClassSchedule, splitClassTitle } from '../src/shared/class-schedule'

const AULAS = [
  '# Aulas',
  '- id: ed-seg | dia: segunda | hora: 19:00 | título: Estrutura de Dados · Filas com o tutor',
  '- id: ed-qua | dia: quarta | hora: 19:00 | título: Estrutura de Dados · Prática com o curador',
  '- id: lmd | dia: terça | hora: 10:00 | título: Lógica',
  '- id: reteste | dia: sexta | hora: 19:00 | título: Reteste — Suas respostas são a evidência',
  '- id: ed-qua | data: 2026-10-28 | hora: 20:00',
  '- id: reteste | data: 2026-10-30 | cancelar',
  '- id: lmd | data: 2026-10-27 | título: Lógica · Revisão',
  '- id: ed-seg | data: 2026-11-02 | cancelar',
  'linha solta',
].join('\n')

// Saturday, 2026-10-31: the week runs from Monday 26 to Sunday 1.
const SATURDAY = new Date(2026, 9, 31, 9)

describe('Horário de aula: grade semanal de aulas.md', () => {
  it('splits a title into topic and what happens', () => {
    expect(splitClassTitle('Probabilidade · Aula com o tutor')).toEqual({ topic: 'Probabilidade', detail: 'Aula com o tutor' })
    expect(splitClassTitle('Reteste — Evidência')).toEqual({ topic: 'Reteste', detail: 'Evidência' })
    expect(splitClassTitle('Leitura livre')).toEqual({ topic: 'Leitura livre', detail: '' })
  })

  it('builds Monday to Friday by time, with today marked; Saturday only when it has a class', () => {
    const view = buildClassSchedule(AULAS, SATURDAY)
    expect(view.found).toBe(true)
    expect(view.days.map((day) => day.label)).toEqual(['Seg', 'Ter', 'Qua', 'Qui', 'Sex'])
    expect(view.days.map((day) => day.date)[0]).toBe('2026-10-26')
    expect(view.days.filter((day) => day.today)).toEqual([])
    const withSaturday = buildClassSchedule(`${AULAS}\n- id: sab | dia: sábado | hora: 09:00 | título: Monitoria`, SATURDAY)
    expect(withSaturday.days.filter((day) => day.today).map((day) => day.label)).toEqual(['Sáb'])
    expect(view.times).toEqual(['10:00', '19:00', '20:00'])
    expect(view.days[0]!.classes).toEqual([{ id: 'ed-seg', time: '19:00', topic: 'Estrutura de Dados', detail: 'Filas com o tutor' }])
    expect(view.warnings).toEqual([expect.stringMatching(/não reconhecido/)])
  })

  it('an exception changes only its occurrence: moved, retitled or cancelled (kept, marked)', () => {
    const view = buildClassSchedule(AULAS, SATURDAY)
    expect(view.days[2]!.classes[0]).toMatchObject({ id: 'ed-qua', time: '20:00', change: { kind: 'moved', from: '19:00' } })
    expect(view.days[1]!.classes[0]).toMatchObject({ topic: 'Lógica', detail: 'Revisão', change: { kind: 'retitled' } })
    expect(view.days[4]!.classes[0]).toMatchObject({ id: 'reteste', time: '19:00', change: { kind: 'cancelled' } })
    // The next week has the grid as it is: Wednesday back at 19:00, Friday not cancelled.
    const next = buildClassSchedule(AULAS, new Date(2026, 10, 4))
    expect(next.days[2]!.classes[0]).toMatchObject({ time: '19:00' })
    expect(next.days[2]!.classes[0]!.change).toBeUndefined()
    expect(next.days[4]!.classes[0]!.change).toBeUndefined()
    expect(next.days[0]!.classes[0]).toMatchObject({ change: { kind: 'cancelled' } })
  })

  it('shows Sunday only when a class falls on it; no file is an empty, not-found view', () => {
    expect(buildClassSchedule('- id: dom | dia: domingo | hora: 09:00 | título: Revisão', SATURDAY).days.at(-1)).toMatchObject({
      label: 'Dom',
      date: '2026-11-01',
    })
    expect(buildClassSchedule(null, SATURDAY)).toMatchObject({ found: false, times: [], warnings: [] })
  })
})
