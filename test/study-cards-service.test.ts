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

const authored = { title: 'Eventos independentes', information: 'A probabilidade conjunta é o produto.', examplePractice: 'Lançar duas moedas.' }
const draft = (title = authored.title) => ({
  title,
  sections: { ...authored, connections: '', sources: '', connectionsPending: true, sourcesPending: false },
})
const noAssist = { assist: async () => ({ connections: '', sources: '', connectionsPending: true, sourcesPending: true, feedback: '' }) }

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('biblioteca de cartões de estudo', () => {
  it('saves only an approved editable draft with exact snapshots and allows one note to support many cards', () => {
    const root = vault()
    const notesFile = join(root, 'notas-estudo.md')
    const noteId = 'sn-sc-123-abcdefgh-q-12345678-note1'
    writeFileSync(notesFile, note(noteId, 'Probabilidade conjunta usa eventos independentes.'))
    const service = new StudyCardsService(root, noAssist)
    const read = service.readNotes()
    expect(read.notes).toHaveLength(1)

    const firstDraft = service.startDraft([noteId])
    expect(firstDraft.sourceSnapshots[0]?.text).toContain('Probabilidade conjunta')
    expect(service.listCards().cards).toEqual([])
    const firstCard = service.saveDraft(firstDraft.token, draft())
    expect(firstCard).toMatchObject({ title: 'Eventos independentes', physicalWritten: false, originChanged: false })
    const file = join(root, 'cartoes-estudo', `${firstCard.id}.md`)
    expect(existsSync(file)).toBe(true)
    expect(decodeStudyCard(readFileSync(file, 'utf8')).sourceSnapshots[0]?.text).toBe(read.notes[0]?.text)

    const secondDraft = service.startDraft([noteId])
    const secondCard = service.saveDraft(secondDraft.token, draft('Outro cartão da mesma nota'))
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

  it('refuses to save a draft when a selected source note changed after it started', () => {
    const root = vault()
    const notesFile = join(root, 'notas-estudo.md')
    const noteId = 'sn-sc-123-abcdefgh-q-12345678-note2'
    writeFileSync(notesFile, note(noteId, 'Versão selecionada.'))
    const service = new StudyCardsService(root, noAssist)
    const started = service.startDraft([noteId])
    writeFileSync(notesFile, note(noteId, 'Versão atualizada no Obsidian.'))
    expect(() => service.saveDraft(started.token, draft())).toThrow(/mudou desde a geração/i)
    expect(existsSync(join(root, 'cartoes-estudo'))).toBe(false)
  })

  it('rejects missing or duplicated note IDs before anything starts', () => {
    const root = vault()
    writeFileSync(join(root, 'notas-estudo.md'), note('sn-sc-123-abcdefgh-q-12345678-note3', 'Nota disponível.'))
    const service = new StudyCardsService(root, noAssist)
    expect(() => service.startDraft(['sn-missing0000'])).toThrow(/não existe mais/i)
    expect(() => service.startDraft(['sn-sc-123-abcdefgh-q-12345678-note3', 'sn-sc-123-abcdefgh-q-12345678-note3'])).toThrow(/diferentes/i)
  })

  it('sends the student text with only known wikilinks and drops invented links', async () => {
    const root = vault()
    const noteId = 'sn-sc-123-abcdefgh-q-12345678-note4'
    writeFileSync(join(root, 'notas-estudo.md'), note(noteId, 'Nota para conectar.'))
    const heading = '[[notas-estudo#2026-10-25 · q-12345678]]'
    const assist = vi.fn(async () => ({
      connections: `Relaciona com ${heading} e com [[inventado]].`,
      sources: 'Fonte: study sources/probabilidade.md#Eventos:3',
      connectionsPending: false,
      sourcesPending: false,
      feedback: ' Dê um exemplo numérico. ',
    }))
    const service = new StudyCardsService(root, { assist })
    const started = service.startDraft([noteId])
    const result = await service.assist(started.token, authored)
    expect(assist).toHaveBeenCalledWith(started.sourceSnapshots, authored, [heading])
    expect(result.connections).toContain(heading)
    expect(result.connections).not.toContain('inventado')
    expect(result).toMatchObject({ connectionsPending: true, sourcesPending: false, feedback: 'Dê um exemplo numérico.' })
    await expect(service.assist(started.token, { ...authored, information: '' })).rejects.toThrow(/Informação/i)
  })
})
