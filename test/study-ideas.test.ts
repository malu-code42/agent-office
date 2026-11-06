import { describe, expect, it } from 'vitest'
import { parseIdeas, studiedTopics } from '../src/shared/study-ideas'
import { topicName } from '../src/shared/study-trail'
import type { StudyCycle, StudyCycleState } from '../src/shared/study-cycle'

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
