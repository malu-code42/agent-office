import { describe, expect, it, vi } from 'vitest'
import { generateGroundedQuestion, tooSimilar, type AskJson } from '../src/main/study-questions-grounded'

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }))

const source = {
  topic: 'Sistemas de numeração',
  excerpt: 'No sistema binário só existem os dígitos 0 e 1.\nCada dígito é um bit.',
  sourceTitle: 'Livro X',
  sourceReference: 'livro-x.pdf p. 3',
}
const draft = { question: 'Quais dígitos existem no sistema binário?', answer: '0 e 1', rationale: 'Definição.', quote: 'só existem os dígitos 0 e 1' }

const solved = { answer: '0 e 1' }
const run = (replies: unknown[]) => {
  const ask: AskJson = vi.fn(async () => replies.shift())
  return { ask, result: generateGroundedQuestion(source, ask) }
}

describe('generateGroundedQuestion', () => {
  it('accepts a question the verifier approves', async () => {
    const { ask, result } = run([draft, solved, { verdict: 'ok', reason: '' }])
    const out = await result
    expect(out.ok && out.question.originKind).toBe('livro')
    expect(out.ok && out.question.answerStatus).toBe('verified')
    expect(out.ok && out.question.verifiedByUser).toBeUndefined()
    expect(ask).toHaveBeenCalledTimes(3)
  })

  it('rejects a quote that is not in the source without calling the verifier', async () => {
    const { ask, result } = run(Array(3).fill({ ...draft, quote: 'frase inventada' }))
    expect(await result).toMatchObject({ ok: false, reason: 'A citação do autor não existe na fonte.' })
    expect(ask).toHaveBeenCalledTimes(3)
  })

  it('retries after a verifier rejection, then gives up', async () => {
    const wrong = { verdict: 'wrong', reason: 'contradiz' }
    const { result } = run([draft, solved, wrong, draft, solved, wrong])
    expect(await result).toMatchObject({ ok: false })
  })

  it('rejects when the blind solver finds no answer in the source', async () => {
    const { result } = run([draft, { answer: '' }, draft, { answer: '' }])
    expect(await result).toMatchObject({ ok: false, reason: 'O resolvedor cego não achou a resposta na fonte.' })
  })

  it('rejects a question too similar to one already made, before the solver runs', async () => {
    const ask: AskJson = vi.fn(async () => draft)
    const out = await generateGroundedQuestion({ ...source, avoid: ['Quais são os dígitos que existem no sistema binário?'] }, ask)
    expect(out).toMatchObject({ ok: false, reason: 'A questão é parecida demais com outra do mesmo tópico.' })
    expect(ask).toHaveBeenCalledTimes(3)
  })

  it('tells similar from different questions', () => {
    expect(tooSimilar('Qual a base do sistema octal?', 'Qual é a base do sistema octal?')).toBe(true)
    expect(tooSimilar('Qual a base do sistema octal?', 'Como converter binário para hexadecimal?')).toBe(false)
  })

  it('stops when the author says the source is unsupported', async () => {
    const { ask, result } = run([{ error: 'unsupported' }])
    expect(await result).toMatchObject({ ok: false })
    expect(ask).toHaveBeenCalledTimes(1)
  })
})
