import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { generateIdeas } from '../src/main/study-ideas'
import type { ReadinessSource } from '../src/main/study-readiness'
import { parseIdeas, studiedTopics } from '../src/shared/study-ideas'
import { topicName } from '../src/shared/study-trail'
import type { StudyCycle, StudyCycleState } from '../src/shared/study-cycle'
import type { StudyReadiness } from '../src/shared/study-readiness'
import { parseStudyTrail } from '../src/shared/study-trail'

const cycle = (topic: string, stage: StudyCycle['stage'], updatedAt: number): StudyCycle => ({
  id: `${topic}-${updatedAt}`,
  topic,
  stage,
  startedAt: 0,
  updatedAt,
  questions: [],
  practiceRounds: [],
  notes: [],
  retests: [],
})

describe('studiedTopics', () => {
  it('lists each topic once, newest first, completed if any cycle of it is', () => {
    const state: StudyCycleState = {
      activeId: null,
      cycles: [cycle('Redes', 'completed', 1), cycle('Banco de dados', 'diagnosis', 3), cycle('Redes', 'practice', 2)],
    }
    expect(studiedTopics(state)).toEqual([
      { topic: 'Banco de dados', completed: false },
      { topic: 'Redes', completed: true },
    ])
  })
})

describe('nome exibido dos tópicos (AO-35)', () => {
  it('tira o código da frente, mas mantém o tópico guardado com ele', () => {
    const [stored] = studiedTopics({ activeId: null, cycles: [cycle('[P2-ED-01] Árvores', 'diagnosis', 1)] })
    expect(stored.topic).toBe('[P2-ED-01] Árvores')
    expect(topicName(stored.topic)).toBe('Árvores')
  })

  it('o renderer mostra e anuncia o nome exibido, não o tópico cru', () => {
    const source = readFileSync('src/renderer/src/ui/study-ideas.ts', 'utf8')
    expect(source).toContain("h('b', {}, topicName(topic))")
    expect(source).toContain('announce(`Ideias de ${topicName(topic)} geradas.`)')
  })
})

describe('generateIdeas', () => {
  const TRAIL = parseStudyTrail('## 2º período\n### [P2-HW] Hardware I — 60 h\n- [ ] [P2-HW-01] Circuitos elétricos.')
  const TOPIC = TRAIL.topics[0]!.title
  const source = (state: 'pronto' | 'poucos-trechos'): ReadinessSource => ({
    trail: () => TRAIL,
    reports: (): Record<string, StudyReadiness> => ({
      'P2-HW': { discipline: 'P2-HW', builtAt: 1, topics: [{ id: 'P2-HW-01', topic: TOPIC, state, reason: 'Só 2 trecho(s).', folders: [] }] },
    }),
  })

  it('generates ideas for a ready topic', async () => {
    const ask = vi.fn(async () => ({ ideas: [{ title: 'Simulador', description: 'Monte um circuito.' }] }))
    const set = await generateIdeas(TOPIC, ask, source('pronto'), 5)
    expect(ask).toHaveBeenCalledOnce()
    expect(set).toEqual({ topic: TOPIC, generatedAt: 5, ideas: [{ title: 'Simulador', description: 'Monte um circuito.' }] })
  })

  it('does not ask the model for a locked topic and says why', async () => {
    const ask = vi.fn(async () => ({ ideas: [{ title: 'Simulador', description: 'Monte um circuito.' }] }))
    await expect(generateIdeas(TOPIC, ask, source('poucos-trechos'))).rejects.toThrow('"Circuitos elétricos" ainda não está pronto: Só 2 trecho(s).')
    expect(ask).not.toHaveBeenCalled()
  })
})

describe('parseIdeas', () => {
  it('keeps well-formed ideas and drops the rest', () => {
    expect(parseIdeas({ ideas: [{ title: ' A ', description: 'b' }, { title: 'x' }, null] })).toEqual([{ title: 'A', description: 'b' }])
  })
  it('returns null when nothing is usable', () => {
    expect(parseIdeas({ ideas: [] })).toBeNull()
    expect(parseIdeas('texto')).toBeNull()
  })
})
