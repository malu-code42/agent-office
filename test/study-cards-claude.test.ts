import { describe, expect, it } from 'vitest'
import { parseStudyCardAssistResponse } from '../src/main/study-cards-claude'

const base = { connections: '', sources: '', connectionsPending: true, sourcesPending: true, feedback: 'Cite a fonte.' }

describe('resposta estruturada da ajuda ao cartão', () => {
  it('accepts exactly connections, sources, review flags and feedback', () => {
    expect(parseStudyCardAssistResponse(JSON.stringify(base))).toEqual(base)
  })

  it('rejects commentary, extra fields (such as rewritten student text) and malformed JSON', () => {
    expect(() => parseStudyCardAssistResponse(`${JSON.stringify(base)}\nExtra`)).toThrow(/JSON válido/i)
    expect(() => parseStudyCardAssistResponse(JSON.stringify({ ...base, information: 'texto reescrito' }))).toThrow(/incompleta/i)
  })
})
