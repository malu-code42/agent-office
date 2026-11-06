import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decodeStudyCard } from '../src/shared/study-cards'
import type { StudyReadiness, StudyReadinessState } from '../src/shared/study-readiness'
import { parseStudyTrail } from '../src/shared/study-trail'
import { StudyCardsService } from '../src/main/study-cards'
import type { ReadinessSource } from '../src/main/study-readiness'

const roots: string[] = []
const vault = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'study-cards-vault-'))
  roots.push(root)
  return root
}

const TRAIL = parseStudyTrail('## 2º período\n### [P2-HW] Hardware I — 60 h\n- [ ] [P2-HW-01] Circuitos elétricos.')
const LABEL = TRAIL.topics[0]!.label
const reportWith = (state: StudyReadinessState): Record<string, StudyReadiness> => ({
  'P2-HW': {
    discipline: 'P2-HW',
    builtAt: 1,
    topics: [{ id: 'P2-HW-01', topic: 'Circuitos elétricos', state, reason: 'Só 2 trecho(s).', folders: [] }],
  },
})
let reports = reportWith('pronto')
const readiness: ReadinessSource = { trail: () => TRAIL, reports: () => reports }

const note = (id: string, text: string, date = '2026-10-25', topic: string | null = LABEL): string =>
  `<!-- agent-office-study-note:${id} -->\n## ${date} · q-12345678\nFonte: study sources/probabilidade.md#Eventos:3\n${topic ? `Tópico: ${topic}\n` : ''}\n${text}\n`

const authored = {
  title: 'Eventos independentes',
  information: 'A probabilidade conjunta é o produto.',
  examplePractice: 'Lançar duas moedas.',
  application: 'Estimar chutes seguidos.',
}
const draft = (title = authored.title) => ({
  title,
  sections: { ...authored, connections: '', sources: '', connectionsPending: true, sourcesPending: false },
})
const noAssist = { assist: async () => ({ connections: '', sources: '', connectionsPending: true, sourcesPending: true, feedback: '' }) }

