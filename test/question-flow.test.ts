import { describe, expect, it } from 'vitest'
import {
  answeredCount,
  buildAnswers,
  canSubmit,
  createFlow,
  edit,
  goBack,
  goNext,
  helpText,
  isAnswered,
  jump,
  positionText,
  progressText,
  reviewAnswer,
  reviewQuestion,
  setOther,
  stepState,
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

  it('rodapé conta respondidas e faltam, no singular e no plural', () => {
    const f0 = createFlow(qs)
    expect(progressText(f0)).toBe('0 respondidas · 3 faltam')
    const f1 = toggleOption(f0, 0, 'A')
    expect(progressText(f1)).toBe('1 respondida · 2 faltam')
    const f2 = toggleOption(toggleOption(f1, 1, 'X'), 2, 'Agora')
    expect(progressText(f2)).toBe('3 respondidas · 0 faltam')
    expect(progressText(toggleOption(toggleOption(f0, 0, 'A'), 1, 'X')).endsWith('1 falta')).toBe(true)
  })

  it('posição "2 de 4": revisão é "N de N" e pergunta única não mostra nada', () => {
    let f = toggleOption(createFlow(qs), 0, 'A')
    expect(positionText(f)).toBe('1 de 3')
    f = goNext(f)
    expect(positionText(f)).toBe('2 de 3')
    expect(positionText({ ...f, reviewing: true })).toBe('3 de 3')
    expect(positionText(createFlow([qs[0]]))).toBe('')
  })

  it('clicar num passo abre a pergunta; vindo da revisão, volta para ela ao responder', () => {
    let f = createFlow(qs)
    expect(jump(f, 0)).toBe(f)
    expect(jump(f, 5)).toBe(f)
    expect(jump(f, -1)).toBe(f)
    f = jump(f, 2)
    expect(f.index).toBe(2)
    expect(f.fromReview).toBe(false)
    f = goNext(toggleOption(createFlow(qs), 0, 'A'))
    f = goNext(toggleOption(f, 1, 'X'))
    f = goNext(toggleOption(f, 2, 'Agora'))
    expect(f.reviewing).toBe(true)
    f = jump(f, 1)
    expect(f.reviewing).toBe(false)
    expect(f.index).toBe(1)
    expect(goNext(f).reviewing).toBe(true)
  })

  it('estado falado de cada passo', () => {
    let f = toggleOption(createFlow(qs), 0, 'A')
    f = goNext(f)
    expect(stepState(f, 0)).toBe('respondida')
    expect(stepState(f, 1)).toBe('pergunta atual')
    expect(stepState(f, 2)).toBe('ainda sem resposta')
    expect(stepState({ ...f, reviewing: true }, 1)).toBe('ainda sem resposta')
  })

  it('texto de ajuda da pergunta única', () => {
    expect(helpText(false)).toBe('Escolha uma resposta ou escreva a sua.')
    expect(helpText(true)).toContain('uma ou mais')
  })

  it('revisão: respostas separadas por " · " e "(marcou N)" só na múltipla com mais de uma marca', () => {
    let f = createFlow(qs)
    f = toggleOption(toggleOption(f, 1, 'Livros'), 1, 'Apostila')
    f = setOther(f, 2, ' amanhã ')
    expect(reviewAnswer(f, 1)).toBe('Livros · Apostila')
    expect(reviewAnswer(f, 2)).toBe('amanhã')
    expect(reviewAnswer(f, 9)).toBe('')
    expect(reviewQuestion(qs[1], f, 1)).toBe('Quais fontes? (marcou 2)')
    expect(reviewQuestion(qs[0], f, 0)).toBe('Qual arquivo?')
    expect(reviewQuestion(qs[1], toggleOption(createFlow(qs), 1, 'A'), 1)).toBe('Quais fontes?')
    // o que o agente recebe não muda
    expect(buildAnswers(qs, toggleOption(f, 0, 'D'))?.['Quais fontes?']).toBe('Livros, Apostila')
  })
})
