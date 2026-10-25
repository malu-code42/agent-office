import { describe, expect, it } from 'vitest'
import {
  decodeStudyCard,
  encodeStudyCard,
  setCardPhysicalWritten,
  studyCardSummary,
  studyNoteHash,
  type StudyCard,
} from '../src/shared/study-cards'

const snapshot = (id = 'sn-sc-123-abcdefgh-q-12345678-note1', text = 'A probabilidade conjunta depende dos eventos.') => ({
  id,
  title: '2026-10-25 · q-12345678',
  sourceRef: 'notas-estudo.md#2026-10-25-probabilidade',
  hash: studyNoteHash(text),
  text,
})

const card = (): StudyCard => ({
  id: 'c-card00001',
  title: 'Eventos independentes',
  createdAt: '2026-10-25T12:00:00.000Z',
  physicalWritten: false,
  sourceSnapshots: [snapshot()],
  sections: {
    information: 'A chance simultânea é produto.',
    examplePractice: 'Lançar duas moedas.',
    connections: 'Relaciona-se a espaços amostrais.',
    sources: 'notas-estudo.md#2026-10-25-probabilidade',
    connectionsPending: false,
    sourcesPending: false,
  },
})

describe('cartões Zettelkasten rastreáveis', () => {
  it('preserves four editable sections and exact note snapshot across markdown roundtrip', () => {
    const encoded = encodeStudyCard(card())
    const decoded = decodeStudyCard(encoded)
    expect(decoded).toEqual(card())
    expect(encoded).toContain('## Informação')
    expect(encoded).toContain('## Exemplo/Prática')
    expect(encoded).toContain('## Conexões')
    expect(encoded).toContain('## Fontes')
    expect(encoded).toContain(snapshot().text)
  })

  it('detects manual section edits and reports when a source note version changes', () => {
    const encoded = encodeStudyCard(card()).replace('A chance simultânea é produto.', 'A probabilidade simultânea é o produto das chances.')
    const decoded = decodeStudyCard(encoded)
    expect(decoded.sections.information).toBe('A probabilidade simultânea é o produto das chances.')
    expect(studyCardSummary(decoded, new Map([[decoded.sourceSnapshots[0]!.id, 'f'.repeat(64)]]))).toMatchObject({
      originChanged: true,
      physicalWritten: false,
    })
    expect(studyCardSummary(decoded, new Map([[decoded.sourceSnapshots[0]!.id, decoded.sourceSnapshots[0]!.hash]])).originChanged).toBe(
      false,
    )
  })

  it('marks a physical copy only by an explicit metadata change and leaves card content intact', () => {
    const encoded = encodeStudyCard(card())
    const marked = setCardPhysicalWritten(encoded, true)
    const decoded = decodeStudyCard(marked)
    expect(decoded.physicalWritten).toBe(true)
    expect(decoded.sections).toEqual(card().sections)
    expect(decoded.sourceSnapshots).toEqual(card().sourceSnapshots)
  })

  it('keeps pending connections and sources visible in the saved card and library summary', () => {
    const draft = card()
    draft.sections.connectionsPending = true
    draft.sections.sourcesPending = true
    draft.sections.sources = ''
    const markdown = encodeStudyCard(draft)
    const decoded = decodeStudyCard(markdown)
    expect(markdown).toContain('Revisão pendente: confirmar conexões.')
    expect(markdown).toContain('Revisão pendente: confirmar fontes.')
    expect(markdown).toContain('`notas-estudo.md#2026-10-25-probabilidade`')
    expect(decoded.sections.connectionsPending).toBe(true)
    expect(decoded.sections.sourcesPending).toBe(true)
    expect(decoded.sections.sources).toBe('')
    expect(studyCardSummary(decoded, new Map([[decoded.sourceSnapshots[0]!.id, decoded.sourceSnapshots[0]!.hash]]))).toMatchObject({
      connectionsPending: true,
      sourcesPending: true,
    })
  })

  it('rejects an edited snapshot or missing required card sections', () => {
    expect(() => encodeStudyCard({ ...card(), sourceSnapshots: [{ ...snapshot(), text: 'conteúdo alterado' }] })).toThrow(/snapshot/i)
    expect(() => encodeStudyCard({ ...card(), sections: { ...card().sections, information: '' } })).toThrow(/Informação/i)
    expect(() => encodeStudyCard({ ...card(), sections: { ...card().sections, information: '<script>alert(1)</script>' } })).toThrow(
      /seção information/i,
    )
  })
})
