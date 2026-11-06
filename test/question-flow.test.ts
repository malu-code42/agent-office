import { describe, expect, it } from 'vitest'
import {
  answeredCount,
  buildAnswers,
  canSubmit,
  createFlow,
  edit,
  goBack,
  goNext,
  isAnswered,
  setOther,
  toggleOption,
} from '../src/renderer/src/ui/question-flow'

const qs = [
  { question: 'Qual arquivo?', multiSelect: false },
  { question: 'Quais fontes?', multiSelect: true },
  { question: 'Quando?', multiSelect: false },
]

describe('fluxo de perguntas em passos (AO-101)', () => {
  it('começa na primeira pergunta, sem respostas e sem revisão', () => {
    const f = createFlow(qs)
    expect(f.index).toBe(0)
    expect(f.reviewing).toBe(false)
    expect(answeredCount(f)).toBe(0)
    expect(canSubmit(f)).toBe(false)
  })

  it('pergunta sem resposta bloqueia o Próxima', () => {
    const f = createFlow(qs)
    expect(goNext(f)).toBe(f)
    expect(goNext(f).index).toBe(0)
  })

  it('avança com resposta e volta sem perder o que foi marcado', () => {
    let f = toggleOption(createFlow(qs), 0, 'A')
    f = goNext(f)
    expect(f.index).toBe(1)
    f = goBack(f)
    expect(f.index).toBe(0)
    expect(isAnswered(f, 0)).toBe(true)
    expect(goBack(f).index).toBe(0)
  })

  it('escolha única troca a marcação e limpa "Outra resposta"', () => {
    let f = setOther(createFlow(qs), 0, 'meu texto')
    f = toggleOption(f, 0, 'A')
    f = toggleOption(f, 0, 'B')
    expect(f.answers[0]).toEqual({ chosen: ['B'], other: '' })
  })

  it('digitar "Outra resposta" em escolha única desmarca a opção', () => {
    let f = toggleOption(createFlow(qs), 0, 'A')
    f = setOther(f, 0, 'outra')
    expect(f.answers[0]).toEqual({ chosen: [], other: 'outra' })
  })

  it('escolha múltipla liga e desliga opções e mantém "Outra resposta"', () => {
    let f = toggleOption(createFlow(qs), 1, 'X')
    f = toggleOption(f, 1, 'Y')
    f = setOther(f, 1, 'Z')
    expect(f.answers[1]).toEqual({ chosen: ['X', 'Y'], other: 'Z' })
    f = toggleOption(f, 1, 'X')
    expect(f.answers[1].chosen).toEqual(['Y'])
  })

  it('"Outra resposta" só com espaços não conta como resposta', () => {
    expect(isAnswered(setOther(createFlow(qs), 0, '   '), 0)).toBe(false)
  })

  it('na última pergunta respondida, Próxima abre a revisão', () => {
    let f = createFlow(qs)
    f = goNext(toggleOption(f, 0, 'A'))
    f = goNext(toggleOption(f, 1, 'X'))
    expect(f.index).toBe(2)
    expect(goNext(f)).toBe(f)
    f = goNext(toggleOption(f, 2, 'Agora'))
    expect(f.reviewing).toBe(true)
  })

  it('Voltar da revisão volta para a última pergunta', () => {
    let f = createFlow([qs[0]])
    f = goNext(toggleOption(f, 0, 'A'))
    expect(f.reviewing).toBe(true)
    f = goBack(f)
    expect(f.reviewing).toBe(false)
    expect(f.index).toBe(0)
  })

  it('Editar pela revisão leva à pergunta, e ao terminar volta direto à revisão', () => {
    let f = createFlow(qs)
    f = goNext(toggleOption(f, 0, 'A'))
    f = goNext(toggleOption(f, 1, 'X'))
    f = goNext(toggleOption(f, 2, 'Agora'))
    f = edit(f, 0)
    expect(f.reviewing).toBe(false)
    expect(f.index).toBe(0)
    f = goNext(toggleOption(f, 0, 'B'))
    expect(f.reviewing).toBe(true)
    expect(f.answers[0].chosen).toEqual(['B'])
  })

  it('editar e apagar a resposta bloqueia o Próxima de novo', () => {
    let f = createFlow([qs[0]])
    f = goNext(toggleOption(f, 0, 'A'))
    f = edit(f, 0)
    f = setOther(toggleOption(f, 0, 'A'), 0, '')
    f = { ...f, answers: [{ chosen: [], other: '' }] }
    expect(goNext(f)).toBe(f)
  })

  it('só envia com todas respondidas', () => {
    let f = createFlow(qs)
    f = toggleOption(f, 0, 'A')
    f = toggleOption(f, 2, 'Agora')
    expect(canSubmit(f)).toBe(false)
    expect(answeredCount(f)).toBe(2)
    f = toggleOption(f, 1, 'X')
    expect(canSubmit(f)).toBe(true)
  })

  it('monta as respostas no mesmo formato de antes: pergunta -> rótulos separados por vírgula', () => {
    let f = createFlow(qs)
    f = toggleOption(f, 0, 'Diodos.pdf')
    f = toggleOption(f, 1, 'Livros')
    f = toggleOption(f, 1, 'Apostila')
    f = setOther(f, 1, 'Slides')
    f = setOther(f, 2, '  amanhã  ')
    expect(buildAnswers(qs, f)).toEqual({
      'Qual arquivo?': 'Diodos.pdf',
      'Quais fontes?': 'Livros, Apostila, Slides',
      'Quando?': 'amanhã',
    })
  })

  it('buildAnswers devolve null enquanto faltar resposta', () => {
    expect(buildAnswers(qs, toggleOption(createFlow(qs), 0, 'A'))).toBeNull()
  })

  it('fluxo sem perguntas não envia nada', () => {
    expect(canSubmit(createFlow([]))).toBe(false)
  })
})
