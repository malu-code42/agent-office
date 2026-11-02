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
  statSync,
} from 'node:fs'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import { writeFileAtomicChecked } from './fs-safe'
import type { StudyNoteWriter } from './study-cycle'
import {
  scoreStudyText,
  studySnippet,
  tokenizeStudyQuery,
  type StudyLibraryHit,
  type StudyLibrarySearch,
  type StudySourceInfo,
  type StudySourceInventory,
  type StudySourceStatus,
} from '@shared/study-library'
import { rankStudySources, type StudySourceDoc, type StudySourceRecommendations } from '@shared/study-sources'
import { needsOcr, pagesWithoutText, type PdfExtractor, type PdfOcrJob } from './study-pdf'
import { markdownUnits, PdfTextCache, pdfSearchText, pdfUnits, pptxText, slideUnits, textUnits } from './study-source-text'

const SOURCE_DIR = 'study sources'
const NOTE_FILE = 'notas-estudo.md'
const MAX_PATHS = 2000
const MAX_DEPTH = 12
const MAX_FILE_BYTES = 1024 * 1024
const MAX_TOTAL_BYTES = 128 * 1024 * 1024
const MAX_HITS = 30
/** A deck is a zip of slides: it can be large on disk (images) for little text. */
const MAX_DECK_BYTES = 64 * 1024 * 1024
/** A PDF is mostly images and fonts on disk; its text is what counts against the search budget. */
const MAX_PDF_BYTES = 256 * 1024 * 1024
/** How long one search waits for PDFs never parsed before; the rest are read in the background. */
const PDF_COLD_BUDGET_MS = 15_000
/** How long "verify" waits for cold PDFs to be parsed. */
const VERIFY_BUDGET_MS = 10 * 60_000
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

/** A file of the study sources folder, read (or not) for one search. */
interface SourceFile {
  path: string
  kind: 'text' | 'pptx' | 'pdf' | null
  /** The file as searchable text (a PDF has one `## Página N` heading per page); null when not read. */
  text: string | null
  /** The PDF's pages, when it is one. */
  pages?: string[]
  /** Why the file could not be read (inventory only). */
  status?: StudySourceStatus
}

interface SourceScan {
  root: string
  files: SourceFile[]
  /** Formats searched by name only, with how many files of each. */
  byName: Map<string, number>
  tooBig: string[]
  unreadable: number
  /** PDFs still being parsed in the background (searched by name this time). */
  pending: number
  walked: boolean
}

/** Local-only source retrieval for Cora. It never invokes a model or sends file contents off-device. */
export class StudyLibrary {
  private readonly vault: string
  private readonly sourceRoot: string
  private readonly snapshots = new Map<string, Snapshot>()
  private readonly pdf: PdfTextCache

  /**
   * `pdf.cacheDir`: where PDF pages are cached (the app data folder; without it PDFs are parsed on
   * every search). `pdf.extract`: the parser (the app's worker thread; in-thread by default).
   */
  constructor(vault: string, pdf: { cacheDir?: string; extract?: PdfExtractor; ocr?: (job: PdfOcrJob) => void } = {}) {
    this.vault = realpathSync(resolve(vault))
    this.sourceRoot = join(this.vault, SOURCE_DIR)
    this.pdf = new PdfTextCache(pdf.cacheDir, pdf.extract, pdf.ocr)
  }

