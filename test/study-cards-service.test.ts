import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { decodeStudyCard } from '../src/shared/study-cards'
import { StudyCardsService } from '../src/main/study-cards'

const roots: string[] = []
const vault = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'study-cards-vault-'))
  roots.push(root)
  return root
}

const note = (id: string, text: string, date = '2026-10-25'): string =>
  `<!-- agent-office-study-note:${id} -->\n## ${date} · q-12345678\nFonte: study sources/probabilidade.md#Eventos:3\n\n${text}\n`

const generated = () => ({
  title: 'Eventos independentes',
  sections: {
    information: 'A probabilidade conjunta é o produto.',
    examplePractice: 'Lançar duas moedas.',
    connections: '',
    sources: '',
    connectionsPending: true,
    sourcesPending: false,
  },
})

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('biblioteca de cartões de estudo', () => {
  it('saves only an approved editable draft with exact snapshots and allows one note to support many cards', async () => {
    const root = vault()
    const notesFile = join(root, 'notas-estudo.md')
    const noteId = 'sn-sc-123-abcdefgh-q-12345678-note1'
    writeFileSync(notesFile, note(noteId, 'Probabilidade conjunta usa eventos independentes.'))
    const interpret = vi.fn(async () => generated())
    const service = new StudyCardsService(root, { generate: interpret })
    const read = service.readNotes()
    expect(read.notes).toHaveLength(1)

    const firstDraft = await service.generateDraft([noteId])
    expect(interpret).toHaveBeenCalledWith([read.notes[0]])
    expect(firstDraft.draft.sourceSnapshots[0]?.text).toContain('Probabilidade conjunta')
    expect(service.listCards().cards).toEqual([])
    const firstCard = service.saveDraft(firstDraft.token, firstDraft.draft)
    expect(firstCard).toMatchObject({ title: 'Eventos independentes', physicalWritten: false, originChanged: false })
    const file = join(root, 'cartoes-estudo', `${firstCard.id}.md`)
    expect(existsSync(file)).toBe(true)
    expect(decodeStudyCard(readFileSync(file, 'utf8')).sourceSnapshots[0]?.text).toBe(read.notes[0]?.text)

    const secondDraft = await service.generateDraft([noteId])
    const secondCard = service.saveDraft(secondDraft.token, { ...secondDraft.draft, title: 'Outro cartão da mesma nota' })
    expect(service.listCards().cards.map((card) => card.id)).toEqual(expect.arrayContaining([firstCard.id, secondCard.id]))
    const originalNote = readFileSync(notesFile, 'utf8')
    const written = service.setPhysicalWritten(firstCard.id, true)
    expect(written.physicalWritten).toBe(true)
    expect(readFileSync(notesFile, 'utf8')).toBe(originalNote)
    expect(readdirSync(join(root, 'cartoes-estudo'))).toContain(`${firstCard.id}.md.bak`)

    writeFileSync(notesFile, note(noteId, 'A nota foi editada depois da criação do cartão.'))
    expect(service.listCards().cards.every((card) => card.originChanged)).toBe(true)
    expect(decodeStudyCard(readFileSync(file, 'utf8')).sourceSnapshots[0]?.text).toBe(read.notes[0]?.text)
  })

  it('refuses to save a draft when a selected source note changed after generation', async () => {
    const root = vault()
    const notesFile = join(root, 'notas-estudo.md')
    const noteId = 'sn-sc-123-abcdefgh-q-12345678-note2'
    writeFileSync(notesFile, note(noteId, 'Versão selecionada.'))
    const service = new StudyCardsService(root, { generate: async () => generated() })
    const draft = await service.generateDraft([noteId])
    writeFileSync(notesFile, note(noteId, 'Versão atualizada no Obsidian.'))
    expect(() => service.saveDraft(draft.token, draft.draft)).toThrow(/mudou desde a geração/i)
    expect(existsSync(join(root, 'cartoes-estudo'))).toBe(false)
  })

  it('does not call the interpreter for missing or duplicated note IDs', async () => {
    const root = vault()
    writeFileSync(join(root, 'notas-estudo.md'), note('sn-sc-123-abcdefgh-q-12345678-note3', 'Nota disponível.'))
    const interpret = vi.fn(async () => generated())
    const service = new StudyCardsService(root, { generate: interpret })
    await expect(service.generateDraft(['sn-missing0000'])).rejects.toThrow(/não existe mais/i)
    await expect(service.generateDraft(['sn-sc-123-abcdefgh-q-12345678-note3', 'sn-sc-123-abcdefgh-q-12345678-note3'])).rejects.toThrow(
      /diferentes/i,
    )
    expect(interpret).not.toHaveBeenCalled()
  })
})
