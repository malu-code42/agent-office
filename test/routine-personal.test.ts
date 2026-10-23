import { describe, expect, it } from 'vitest'
import { parsePersonalRoutines, routineCandidates, routineDueOn, type PersonalRoutineItem } from '../src/shared/routine-personal'

/**
 * The lines of rotinas-pessoais.md (AO-42), as text only: synthetic fixtures here, never the real
 * note of a person. The app only reads, and the two outcomes of the review of the day are what
 * these tests cover: a routine due today, or a line that needs the user before it becomes a task.
 */

const firstItem = (text: string): PersonalRoutineItem | undefined => parsePersonalRoutines(text)[0]?.item

const firstRow = (text: string) => parsePersonalRoutines(text)[0]

describe('as linhas de rotinas-pessoais.md', () => {
  it('a linha diária, com acento na cadência e hora curta', () => {
    expect(firstItem('Rotina A | cadência: diária | hora: 7:30')).toEqual({
      title: 'Rotina A',
      cadence: 'diária',
      time: '07:30',
    })
  })

  it('a linha semanal com os dias escritos por extenso, sem maiúsculas nem acentos literais', () => {
    expect(firstItem('Rotina B | cadência: Semanal | dias: Segunda, Quarta | hora: 09:15')).toEqual({
      title: 'Rotina B',
      cadence: 'semanal',
      days: ['segunda', 'quarta'],
      time: '09:15',
    })
  })

  it('aceita aliases semanais do português com hífen e acentos', () => {
    expect(firstItem('Routine A | cadência: semanal | dias: segunda-feira, terça-feira')?.days).toEqual(['segunda-feira', 'terca-feira'])
  })

  it('dias também com formas simples: seg, qua, sábado com acento', () => {
    expect(firstItem('Rotina C | cadência: semanal | dias: seg, qua, Sábado')?.days).toEqual(['seg', 'qua', 'sabado'])
  })

  it('marcadores de lista e comentários do arquivo: a linha conta na numeração, marca e # não', () => {
    const lines = parsePersonalRoutines(
      '# Minhas rotinas\n\n- Rotina A | cadência: semanal | dias: seg\n* Rotina B | cadência: diária',
    )
    expect(lines.map((l) => l.item?.title)).toEqual(['Rotina A', 'Rotina B'])
  })

  it('linhas com problema carregam o número de 1 e um motivo para o usuário consertar', () => {
    expect(parsePersonalRoutines('# Minhas rotinas\n\nRotina A')).toEqual([
      { line: 3, title: 'Rotina A', problem: expect.stringContaining('cadência') },
    ])
  })

  it('sem cadência: nunca é vencida, sempre pede o usuário', () => {
    const row = firstRow('Rotina A')
    expect(row?.item).toBeUndefined()
    expect(row?.problem).toContain('cadência')
  })

  it('semanal sem dias marcados: pede o usuário (nada é presumido)', () => {
    const row = firstRow('Rotina A | cadência: semanal')
    expect(row?.item).toBeUndefined()
    expect(row?.problem).toContain('dias')
  })

  it('um token de dia desconhecido vira needsInput, nunca uma ocorrência não vencida silenciosa', () => {
    const candidates = routineCandidates('Routine A | cadência: semanal | dias: mon, qua', '2026-10-21')
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({ line: 1, kind: 'needsInput', title: 'Routine A' })
    expect(candidates[0].item).toBeUndefined()
    expect(candidates[0].reason).toContain('mon')
  })

  it('diária com dias marcados: pede o usuário por conservadorismo', () => {
    const row = firstRow('Rotina A | cadência: diária | dias: seg, qua')
    expect(row?.item).toBeUndefined()
    expect(row?.problem).toContain('dias')
  })

  it('campo desconhecido, vazio ou com hora fora do formato: motivo citando o que veio', () => {
    const unknown = firstRow('Rotina A | prioridade: alta | cadência: diária')
    expect(unknown?.problem).toContain('prioridade')

    const empty = firstRow('Rotina B | cadência: |')
    expect(empty?.problem).toContain('cadencia')

    const badTime = firstRow('Rotina C | cadência: diária | hora: 7h30')
    expect(badTime?.problem).toContain('7h30')
  })

  it('dias sem nenhum nome entre as vírgulas não passa despercebido', () => {
    expect(firstRow('Rotina A | cadência: semanal | dias:')?.problem).toBeTruthy()
  })

  it('linha sem título no começo: problema, nunca um item com nome vazio', () => {
    const row = firstRow('| cadência: diária')
    expect(row?.item).toBeUndefined()
    expect(row?.problem).toBeTruthy()
  })
})

describe('o dia em que a rotina vence', () => {
  const plan = (text: string): PersonalRoutineItem => {
    const item = firstItem(text)
    if (!item) throw new Error(`Linha bør não virou item: ${text}`)
    return item
  }

  it('diária vence todo dia; semanal só nos dias escritos, sem dia da semana por defeito', () => {
    expect(routineDueOn(plan('Rotina A | cadência: diária'), '2026-10-22')).toBe(true)
    expect(routineDueOn(plan('Rotina B | cadência: semanal | dias: qui'), '2026-10-22')).toBe(true)
    expect(routineDueOn(plan('Rotina B | cadência: semanal | dias: seg'), '2026-10-22')).toBe(false)
    expect(routineDueOn(plan('Rotina C | cadência: semanal | dias: dom'), '2026-10-25')).toBe(true)
  })
})

describe('os candidatos do dia que a Luna levanta', () => {
  const text = [
    '# Rotinas',
    '',
    'Rotina A | cadência: diária', // vence e é quarta-feira que dia
    'Rotina B | cadência: semanal | dias: seg, qua',
    'Rotina C |', // sem cadência
    'Rotina D | cadência: semanal', // semanal sem dias
  ].join('\n')

  it('as vencidas de hoje e as linhas que pedem o usuário, juntas, com a linha de cada uma', () => {
    // 2026-10-22 é quinta: a semanal de seg/qua simplesmente não existe nesse dia.
    const cs = routineCandidates(text, '2026-10-22')
    expect(cs.map((c) => [c.line, c.kind])).toEqual([
      [3, 'due'],
      [5, 'needsInput'],
      [6, 'needsInput'],
    ])
    expect(cs[0].item?.title).toBe('Rotina A')
    expect(cs[1].reason).toContain('cadência')
    expect(cs[2].reason).toContain('dias')
  })

  it('numa quarta, a rotina de qua vence e a de seg não aparece (nem como pedida)', () => {
    const cs = routineCandidates(text, '2026-10-21')
    expect(cs.map((c) => [c.line, c.kind])).toEqual([
      [3, 'due'],
      [4, 'due'],
      [5, 'needsInput'],
      [6, 'needsInput'],
    ])
  })

  it('arquivo vazio ou só comentários: nenhum candidato, nenhuma opinão', () => {
    expect(routineCandidates('# nada\n\n', '2026-10-22')).toEqual([])
  })
})