  /** `scope`: only files whose path inside the vault starts with one of these prefixes (e.g. a discipline's textbook folders). */
  async search(query: string, scope?: readonly string[]): Promise<StudyLibrarySearch> {
    const parsed = tokenizeStudyQuery(query)
    if (!parsed.terms.length || query.length > 200) throw new Error('Informe um tópico de até 200 caracteres.')
    const scan = await this.scan()
    if (!scan) return { token: randomUUID(), query, complete: true, hits: [], warning: 'A pasta local de estudos ainda não existe.' }
    const { root } = scan
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
    for (const { path, kind, text } of scan.files) {
      if (scope && !scope.some((prefix) => relative(this.vault, path).split(sep).join('/').startsWith(prefix))) continue
      // Every file is found by its name and folders ("Estrutura de Dados/Aula 05 Filas.pdf").
      const nameScore = scoreStudyText(relative(root, path), parsed)
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
        // Every passage of the file, best first: only the total (MAX_HITS) is capped.
        for (const f of found.sort((a, b) => b.score - a.score))
          // A slide or a PDF page is cited by its number; the line of the extracted text means nothing there.
          add(path, f.heading, kind === 'text' ? f.line : 0, f.excerpt, f.score)
        fileHits = found.length
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
    return this.remember(hits.slice(0, MAX_HITS), scanComplete(scan), query, scanWarning(scan))
  }

  /**
   * Cora's reading list for each request (a theme typed by the user, or the concept of a question
   * the user got wrong): the local sources ranked best to worst, with the pages, slides or
   * sections where to start and stop. One scan of the folder serves every request.
   */
  async recommend(requests: string[]): Promise<StudySourceRecommendations[]> {
    for (const request of requests)
      if (!tokenizeStudyQuery(request).terms.length || request.length > 200) throw new Error('Informe um tema de até 200 caracteres.')
    const scan = await this.scan()
    if (!scan) return requests.map((query) => ({ query, recommendations: [], warning: 'A pasta local de estudos ainda não existe.' }))
    const docs: StudySourceDoc[] = []
    for (const file of scan.files) {
      if (file.text === null) continue
      const path = relative(this.vault, file.path).split(sep).join('/')
      const ext = extname(file.path).toLowerCase()
      const kind = file.kind === 'pdf' ? 'pdf' : file.kind === 'pptx' ? 'pptx' : ext === '.txt' ? 'txt' : 'md'
      const units =
        kind === 'pdf'
          ? pdfUnits(file.pages ?? [])
          : kind === 'pptx'
            ? slideUnits(file.text)
            : kind === 'md'
              ? markdownUnits(file.text)
              : textUnits(file.text)
      docs.push({ path, title: basename(file.path), kind, units })
    }
    const warning = scanWarning(scan)
    return requests.map((query) => ({ query, recommendations: rankStudySources(docs, query), ...(warning ? { warning } : {}) }))
  }

  /** The source file of a recommendation, checked to be a regular file inside the study sources folder. */
  sourcePath(relativePath: string): string {
    const root = this.checkedSourceRoot()
    if (!root) throw new Error('A pasta local de estudos ainda não existe.')
    const path = resolve(this.vault, relativePath)
    const info = lstatSync(path, { throwIfNoEntry: false })
    if (!info || info.isSymbolicLink() || !info.isFile() || !inside(root, path) || !inside(root, realpathSync(path)))
      throw new Error('Essa fonte não está na pasta local de estudos.')
    return path
  }

  /** Walks the study sources folder and reads what Cora can read (within the limits). Null when there is no folder. */
  private async scan(coldBudgetMs = PDF_COLD_BUDGET_MS, ocr = false): Promise<SourceScan | null> {
    const root = this.checkedSourceRoot()
    if (!root) return null
    const { paths, complete: walked } = walkSources(root)
    paths.sort((a, b) => relative(root, a).localeCompare(relative(root, b), 'pt-BR'))
    let totalBytes = 0
    let overBudget = false
    const byName = new Map<string, number>()
    const tooBig: string[] = []
    let unreadable = 0
    let pending = 0
    // A cold library (PDFs never parsed) is read for a while; the rest goes on in the background.
    const deadline = Date.now() + coldBudgetMs
    const files: SourceFile[] = []
    for (const path of paths) {
      const ext = extname(path).toLowerCase()
      const kind = TEXT_EXTENSIONS.has(ext) ? 'text' : ext === '.pptx' ? 'pptx' : ext === '.pdf' ? 'pdf' : null
      const file: SourceFile = { path, kind, text: null }
      files.push(file)
      if (!kind) byName.set(ext || 'sem extensão', (byName.get(ext || 'sem extensão') ?? 0) + 1)
      else if (overBudget) {
        tooBig.push(basename(path))
        file.status = 'grande'
      }
      else {
        try {
          if (kind === 'pdf') {
            // A PDF counts by the text taken out of it: its images weigh on disk, not in the search.
            const info = statSync(path)
            if (info.size > MAX_PDF_BYTES) throw new Error(TOO_BIG)
            const pages = await this.pdf.pagesBy(path, info, () => readLocalStudyFile(path, root, MAX_PDF_BYTES).buffer, deadline, ocr)
            if (pages === 'pending') {
              pending++
              file.status = 'lendo'
              continue
            }
            const text = pdfSearchText(pages)
            if (text.length + totalBytes > MAX_TOTAL_BYTES) {
              overBudget = true
              tooBig.push(basename(path))
              file.status = 'grande'
            } else {
              totalBytes += text.length
              file.text = text
              file.pages = pages
            }
            continue
          }
          const content = readLocalStudyFile(path, root, kind === 'text' ? MAX_FILE_BYTES : MAX_DECK_BYTES)
          if (content.size + totalBytes > MAX_TOTAL_BYTES) {
            overBudget = true
            tooBig.push(basename(path))
            file.status = 'grande'
          } else {
            totalBytes += content.size
            file.text = kind === 'text' ? content.buffer.toString('utf8') : pptxText(content.buffer)
          }
        } catch (error) {
          if (error instanceof Error && error.message === TOO_BIG) {
            tooBig.push(basename(path))
            file.status = 'grande'
          } else {
            unreadable++
            file.status = 'ilegivel'
          }
        }
      }
    }
    return { root, files, byName, tooBig, unreadable, pending, walked }
  }

  /**
   * Every file of "study sources" and what Cora can do with it. With `verify` the cold PDFs are
   * parsed to the end (instead of in the background), which also hands the scanned ones to the OCR.
   */
  async inventory(verify = false): Promise<StudySourceInventory> {
    const scan = await this.scan(verify ? VERIFY_BUDGET_MS : PDF_COLD_BUDGET_MS, verify)
    if (!scan) return { sources: [], complete: true, missingFolder: true, ocrQueued: 0 }
    let ocrQueued = 0
    const sources = scan.files.map((file): StudySourceInfo => {
      const ext = extname(file.path).toLowerCase()
      let status: StudySourceStatus = file.status ?? (file.kind ? 'lida' : 'so-nome')
      let size = 0
      try {
        size = statSync(file.path).size
      } catch {
        status = 'ilegivel'
      }
      const info: StudySourceInfo = { path: relative(this.vault, file.path).split(sep).join('/'), name: basename(file.path), ext, size, status }
      if (file.pages) {
        info.pages = file.pages.length
        info.blankPages = pagesWithoutText(file.pages).length
        if (needsOcr(file.pages)) {
          info.status = 'ocr'
          ocrQueued++
        }
      }
      return info
    })
    return { sources, complete: scan.walked, ocrQueued }
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

function scanComplete(scan: SourceScan): boolean {
  return scan.walked && !scan.byName.size && !scan.tooBig.length && !scan.unreadable && !scan.pending
}

function scanWarning(scan: SourceScan): string | undefined {
  const warnings: string[] = []
  if (scan.byName.size) {
    const formats = [...scan.byName].map(([ext, n]) => `${n} ${ext.replace(/^\./, '').toUpperCase()}`).join(', ')
    warnings.push(`Arquivos buscados só pelo nome (${formats}): Cora lê o conteúdo de .md, .txt, .pptx e .pdf.`)
  }
  if (scan.tooBig.length) warnings.push(`${scan.tooBig.length} arquivo(s) passaram do limite de leitura e foram buscados só pelo nome.`)
  if (scan.unreadable) warnings.push(`${scan.unreadable} arquivo(s) não puderam ser lidos.`)
  if (scan.pending)
    warnings.push(
      `Cora ainda está lendo ${scan.pending} PDF(s) pela primeira vez (buscados só pelo nome agora); peça de novo em alguns minutos.`,
    )
  if (!scan.walked) warnings.push('Algumas pastas ou atalhos não foram percorridos.')
  return warnings.join(' ') || undefined
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
    const savedAt = input.savedAt ?? Date.now()
    if (!/^q-[a-z0-9-]{8,72}$/i.test(gapQuestionId)) throw new Error('Identificador de nota inválido.')
    this.append(id, gapQuestionId, sourceRef, text, savedAt)
    return { id, gapQuestionId, sourceRef, text, savedAt }
  }

  /** A standalone (authored) note: no task, no study cycle. It lands in the same file, so cards can use it. */
  writeLoose(title: string, rawText: string): { id: string } {
    const heading = title.trim()
    if (!heading || heading.length > 200 || /[\r\n\0]/.test(heading)) throw new Error('Informe um título de uma linha, com até 200 caracteres.')
    const id = `sn-${randomUUID()}`
    this.append(id, heading, 'Nota avulsa (autoral)', rawText)
    return { id }
  }

  private append(id: string, heading: string, sourceRef: string, rawText: string, at?: number): void {
    const text = rawText.trim()
    if (!/^sn-[a-z0-9-]{8,150}$/i.test(id)) throw new Error('Identificador de nota inválido.')
    if (!text || text.length > 10_000 || /\0/.test(text)) throw new Error('A nota deve ter até 10.000 caracteres.')
    if (!sourceRef || sourceRef.length > 1000 || /[\r\n\0]/.test(sourceRef)) throw new Error('Referência de fonte inválida.')
    const savedAt = at ?? Date.now()
    const marker = `<!-- agent-office-study-note:${id} -->`
    const current = this.readCurrent()
    if (current.includes(marker)) return
    const date = new Date(savedAt).toISOString().slice(0, 10)
    const append = [marker, `## ${date} · ${heading}`, `Fonte: ${sourceRef}`, '', text, ''].join('\n')
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
