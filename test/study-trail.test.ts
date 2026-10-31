import { describe, expect, it } from 'vitest'
import { parseStudyTrail, trailTopicOf } from '../src/shared/study-trail'
import {
  activeStudyCycle,
  createStudyCycleState,
  resetActiveStudyCycle,
  resumeStudyCycle,
  type StudyCycleQuestion,
} from '../src/shared/study-cycle'

const TRAIL = [
  '# Trilha Zettel',
  '',
  '## Uso e limites',
  '',
  '- [ ] Uma regra com caixa fora de disciplina não é tópico.',
  '- Lista comum.',
  '',
  '## 1º período',
  '',
  '### [P1-LMD] Lógica e Matemática Discreta — 90 h',
  'Fonte: ementa.',
  '',
  '- [x] [P1-LMD-01] Proposições e conectivos.',
  '- [ ] [P1-LMD-02] Tabelas-verdade.',
  '',
  '## 2º período',
  '',
  '### [P2-ED] Estrutura de Dados — 45 h',
  '- [ ] [P2-ED-01] Listas.',
  '- [ ] Filas sem identificador',
  '- [ ] [P2-ED-03] Árvores binárias de busca.',
].join('\r\n')

describe('trilha zettel.md: tópicos do ciclo', () => {
  it('reads the checklist topics under each discipline, with their place in it', () => {
    const trail = parseStudyTrail(TRAIL)
    expect(trail.found).toBe(true)
    expect(trail.topics.map((t) => t.label)).toEqual([
      '[P1-LMD-01] Proposições e conectivos',
      '[P1-LMD-02] Tabelas-verdade',
      '[P2-ED-01] Listas',
      'Filas sem identificador',
      '[P2-ED-03] Árvores binárias de busca',
    ])
    expect(trail.topics[0]).toMatchObject({
      id: 'P1-LMD-01',
      done: true,
      discipline: 'Lógica e Matemática Discreta',
      period: '1º período',
      index: 1,
      total: 2,
    })
    expect(trail.topics[4]).toMatchObject({ discipline: 'Estrutura de Dados', period: '2º período', index: 3, total: 3, done: false })
    expect(trail.topics[3]!.id).toBeNull()
  })

  it('finds the topic of a cycle by label or by id (a renamed title keeps its id)', () => {
    const trail = parseStudyTrail(TRAIL)
    expect(trailTopicOf(trail, '[P2-ED-01] Listas')?.index).toBe(1)
    expect(trailTopicOf(trail, '[P2-ED-03] Árvores (nome antigo)')?.title).toBe('Árvores binárias de busca')
    expect(trailTopicOf(trail, 'Probabilidade')).toBeUndefined()
  })

  it('without the file there are no topics', () => {
    expect(parseStudyTrail(null)).toEqual({ found: false, topics: [] })
  })
})

const question = (id: string): StudyCycleQuestion => ({
  id,
  sourceHash: 'h',
  source: {
    id,
    topic: 't',
    tags: [],
    question: 'Pergunta?',
    answerStatus: 'missing',
    originKind: 'livro',
    sourceTitle: 'Livro',
    sourceVisibility: 'local',
    attribution: 'a',
    license: 'l',
  },
  response: '',
  providedExcerpt: '',
  uncertain: null,
  assessment: null,
})

describe('trocar tópico guarda o trabalho', () => {
  it('switching keeps the previous cycle, and resuming pins it again untouched', () => {
    const first = createStudyCycleState('[P2-ED-01] Listas', [question('q-aaaaaaaa')], 1)
    const firstCycle = activeStudyCycle(first)!
    const answered = { ...first, cycles: [{ ...firstCycle, questions: [{ ...firstCycle.questions[0]!, response: 'minha resposta' }] }] }
    const switched = resetActiveStudyCycle(answered)
    expect(switched.activeId).toBeNull()
    const second = createStudyCycleState('[P1-LMD-02] Tabelas-verdade', [question('q-bbbbbbbb')], 2, switched)
    expect(second.cycles).toHaveLength(2)
    expect(activeStudyCycle(second)!.topic).toBe('[P1-LMD-02] Tabelas-verdade')
    const back = resumeStudyCycle(second, firstCycle.id)
    expect(activeStudyCycle(back)).toEqual(answered.cycles[0])
    expect(back.cycles).toEqual(second.cycles)
  })

  it('does not resume a missing or completed cycle', () => {
    const state = createStudyCycleState('Filas', [question('q-aaaaaaaa')], 1)
    const id = state.activeId!
    expect(() => resumeStudyCycle(state, 'sc-0-nada')).toThrow(/histórico/)
    const done = { ...state, cycles: state.cycles.map((c) => ({ ...c, stage: 'completed' as const })) }
    expect(() => resumeStudyCycle(done, id)).toThrow(/concluído/)
  })
})
