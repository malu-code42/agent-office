import { createHash, randomUUID } from 'node:crypto'
import { closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readSync, readdirSync, realpathSync } from 'node:fs'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  decodeStudyCard,
  encodeStudyCard,
  setCardPhysicalWritten,
  studyCardSummary,
  studyNoteHash,
  validateStudyCardDraft,
  type StudyCard,
  type StudyCardDraft,
  type StudyCardSummary,
  type StudyCardsRead,
  type StudyNoteSnapshot,
  type StudyNotesRead,
} from '@shared/study-cards'
import { writeFileAtomicChecked } from './fs-safe'

const NOTES_FILE = 'notas-estudo.md'
const CARDS_DIRECTORY = 'cartoes-estudo'
const NOTES_LIMIT = 16 * 1024 * 1024
const CARD_LIMIT = 2 * 1024 * 1024
const CARD_COUNT_LIMIT = 1000
const CARD_TOTAL_LIMIT = 32 * 1024 * 1024
const DRAFT_TTL = 10 * 60_000

export interface StudyCardInterpreter {
  generate(notes: StudyNoteSnapshot[]): Promise<Omit<StudyCardDraft, 'sourceSnapshots'>>
}

interface DraftSnapshot {
  notes: StudyNoteSnapshot[]
  expiresAt: number
}

/** Obsidian card documents remain independent from the study cycle and its learning gates. */
export class StudyCardsService {
  private readonly vault: string
  private readonly drafts = new Map<string, DraftSnapshot>()

  constructor(
    vault: string,
    private readonly interpreter: StudyCardInterpreter,
  ) {
    this.vault = realpathSync(resolve(vault))
  }

  readNotes(): StudyNotesRead {
    const file = join(this.vault, NOTES_FILE)
    if (!existsSync(file)) return { notes: [], warning: 'Ainda não há notas em notas-estudo.md.' }
    const text = this.readVaultFile(file, NOTES_LIMIT)
    return parseStudyNotes(text)
  }

  async generateDraft(noteIds: string[]): Promise<{ token: string; draft: StudyCardDraft }> {
    if (!Array.isArray(noteIds) || noteIds.length < 1 || noteIds.length > 20 || new Set(noteIds).size !== noteIds.length)
      throw new Error('Selecione de uma a vinte notas diferentes.')
    const current = this.readNotes().notes
    const selected = noteIds.map((id) => {
      const note = current.find((candidate) => candidate.id === id)
      if (!note) throw new Error('Uma nota selecionada mudou ou não existe mais. Recarregue a biblioteca.')
      return note
    })
    const generated = await this.interpreter.generate(selected)
    const draft = validateStudyCardDraft({ ...generated, sourceSnapshots: selected })
    const token = randomUUID()
    this.drafts.set(token, { notes: selected, expiresAt: Date.now() + DRAFT_TTL })
    if (this.drafts.size > 100) this.drafts.delete(this.drafts.keys().next().value!)
    return { token, draft }
  }

  draftSources(token: string): StudyNoteSnapshot[] {
    const snapshot = this.drafts.get(token)
    if (!snapshot || snapshot.expiresAt < Date.now()) throw new Error('O rascunho expirou. Gere outro antes de salvar.')
    return snapshot.notes
  }

  saveDraft(token: string, input: unknown): StudyCardSummary {
    const snapshot = this.drafts.get(token)
    if (!snapshot || snapshot.expiresAt < Date.now()) throw new Error('O rascunho expirou. Selecione as notas e gere outro rascunho.')
    const currentNotes = this.readNotes().notes
    for (const selected of snapshot.notes) {
      const current = currentNotes.find((note) => note.id === selected.id)
      if (!current || current.hash !== selected.hash)
        throw new Error('Uma nota de origem mudou desde a geração. Recarregue a biblioteca e gere um rascunho atualizado.')
    }
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Rascunho de cartão inválido.')
    const draft = validateStudyCardDraft({ ...(input as Record<string, unknown>), sourceSnapshots: snapshot.notes })
    const createdAt = new Date().toISOString()
    const card: StudyCard = {
      id: `c-${randomUUID()}`,
      title: draft.title,
      createdAt,
      physicalWritten: false,
      sourceSnapshots: snapshot.notes,
      sections: draft.sections,
    }
    const markdown = encodeStudyCard(card)
    const dir = this.cardDirectory(true)
    if (!dir) throw new Error('Não foi possível criar a pasta cartoes-estudo.')
    const path = join(dir, `${card.id}.md`)
    writeFileAtomicChecked(
      path,
      markdown,
      () => {
        if (existsSync(path)) throw new Error('O arquivo do cartão já existe. Gere outro rascunho antes de salvar.')
        const latest = this.readNotes().notes
        if (snapshot.notes.some((note) => latest.find((candidate) => candidate.id === note.id)?.hash !== note.hash))
          throw new Error('Uma nota de origem mudou durante o salvamento. O cartão não foi gravado.')
      },
      `.tmp-${randomUUID()}`,
    )
    this.drafts.delete(token)
    return studyCardSummary(card, new Map(snapshot.notes.map((note) => [note.id, note.hash])))
  }

