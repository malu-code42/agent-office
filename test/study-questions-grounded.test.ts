import { describe, expect, it, vi } from 'vitest'
import { generateGroundedQuestion, tooSimilar, type AskJson } from '../src/main/study-questions-grounded'

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }))

const source = {
  topic: 'Sistemas de numeração',
  excerpt: 'No sistema binário só existem os dígitos 0 e 1.\nCada dígito é um bit.',
  sourceTitle: 'Livro X',
  sourceReference: 'livro-x.pdf p. 3',
}
const draft = {
  question: 'Quais dígitos existem no sistema binário?',
  choices: ['0 a 9', '0 e 1', '0 a 7', '0 a F', '1 e 2'],
  correct: 'B',
  rationale: 'Definição.',
  quote: 'só existem os dígitos 0 e 1',
}

const solved = { answer: 'B' }
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
    expect(out.ok && out.question.choices).toHaveLength(5)
    expect(out.ok && out.question.correct).toBe('B')
    expect(out.ok && out.question.answer).toBe('0 e 1')
    expect(ask).toHaveBeenCalledTimes(3)
  })

  it('rejects a draft without five different alternatives and a valid letter', async () => {
    const { result } = run([
      { ...draft, choices: ['0 e 1', '0 a 9'] },
      { ...draft, choices: ['a', 'a', 'b', 'c', 'd'] },
      { ...draft, correct: 'F' },
    ])
    expect(await result).toMatchObject({ ok: false, reason: 'O autor devolveu uma questão incompleta.' })
  })

  it('refuses when the blind solver picks another letter, before the verifier', async () => {
    const { ask, result } = run([draft, { answer: 'A' }, draft, { answer: 'C' }, draft, { answer: 'D' }])
    expect(await result).toMatchObject({ ok: false, code: 'refused' })
    expect(ask).toHaveBeenCalledTimes(6)
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