beforeEach(() => {
  reports = reportWith('pronto')
})

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('biblioteca de cartões de estudo', () => {
  it('saves only an approved editable draft with exact snapshots and allows one note to support many cards', () => {
    const root = vault()
    const notesFile = join(root, 'notas-estudo.md')
    const noteId = 'sn-sc-123-abcdefgh-q-12345678-note1'
    writeFileSync(notesFile, note(noteId, 'Probabilidade conjunta usa eventos independentes.'))
    const service = new StudyCardsService(root, noAssist, readiness)
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
    const service = new StudyCardsService(root, noAssist, readiness)
    const started = service.startDraft([noteId])
    writeFileSync(notesFile, note(noteId, 'Versão atualizada no Obsidian.'))
    expect(() => service.saveDraft(started.token, draft())).toThrow(/mudou desde a geração/i)
    expect(existsSync(join(root, 'cartoes-estudo'))).toBe(false)
  })

  it('rejects missing or duplicated note IDs before anything starts', () => {
    const root = vault()
    writeFileSync(join(root, 'notas-estudo.md'), note('sn-sc-123-abcdefgh-q-12345678-note3', 'Nota disponível.'))
    const service = new StudyCardsService(root, noAssist, readiness)
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
    const service = new StudyCardsService(root, { assist }, readiness)
    const started = service.startDraft([noteId])
    const result = await service.assist(started.token, authored)
    expect(assist).toHaveBeenCalledWith(started.sourceSnapshots, authored, [heading])
    expect(result.connections).toContain(heading)
    expect(result.connections).not.toContain('inventado')
    expect(result).toMatchObject({ connectionsPending: true, sourcesPending: false, feedback: 'Dê um exemplo numérico.' })
    await expect(service.assist(started.token, { ...authored, information: '' })).rejects.toThrow(/Informação/i)
  })

  it('does not start or assist a card from a locked topic, and says why', async () => {
    const root = vault()
    const noteId = 'sn-sc-123-abcdefgh-q-12345678-note7'
    writeFileSync(join(root, 'notas-estudo.md'), note(noteId, 'Nota de tópico travado.'))
    const assist = vi.fn(async () => ({ connections: '', sources: '', connectionsPending: true, sourcesPending: true, feedback: '' }))
    const service = new StudyCardsService(root, { assist }, readiness)

    reports = reportWith('poucos-trechos')
    expect(() => service.startDraft([noteId])).toThrow(/ainda não está pronto: Só 2 trecho/)

    reports = reportWith('pronto')
    const started = service.startDraft([noteId])
    reports = reportWith('sem-fonte')
    await expect(service.assist(started.token, authored)).rejects.toThrow(/ainda não está pronto/)
    expect(assist).not.toHaveBeenCalled()
  })

  it('refuses to save a card when the topic was locked after the draft started', () => {
    const root = vault()
    const noteId = 'sn-sc-123-abcdefgh-q-12345678-note10'
    writeFileSync(join(root, 'notas-estudo.md'), note(noteId, 'Nota de tópico que trava depois.'))
    const service = new StudyCardsService(root, noAssist, readiness)
    const started = service.startDraft([noteId])
    reports = reportWith('poucos-trechos')
    expect(() => service.saveDraft(started.token, draft())).toThrow(/ainda não está pronto: Só 2 trecho/)
    expect(existsSync(join(root, 'cartoes-estudo'))).toBe(false)
  })

  it('does not start or assist a card using the readiness of another topic with the same title', async () => {
    const root = vault()
    const twinTrail = parseStudyTrail(
      '## 2º período\n### [P2-HW] Hardware I — 60 h\n- [ ] [P2-HW-01] Circuitos elétricos.\n- [ ] [P2-HW-02] Circuitos elétricos.',
    )
    const readyId = 'sn-sc-123-abcdefgh-q-12345678-ready'
    const lockedId = 'sn-sc-123-abcdefgh-q-12345678-locked'
    const legacyId = 'sn-sc-123-abcdefgh-q-12345678-legacy'
    writeFileSync(
      join(root, 'notas-estudo.md'),
      [
        note(readyId, 'Pronto.', '2026-10-25', twinTrail.topics[0]!.label),
        note(lockedId, 'Travado.', '2026-10-25', twinTrail.topics[1]!.label),
        note(legacyId, 'Legado.', '2026-10-25', 'Circuitos elétricos'),
      ].join('\n'),
    )
    reports['P2-HW']!.topics.push({ ...reports['P2-HW']!.topics[0]!, id: 'P2-HW-02', state: 'sem-fonte' })
    const assist = vi.fn(noAssist.assist)
    const service = new StudyCardsService(root, { assist }, { trail: () => twinTrail, reports: () => reports })
    expect(() => service.startDraft([readyId])).not.toThrow()
    expect(() => service.startDraft([lockedId])).toThrow(/ainda não está pronto/)
    expect(() => service.startDraft([legacyId])).toThrow(/mais de|repetido/)
    const started = service.startDraft([readyId])
    reports['P2-HW']!.topics = [reports['P2-HW']!.topics[1]!]
    await expect(service.assist(started.token, authored)).rejects.toThrow(/não está no relatório/)
    expect(assist).not.toHaveBeenCalled()
    expect(() => service.saveDraft(started.token, draft())).toThrow(/não está no relatório/)
  })

  it('does not start a card without a readiness report or from a note without topic', () => {
    const root = vault()
    const noteId = 'sn-sc-123-abcdefgh-q-12345678-note8'
    const noTopicId = 'sn-sc-123-abcdefgh-q-12345678-note9'
    writeFileSync(join(root, 'notas-estudo.md'), `${note(noteId, 'Sem relatório.')}\n${note(noTopicId, 'Sem tópico.', '2026-10-25', null)}`)
    const service = new StudyCardsService(root, noAssist, readiness)
    reports = {}
    expect(() => service.startDraft([noteId])).toThrow(/relatório de prontidão/)
    reports = reportWith('pronto')
    expect(() => service.startDraft([noTopicId])).toThrow(/não tem tópico/)
    expect(existsSync(join(root, 'cartoes-estudo'))).toBe(false)
  })

  it('reads the topic of a note, and a saved card is listed under it and can be opened whole', () => {
    const root = vault()
    const withTopic = 'sn-sc-123-abcdefgh-q-12345678-note5'
    const without = 'sn-sc-123-abcdefgh-q-12345678-note6'
    writeFileSync(join(root, 'notas-estudo.md'), `${note(withTopic, 'Com tópico.')}\n${note(without, 'Sem tópico.', '2026-10-25', null)}`)
    const service = new StudyCardsService(root, noAssist, readiness)
    expect(service.readNotes().notes.map((item) => item.topic)).toEqual([LABEL, undefined])
    const started = service.startDraft([withTopic])
    const saved = service.saveDraft(started.token, draft())
    expect(service.listCards().cards[0]).toMatchObject({ id: saved.id, topic: LABEL })
    expect(service.readCard(saved.id).sections.application).toBe(authored.application)
    expect(() => service.readCard('../fora')).toThrow(/inválido/i)
  })
})
