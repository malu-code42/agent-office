import { describe, expect, it } from 'vitest'
import { allCommitments, planAddCommitment, planRemoveCommitment } from '../src/main/agenda-write'

/** The agenda operations of the Íris (AO-13): a commitment added or taken out, one line at a time, the rest of the file kept. */

const AGENDA = ['# Agenda', '', '## 2026-10-17', '- 14:00 Dentista', '- 10:30 ↦ ^tabc123', '', '## 2026-10-18', '- 09:00 Reunião', ''].join(
  '\n',
)

describe('planAddCommitment', () => {
  it('acrescenta o compromisso no fim dos compromissos do dia, sem mexer no resto', () => {
    const next = planAddCommitment(AGENDA, { day: '2026-10-17', time: '16:00', title: 'Lavar roupa' })
    expect(next).toBe(
      [
        '# Agenda',
        '',
        '## 2026-10-17',
        '- 14:00 Dentista',
        '- 10:30 ↦ ^tabc123',
        '- 16:00 Lavar roupa',
        '',
        '## 2026-10-18',
        '- 09:00 Reunião',
        '',
      ].join('\n'),
    )
  })

  it('o dia precisa existir no agenda.md', () => {
    expect(() => planAddCommitment(AGENDA, { day: '2026-10-30', time: '16:00', title: 'Lavar roupa' })).toThrow(
      'Não encontrei o dia 30.10.2026',
    )
  })

  it('um compromisso igual já existente é recusado', () => {
    expect(() => planAddCommitment(AGENDA, { day: '2026-10-17', time: '14:00', title: 'Dentista' })).toThrow('já existe')
  })

  it('título com quebra de linha ou a marca de tarefa é recusado', () => {
    expect(() => planAddCommitment(AGENDA, { day: '2026-10-17', time: '16:00', title: 'a\nb' })).toThrow('precisa caber em uma linha')
    expect(() => planAddCommitment(AGENDA, { day: '2026-10-17', time: '16:00', title: 'x ↦ y' })).toThrow('precisa caber em uma linha')
  })

  it('mantém as quebras de linha CRLF do arquivo', () => {
    const crlf = AGENDA.replace(/\n/g, '\r\n')
    const next = planAddCommitment(crlf, { day: '2026-10-18', time: '11:00', title: 'Café' })
    expect(next).toContain('- 09:00 Reunião\r\n- 11:00 Café\r\n')
  })
})

describe('planRemoveCommitment', () => {
  it('tira a linha do compromisso e deixa o resto do dia', () => {
    const next = planRemoveCommitment(AGENDA, { day: '2026-10-17', time: '14:00', title: 'Dentista' })
    expect(next).toBe(['# Agenda', '', '## 2026-10-17', '- 10:30 ↦ ^tabc123', '', '## 2026-10-18', '- 09:00 Reunião', ''].join('\n'))
  })

  it('compromisso que não existe é recusado, com a mensagem para o usuário', () => {
    expect(() => planRemoveCommitment(AGENDA, { day: '2026-10-17', time: '15:00', title: 'Dentista' })).toThrow(
      'Não encontrei o compromisso',
    )
  })

  it('dois compromissos iguais são recusados: não se sabe qual tirar', () => {
    const twin = AGENDA.replace('- 14:00 Dentista', '- 14:00 Dentista\n- 14:00 Dentista')
    expect(() => planRemoveCommitment(twin, { day: '2026-10-17', time: '14:00', title: 'Dentista' })).toThrow('Há mais de um compromisso')
  })
})

describe('allCommitments', () => {
  it('lista todos os compromissos com o dia do cabeçalho, sem a linha de tarefa', () => {
    expect(allCommitments(AGENDA)).toEqual([
      { day: '2026-10-17', time: '14:00', title: 'Dentista' },
      { day: '2026-10-18', time: '09:00', title: 'Reunião' },
    ])
  })
})