  listCards(): StudyCardsRead {
    const dir = this.cardDirectory(false)
    if (!dir) return { cards: [] }
    const files = readdirSync(dir)
      .filter((name) => name.endsWith('.md'))
      .sort()
    if (files.length > CARD_COUNT_LIMIT)
      return { cards: [], warning: `A pasta de cartões excede o limite seguro de ${CARD_COUNT_LIMIT} documentos.` }
    const currentNotes = new Map(this.readNotes().notes.map((note) => [note.id, note.hash]))
    const cards: StudyCardSummary[] = []
    let totalBytes = 0
    for (const name of files) {
      const path = join(dir, name)
      try {
        const info = lstatSync(path)
        if (info.isSymbolicLink() || !info.isFile() || !inside(dir, realpathSync(path))) throw new Error('Arquivo de cartão inseguro.')
        totalBytes += info.size
        if (info.size > CARD_LIMIT || totalBytes > CARD_TOTAL_LIMIT)
          return { cards: [], warning: 'A biblioteca de cartões excedeu o limite de leitura; organize a pasta antes de continuar.' }
        const card = decodeStudyCard(this.readVaultFile(path, CARD_LIMIT))
        if (basename(name, '.md') !== card.id) continue
        cards.push(studyCardSummary(card, currentNotes))
      } catch {
        // Preserve malformed/manual documents and omit them from the app's managed-card list.
      }
    }
    return { cards }
  }

  setPhysicalWritten(cardId: string, written: boolean): StudyCardSummary {
    if (!/^c-[a-z0-9-]{8,80}$/i.test(cardId)) throw new Error('Identificador de cartão inválido.')
    const dir = this.cardDirectory(false)
    if (!dir) throw new Error('A biblioteca de cartões não existe.')
    const path = join(dir, `${cardId}.md`)
    const current = this.readVaultFile(path, CARD_LIMIT)
    const card = decodeStudyCard(current)
    if (card.id !== cardId) throw new Error('O cartão solicitado não corresponde ao arquivo.')
    if (card.physicalWritten === written) return studyCardSummary(card, new Map(this.readNotes().notes.map((note) => [note.id, note.hash])))
    const backupPath = `${path}.bak`
    if (existsSync(backupPath)) this.readVaultFile(backupPath, CARD_LIMIT)
    writeFileAtomicChecked(backupPath, current, () => {}, `.tmp-${randomUUID()}`)
    const updated = setCardPhysicalWritten(current, written)
    const expectedHash = hash(current)
    writeFileAtomicChecked(
      path,
      updated,
      () => {
        if (hash(this.readVaultFile(path, CARD_LIMIT)) !== expectedHash)
          throw new Error('O cartão mudou no Obsidian; sua edição foi preservada. Tente novamente.')
      },
      `.tmp-${randomUUID()}`,
    )
    const next = decodeStudyCard(updated)
    return studyCardSummary(next, new Map(this.readNotes().notes.map((note) => [note.id, note.hash])))
  }

  private cardDirectory(create: boolean): string | undefined {
    const dir = join(this.vault, CARDS_DIRECTORY)
    if (!existsSync(dir)) {
      if (!create) return undefined
      mkdirSync(dir)
    }
    const info = lstatSync(dir)
    if (info.isSymbolicLink() || !info.isDirectory() || !inside(this.vault, realpathSync(dir)))
      throw new Error('A pasta cartoes-estudo precisa ser um diretório local seguro.')
    return realpathSync(dir)
  }

  private readVaultFile(path: string, maxBytes: number): string {
    let fd: number | undefined
    try {
      const noFollow = (constants as typeof constants & { O_NOFOLLOW?: number }).O_NOFOLLOW ?? 0
      fd = openSync(path, constants.O_RDONLY | noFollow)
      const opened = fstatSync(fd)
      const linked = lstatSync(path)
      if (
        !opened.isFile() ||
        linked.isSymbolicLink() ||
        !linked.isFile() ||
        opened.dev !== linked.dev ||
        opened.ino !== linked.ino ||
        !inside(this.vault, realpathSync(path))
      )
        throw new Error('O arquivo precisa ser regular e estar dentro do vault.')
      if (opened.size > maxBytes) throw new Error('O arquivo excede o limite seguro de leitura.')
      const buffer = Buffer.allocUnsafe(opened.size)
      let offset = 0
      while (offset < buffer.length) {
        const read = readSync(fd, buffer, offset, buffer.length - offset, offset)
        if (!read) throw new Error('O arquivo mudou durante a leitura.')
        offset += read
      }
      const after = fstatSync(fd)
      if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) throw new Error('O arquivo mudou durante a leitura.')
      return buffer.toString('utf8')
    } finally {
      if (fd !== undefined) closeSync(fd)
    }
  }
}

export function parseStudyNotes(markdown: string): StudyNotesRead {
  if (Buffer.byteLength(markdown, 'utf8') > NOTES_LIMIT) throw new Error('notas-estudo.md excede o limite seguro de 16 MiB.')
  const markers = [...markdown.matchAll(/^<!-- agent-office-study-note:(sn-[a-z0-9-]{8,150}) -->\s*$/gm)]
  const notes: StudyNoteSnapshot[] = []
  const ids = new Set<string>()
  for (let index = 0; index < markers.length; index++) {
    const marker = markers[index]!
    const start = marker.index!
    const end = markers[index + 1]?.index ?? markdown.length
    const text = markdown.slice(start, end).trimEnd()
    const sourceRef = /^Fonte:\s*(.+)$/m.exec(text)?.[1]?.trim()
    const title = /^##\s+(.+)$/m.exec(text)?.[1]?.trim()
    if (!sourceRef || !title || text.length > 20_000) continue
    const id = marker[1]!
    if (ids.has(id)) continue
    ids.add(id)
    notes.push({ id, title, sourceRef, hash: studyNoteHash(text), text })
  }
  return {
    notes,
    ...(markers.length && !notes.length ? { warning: 'As notas não têm marcadores válidos; crie notas pelo fluxo de estudo.' } : {}),
  }
}

function hash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

const inside = (root: string, path: string): boolean => {
  const rel = relative(root, path)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
}
