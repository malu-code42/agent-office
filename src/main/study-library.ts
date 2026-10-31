import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  opendirSync,
  readFileSync,
  readSync,
  realpathSync,
} from 'node:fs'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import { writeFileAtomicChecked } from './fs-safe'
import type { StudyNoteWriter } from './study-cycle'
import { scoreStudyText, studySnippet, tokenizeStudyQuery, type StudyLibraryHit, type StudyLibrarySearch } from '@shared/study-library'
import { pptxText } from './study-source-text'

const SOURCE_DIR = 'study sources'
const NOTE_FILE = 'notas-estudo.md'
const MAX_PATHS = 2000
const MAX_DEPTH = 12
const MAX_FILE_BYTES = 1024 * 1024
const MAX_TOTAL_BYTES = 128 * 1024 * 1024
const MAX_HITS = 30
const MAX_HITS_PER_FILE = 4
/** A deck is a zip of slides: it can be large on disk (images) for little text. */
const MAX_DECK_BYTES = 64 * 1024 * 1024
const TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.txt'])
const IGNORED_FILES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini'])
const TOO_BIG = 'Fonte local grande demais.'
const MAX_SNIPPET = 1400

interface Snapshot {
  hits: Map<string, StudyLibraryHit>
  expiresAt: number
}

