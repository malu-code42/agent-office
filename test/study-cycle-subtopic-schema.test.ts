import { describe, expect, it } from 'vitest'
import { hashStudyQuestion, isStudyCycleState } from '../src/main/study-cycle-schema'

describe('study cycle schema', () => {
  it('keeps a cycle whose questions carry a subtopic (it must not load as corrupt)', () => {
    const source = {
      id: 'q-00000001', topic: 'Eletrostática', subtopic: 'Lei de Coulomb', tags: ['x'], question: 'Q?', options: ['um', 'dois'], answer: 'B',
      answerStatus: 'verified', originKind: 'ia', sourceTitle: 'Livro', sourceVisibility: 'public', attribution: 'x', license: 'x',
    }
    const question = { id: source.id, sourceHash: hashStudyQuestion(source), source, response: 'B', providedExcerpt: '', uncertain: false, assessment: null }
    const cycle = { id: 'sc-1', topic: 'Eletrostática', stage: 'diagnosis', startedAt: 1, updatedAt: 2, questions: [question], practiceRounds: [], notes: [], retests: [] }
    expect(isStudyCycleState({ activeId: 'sc-1', cycles: [cycle] })).toBe(true)
  })
})

describe('studyNoteHash (renderer-safe sha256)', () => {
  it('matches node:crypto, including multi-block and non-ASCII text', async () => {
    const { createHash } = await import('node:crypto')
    const { studyNoteHash } = await import('../src/shared/study-cards')
    for (const text of ['', 'abc', 'A probabilidade conjunta depende dos eventos. ção ✓', 'x'.repeat(55), 'x'.repeat(56), 'y'.repeat(1000)])
      expect(studyNoteHash(text)).toBe(createHash('sha256').update(text, 'utf8').digest('hex'))
  })
})
