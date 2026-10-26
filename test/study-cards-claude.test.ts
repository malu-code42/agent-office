import { describe, expect, it } from 'vitest'
import { parseStudyCardDraftResponse } from '../src/main/study-cards-claude'

describe('resposta estruturada do rascunho de cartão', () => {
  it('accepts exactly the four card sections and explicit review flags', () => {
    expect(
      parseStudyCardDraftResponse(
        JSON.stringify({
          title: 'Eventos independentes',
          sections: {
            information: 'Produto das probabilidades.',
            examplePractice: 'Lançar duas moedas.',
            connections: '',
            sources: '',
            connectionsPending: true,
            sourcesPending: true,
          },
        }),
      ),
    ).toMatchObject({ title: 'Eventos independentes', sections: { connectionsPending: true, sourcesPending: true } })
  })

  it('rejects commentary, extra fields and malformed JSON instead of saving a draft', () => {
    const base = {
      title: 'Eventos independentes',
      sections: {
        information: 'Produto das probabilidades.',
        examplePractice: 'Lançar duas moedas.',
        connections: '',
        sources: '',
        connectionsPending: true,
        sourcesPending: true,
      },
    }
    expect(() => parseStudyCardDraftResponse(`${JSON.stringify(base)}\nExtra`)).toThrow(/JSON válido/i)
    expect(() => parseStudyCardDraftResponse(JSON.stringify({ ...base, extra: true }))).toThrow(/incompleto/i)
  })
})