const inside = (root: string, path: string): boolean => {
  const rel = relative(root, path)
  return rel === '' || (!isAbsolutePath(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
}

const isAbsolutePath = (path: string): boolean => path.startsWith(sep) || /^[A-Za-z]:[\\/]/.test(path)

/** Local-only source retrieval for Cora. It never invokes a model or sends file contents off-device. */
export class StudyLibrary {
  private readonly vault: string
  private readonly sourceRoot: string
  private readonly snapshots = new Map<string, Snapshot>()

  constructor(vault: string) {
    this.vault = realpathSync(resolve(vault))
    this.sourceRoot = join(this.vault, SOURCE_DIR)
  }

  search(query: string): StudyLibrarySearch {
    const parsed = tokenizeStudyQuery(query)
    if (!parsed.terms.length || query.length > 200) throw new Error('Informe um tópico de até 200 caracteres.')
    const root = this.checkedSourceRoot()
    if (!root) return { token: randomUUID(), query, complete: true, hits: [], warning: 'A pasta local de estudos ainda não existe.' }
    const { paths, complete: walked } = walkSources(root)
    paths.sort((a, b) => relative(root, a).localeCompare(relative(root, b), 'pt-BR'))

    let totalBytes = 0
    let overBudget = false
    const byName = new Map<string, number>()
    const tooBig: string[] = []
    let unreadable = 0
    const hits: StudyLibraryHit[] = []
    const add = (path: string, heading: string, line: number, excerpt: string, score: number) => {
      const relativePath = relative(this.vault, path).split(sep).join('/')
      const sourceRef = line ? `${relativePath}${heading ? `#${heading}` : ''}:${line}` : `${relativePath}${heading ? `#${heading}` : ''}`
      hits.push({
        id: createHash('sha256').update(sourceRef).digest('hex').slice(0, 20),
        sourceRef,
        title: heading || basename(path),
        excerpt: excerpt.slice(0, MAX_SNIPPET),
        line,
        score,
      })
    }
    for (const path of paths) {
      const ext = extname(path).toLowerCase()
      const kind = TEXT_EXTENSIONS.has(ext) ? 'text' : ext === '.pptx' ? 'pptx' : null
      // Every file is found by its name and folders ("Estrutura de Dados/Aula 05 Filas.pdf").
      const nameScore = scoreStudyText(relative(root, path), parsed)
      let text: string | null = null
      if (!kind) byName.set(ext || 'sem extensão', (byName.get(ext || 'sem extensão') ?? 0) + 1)
      else if (overBudget) tooBig.push(basename(path))
      else {
        try {
          const content = readLocalStudyFile(path, root, kind === 'text' ? MAX_FILE_BYTES : MAX_DECK_BYTES)
          if (content.size + totalBytes > MAX_TOTAL_BYTES) {
            overBudget = true
            tooBig.push(basename(path))
          } else {
            totalBytes += content.size
            text = kind === 'text' ? content.buffer.toString('utf8') : pptxText(content.buffer)
          }
        } catch (error) {
          if (error instanceof Error && error.message === TOO_BIG) tooBig.push(basename(path))
          else unreadable++
        }
      }
      let fileHits = 0
      if (text !== null) {
        const lines = text.split(/\r?\n/)
        const found: { heading: string; line: number; excerpt: string; score: number }[] = []
        let heading = ''
        for (let index = 0; index < lines.length; index++) {
          const line = lines[index]!
          // A heading is not a passage: it names (and scores with) the paragraphs under it.
          if (/^#{1,6}\s/.test(line)) {
            heading = line.replace(/^#{1,6}\s*/, '').trim()
            continue
          }
          if (!line.trim()) continue
          const paragraph = paragraphAt(lines, index)
          const score = scoreStudyText(`${heading} ${paragraph}`, parsed)
          if (score) found.push({ heading, line: index + 1, excerpt: studySnippet(paragraph, parsed), score: score + nameScore / 10 })
          index = Math.max(index, paragraphEnd(lines, index))
        }
        // The best passages of each file, so one long file does not push the others out.
        for (const f of found.sort((a, b) => b.score - a.score).slice(0, MAX_HITS_PER_FILE))
          // A slide is cited by its number; the line of the extracted text means nothing in the deck.
          add(path, f.heading, kind === 'pptx' ? 0 : f.line, f.excerpt, f.score)
        fileHits = Math.min(found.length, MAX_HITS_PER_FILE)
      }
      if (!fileHits && nameScore) {
        const folder = relative(root, dirname(path)).split(sep).join(' / ')
        const note =
          text !== null
            ? 'O nome corresponde; o conteúdo não cita os termos.'
            : 'Encontrado pelo nome; Cora não lê o conteúdo deste formato.'
        add(path, '', 0, `${folder ? `${folder} · ` : ''}${note}`, nameScore)
      }
    }
    hits.sort((a, b) => b.score - a.score || a.sourceRef.localeCompare(b.sourceRef, 'pt-BR'))
    const warnings: string[] = []
    if (byName.size) {
      const formats = [...byName].map(([ext, n]) => `${n} ${ext.replace(/^\./, '').toUpperCase()}`).join(', ')
      warnings.push(`Arquivos buscados só pelo nome (${formats}): Cora lê o conteúdo de .md, .txt e .pptx.`)
    }
    if (tooBig.length) warnings.push(`${tooBig.length} arquivo(s) passaram do limite de leitura e foram buscados só pelo nome.`)
    if (unreadable) warnings.push(`${unreadable} arquivo(s) não puderam ser lidos.`)
    if (!walked) warnings.push('Algumas pastas ou atalhos não foram percorridos.')
    return this.remember(
      hits.slice(0, MAX_HITS),
      walked && !byName.size && !tooBig.length && !unreadable,
      query,
      warnings.join(' ') || undefined,
    )
  }

  source(token: string, hitId: string): StudyLibraryHit {
    const snapshot = this.snapshots.get(token)
    if (!snapshot || snapshot.expiresAt < Date.now()) throw new Error('A busca da Cora expirou. Pesquise novamente.')
    const hit = snapshot.hits.get(hitId)
    if (!hit) throw new Error('A fonte não pertence à busca local atual.')
    return hit
  }

  private checkedSourceRoot(): string | undefined {
    if (!existsSync(this.sourceRoot)) return undefined
    const info = lstatSync(this.sourceRoot)
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('A pasta local de estudos não é segura.')
    const root = realpathSync(this.sourceRoot)
    if (!inside(this.vault, root)) throw new Error('A pasta local de estudos está fora do vault.')
    return root
  }

  private remember(hits: StudyLibraryHit[], complete: boolean, query: string, warning?: string): StudyLibrarySearch {
    const token = randomUUID()
    this.snapshots.set(token, { hits: new Map(hits.map((hit) => [hit.id, hit])), expiresAt: Date.now() + 5 * 60_000 })
    if (this.snapshots.size > 100) this.snapshots.delete(this.snapshots.keys().next().value!)
    return { token, query, complete, hits, ...(warning ? { warning } : {}) }
  }
}

/** Appends a user-authored study note without replacing vault edits made after the note was opened. */
export class StudyNotesWriter implements StudyNoteWriter {
  private readonly root: string
  private readonly file: string

  constructor(vault: string) {
    this.root = realpathSync(resolve(vault))
    this.file = join(this.root, NOTE_FILE)
  }

  write(input: { id: string; gapQuestionId: string; sourceRef: string; text: string; savedAt?: number }) {
    const { id, gapQuestionId, sourceRef } = input
    const text = input.text.trim()
    if (!/^sn-[a-z0-9-]{8,150}$/i.test(id) || !/^q-[a-z0-9-]{8,72}$/i.test(gapQuestionId))
      throw new Error('Identificador de nota inválido.')
    if (!text || text.length > 10_000 || /\0/.test(text)) throw new Error('A nota deve ter até 10.000 caracteres.')
    if (!sourceRef || sourceRef.length > 1000 || /[\r\n\0]/.test(sourceRef)) throw new Error('Referência de fonte inválida.')
    const savedAt = input.savedAt ?? Date.now()
    const marker = `<!-- agent-office-study-note:${id} -->`
    const current = this.readCurrent()
    if (current.includes(marker)) return { ...input, text, savedAt }
    const date = new Date(savedAt).toISOString().slice(0, 10)
    const append = [marker, `## ${date} · ${gapQuestionId}`, `Fonte: ${sourceRef}`, '', text, ''].join('\n')
    const prefix = current ? (current.endsWith('\n') ? '\n' : '\n\n') : '# Notas de estudo\n\n'
    if (Buffer.byteLength(current + prefix + append, 'utf8') > 16 * 1024 * 1024)
      throw new Error('O arquivo notas-estudo.md excedeu o limite seguro de 16 MiB.')
    if (current) {
      const backup = `${this.file}.bak`
      if (existsSync(backup)) {
        const backupInfo = lstatSync(backup)
        if (backupInfo.isSymbolicLink() || !backupInfo.isFile() || !inside(this.root, realpathSync(backup)))
          throw new Error('O backup de notas-estudo.md não é um arquivo seguro.')
      }
      writeFileAtomicChecked(backup, current, () => {}, `.tmp-${randomUUID()}`)
    }
    const expectedHash = hash(current)
    writeFileAtomicChecked(
      this.file,
      current + prefix + append,
      () => {
        if (hash(this.readCurrent()) !== expectedHash)
          throw new Error('notas-estudo.md mudou no Obsidian; sua edição foi preservada. Tente novamente.')
      },
      `.tmp-${randomUUID()}`,
    )
    return { id, gapQuestionId, sourceRef, text, savedAt }
  }

  private readCurrent(): string {
    if (!existsSync(this.file)) return ''
    const info = lstatSync(this.file)
    if (info.isSymbolicLink() || !info.isFile() || !inside(this.root, realpathSync(this.file)))
      throw new Error('notas-estudo.md não é um arquivo regular dentro do vault.')
    if (info.size > 16 * 1024 * 1024) throw new Error('notas-estudo.md excedeu o limite seguro de 16 MiB.')
    return readFileSync(this.file, 'utf8')
  }
}

function paragraphAt(lines: string[], index: number): string {
  let start = index
  let end = index
  while (start > 0 && lines[start - 1]!.trim() && !/^#{1,6}\s/.test(lines[start - 1]!)) start--
  while (end + 1 < lines.length && lines[end + 1]!.trim() && !/^#{1,6}\s/.test(lines[end + 1]!)) end++
  return lines
    .slice(start, end + 1)
    .join('\n')
    .trim()
}

function paragraphEnd(lines: string[], index: number): number {
  let end = index
  while (end + 1 < lines.length && lines[end + 1]!.trim() && !/^#{1,6}\s/.test(lines[end + 1]!)) end++
  return end
}

/**
 * The files under the study sources folder (no symlinks, at most MAX_DEPTH deep and
 * MAX_PATHS files). `complete` is false when a folder, link or file had to be skipped.
 */
function walkSources(root: string): { paths: string[]; complete: boolean } {
  const paths: string[] = []
  const stack: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }]
  let complete = true
  while (stack.length && paths.length < MAX_PATHS) {
    const current = stack.pop()!
    let dir
    try {
      dir = opendirSync(current.dir)
    } catch {
      complete = false
      continue
    }
    try {
      for (let entry = dir.readSync(); entry; entry = dir.readSync()) {
        const path = join(current.dir, entry.name)
        let info
        try {
          info = lstatSync(path)
        } catch {
          complete = false
          continue
        }
        if (info.isSymbolicLink()) complete = false
        else if (info.isDirectory()) {
          if (current.depth >= MAX_DEPTH) complete = false
          else stack.push({ dir: path, depth: current.depth + 1 })
        } else if (info.isFile() && !IGNORED_FILES.has(entry.name)) {
          if (!inside(root, resolve(path)) || !inside(root, realpathSync(path))) complete = false
          else if (paths.length >= MAX_PATHS) {
            complete = false
            break
          } else paths.push(path)
        }
      }
    } finally {
      dir.closeSync()
    }
  }
  if (stack.length) complete = false
  return { paths, complete }
}

function hash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function readLocalStudyFile(path: string, root: string, maxBytes: number): { buffer: Buffer; size: number } {
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
      !inside(root, realpathSync(path))
    )
      throw new Error('Fonte local insegura.')
    if (opened.size > maxBytes) throw new Error(TOO_BIG)
    const buffer = Buffer.allocUnsafe(opened.size)
    let offset = 0
    while (offset < buffer.length) {
      const read = readSync(fd, buffer, offset, buffer.length - offset, offset)
      if (!read) throw new Error('Fonte local mudou durante a leitura.')
      offset += read
    }
    const after = fstatSync(fd)
    if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) throw new Error('Fonte local mudou durante a leitura.')
    return { buffer, size: opened.size }
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}
