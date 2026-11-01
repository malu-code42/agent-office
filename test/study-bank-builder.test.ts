import { describe, expect, it, vi } from 'vitest'
import { parseStudyTrail } from '../src/shared/study-trail'
import { buildStudyBank } from '../src/main/study-bank-builder'
import { STUDY_QUESTION_LIMITS, type StudyQuestion } from '../src/shared/study-questions'

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }))

const trail = parseStudyTrail(
  [
    '## 1º período',
    '### [P1-ICC] Introdução à Ciência da Computação — 60 h',
    '- [ ] [P1-ICC-04] Sistemas de numeração.',
    '### [P2-MC] Metodologia Científica — 60 h',
    '- [ ] [P2-MC-01] O método científico.',
  ].join('\n'),
)
const excerpt = 'No sistema binário só existem os dígitos 0 e 1.'
const hit = {
  id: 'h',
  sourceRef: 'study sources/textbooks/Introdução à Ciência da Computação/L.pdf#Página 3',
  title: 'p',
  excerpt,
  line: 0,
  score: 1,
}
const QUESTIONS = [
  'Quais dígitos aparecem no sistema binário?',
  'Quantos símbolos distintos usa a base dois?',
  'Como se chama cada dígito binário?',
  'Qual base numérica o computador usa internamente?',
]

function setup(options: { verdict?: string; failAsk?: boolean; bank?: StudyQuestion[] } = {}) {
  const bank: StudyQuestion[] = options.bank ?? []
  // Only the computing books exist: Metodologia Científica has no folder and nothing in the default one.
  const search = vi.fn(async (_query: string, scope?: readonly string[]) => ({ hits: scope?.[0]?.includes('Computação') ? [hit] : [] }))
  let n = 0
  const ask = vi.fn(async (system: string) => {
    if (options.failAsk) throw new Error('Claude Code não encontrado.')
    if (system.includes('write one study question')) {
      const question = QUESTIONS[n++ % QUESTIONS.length]!
      return { question, answer: '0 e 1', rationale: 'Definição.', quote: 'só existem os dígitos 0 e 1' }
    }
    if (system.includes('Answer the study question')) return { answer: '0 e 1' }
    return { verdict: options.verdict ?? 'ok', reason: 'ambígua' }
  })
  const appendChecked = vi.fn((rows: StudyQuestion[]) => (bank.push(...rows), { added: rows.length, skipped: 0 }))
  const deps = { library: { search }, bank: { read: () => ({ questions: bank }), appendChecked }, ask }
  return { bank, search, ask, appendChecked, deps }
}

describe('buildStudyBank', () => {
  it('fills each topic from its discipline books and says why a discipline got nothing', async () => {
    const { bank, search, deps } = setup()
    const { results, stop } = await buildStudyBank(trail, deps, { perTopic: 2 })
    expect(stop).toBeUndefined()
    expect(results).toEqual([
      expect.objectContaining({ topic: 'Sistemas de numeração', disciplineId: 'P1-ICC', goal: 2, had: 0, added: 2 }),
      expect.objectContaining({
        topic: 'O método científico',
        added: 0,
        reason: 'no-book',
        folder: 'study sources/textbooks/Metodologia Científica/',
      }),
    ])
    expect(results[0]!.reason).toBeUndefined()
    expect(search).toHaveBeenCalledWith('Sistemas de numeração', ['study sources/textbooks/Introdução à Ciência da Computação/'])
    expect(bank.map((q) => q.tags)).toEqual([['Introdução à Ciência da Computação'], ['Introdução à Ciência da Computação']])
    expect(bank.every((q) => q.answerStatus === 'verified' && !q.verifiedByUser)).toBe(true)
  })

  it('skips a topic that already has its questions and backs up the bank once per run', async () => {
    const { deps, search, appendChecked } = setup()
    await buildStudyBank(trail, deps, { perTopic: 1, discipline: 'P1-ICC' })
    expect(appendChecked).toHaveBeenLastCalledWith(expect.any(Array), true)
    search.mockClear()
    const { results } = await buildStudyBank(trail, deps, { perTopic: 1, discipline: 'P1-ICC' })
    expect(results[0]).toMatchObject({ added: 0, had: 1, reason: 'complete' })
    expect(search).not.toHaveBeenCalled()
  })

  it('does not count answered questions toward the goal', async () => {
    const { deps, bank } = setup()
    await buildStudyBank(trail, deps, { perTopic: 1, discipline: 'P1-ICC' })
    const answered = new Set(bank.map((q) => q.id))
    const { results } = await buildStudyBank(
      trail,
      { ...deps, isAnswered: (q) => answered.has(q.id) },
      { perTopic: 1, discipline: 'P1-ICC' },
    )
    expect(results[0]).toMatchObject({ had: 0, added: 1 })
    expect(bank).toHaveLength(2)
  })

  it('reports the verifier refusing every question', async () => {
    const { deps, bank } = setup({ verdict: 'unsupported' })
    const { results } = await buildStudyBank(trail, deps, { perTopic: 2, discipline: 'P1-ICC' })
    expect(results[0]).toMatchObject({ added: 0, reason: 'refused' })
    expect(bank).toHaveLength(0)
  })

  it('stops the run when Claude is unavailable, without inventing a topic result', async () => {
    const { deps } = setup({ failAsk: true })
    const { results, stop, message } = await buildStudyBank(trail, deps, { perTopic: 2 })
    expect(stop).toBe('unavailable')
    expect(message).toMatch(/não encontrado/)
    expect(results).toEqual([])
  })

  it('stops between calls when cancelled and keeps the finished topic', async () => {
    const { deps } = setup()
    const abort = new AbortController()
    const { results, stop } = await buildStudyBank(trail, deps, {
      perTopic: 1,
      signal: abort.signal,
      onProgress: (event) => {
        if (event.kind === 'done') abort.abort()
      },
    })
    expect(stop).toBe('cancelled')
    expect(results).toHaveLength(1)
  })

  it('stops when the bank is full', async () => {
    const full = Array.from(
      { length: STUDY_QUESTION_LIMITS.count },
      (_, i) => ({ id: `q-full-${String(i).padStart(8, '0')}`, topic: 'x', question: 'x' }) as StudyQuestion,
    )
    const { deps } = setup({ bank: full })
    const { stop } = await buildStudyBank(trail, deps, { perTopic: 1, discipline: 'P1-ICC' })
    expect(stop).toBe('full')
  })
})
