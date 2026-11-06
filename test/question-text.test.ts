import { describe, expect, it } from 'vitest'
import { splitQuestion } from '../src/renderer/src/ui/question-text'

describe('splitQuestion (AO-101)', () => {
  it('texto vazio não tem contexto nem pergunta', () => {
    expect(splitQuestion('')).toEqual({ context: [], question: '' })
    expect(splitQuestion('  \n \n ')).toEqual({ context: [], question: '' })
  })

  it('uma pergunta curta fica toda como pergunta', () => {
    expect(splitQuestion('Qual arquivo devo manter?')).toEqual({ context: [], question: 'Qual arquivo devo manter?' })
  })

  it('separa o contexto da última frase com "?" no mesmo parágrafo', () => {
    const r = splitQuestion('Dois PDFs travam o tópico. Um deles não tem texto. Qual arquivo devo manter?')
    expect(r.question).toBe('Qual arquivo devo manter?')
    expect(r.context).toEqual([{ kind: 'p', text: 'Dois PDFs travam o tópico. Um deles não tem texto.' }])
  })

  it('parágrafos anteriores viram contexto e o último é a pergunta', () => {
    const r = splitQuestion('Primeiro parágrafo.\n\nSegundo parágrafo.\n\nPosso continuar?')
    expect(r.context.map((b) => b.text)).toEqual(['Primeiro parágrafo.', 'Segundo parágrafo.'])
    expect(r.question).toBe('Posso continuar?')
  })

  it('linhas de lista viram itens do contexto, sem o marcador', () => {
    const r = splitQuestion('Achei dois arquivos:\n- Diodos.pdf\n- Eletronica.pdf\n1. terceiro\n\nQual manter?')
    expect(r.context).toEqual([
      { kind: 'p', text: 'Achei dois arquivos:' },
      { kind: 'item', text: 'Diodos.pdf' },
      { kind: 'item', text: 'Eletronica.pdf' },
      { kind: 'item', text: 'terceiro' },
    ])
    expect(r.question).toBe('Qual manter?')
  })

  it('sem "?" o último parágrafo é a pergunta', () => {
    const r = splitQuestion('Contexto aqui.\n\nEscolha uma das opções abaixo')
    expect(r.context).toEqual([{ kind: 'p', text: 'Contexto aqui.' }])
    expect(r.question).toBe('Escolha uma das opções abaixo')
  })

  it('um parágrafo único sem "?" fica inteiro como pergunta', () => {
    expect(splitQuestion('Escolha o formato do banco.')).toEqual({ context: [], question: 'Escolha o formato do banco.' })
  })

  it('termina em lista: a pergunta é o último parágrafo com "?" e a lista continua no contexto', () => {
    const r = splitQuestion('Qual manter?\n- A\n- B')
    expect(r.question).toBe('Qual manter?')
    expect(r.context).toEqual([
      { kind: 'item', text: 'A' },
      { kind: 'item', text: 'B' },
    ])
  })

  it('termina em lista sem nenhum "?": tudo é contexto', () => {
    const r = splitQuestion('Escolha:\n- A\n- B')
    expect(r.question).toBe('')
    expect(r.context).toHaveLength(3)
  })

  it('ignora quebras de linha do Windows', () => {
    const r = splitQuestion('Contexto.\r\n\r\nPode seguir?')
    expect(r.context.map((b) => b.text)).toEqual(['Contexto.'])
    expect(r.question).toBe('Pode seguir?')
  })

  it('texto muito longo é quebrado em blocos curtos e não perde nada', () => {
    const sentence = 'Esta é uma frase de contexto bem comprida para encher o parágrafo.'
    const long = Array.from({ length: 40 }, () => sentence).join(' ')
    const r = splitQuestion(`${long} Qual caminho seguir?`)
    expect(r.question).toBe('Qual caminho seguir?')
    expect(r.context.length).toBeGreaterThan(3)
    for (const b of r.context) expect(b.text.length).toBeLessThanOrEqual(400)
    expect(r.context.map((b) => b.text).join(' ')).toBe(long)
  })

  it('frases depois do último "?" ficam junto da pergunta', () => {
    const r = splitQuestion('Contexto. Qual manter? Responda rápido.')
    expect(r.question).toBe('Qual manter? Responda rápido.')
    expect(r.context).toEqual([{ kind: 'p', text: 'Contexto.' }])
  })
})
