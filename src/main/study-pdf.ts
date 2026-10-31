import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeFileAtomic } from './fs-safe'

// Local PDF text for Cora (and the question bank's source scan): the text of each page, read
// with unpdf (pdf.js without a canvas) in the main process side only, off its event loop in a
// worker thread (study-pdf-pool.ts). Nothing leaves the computer. The pages are cached by path +
// mtime + size in the app data folder, so a library of PDFs is parsed once, not on every search.

/** Text kept per page and per file, so one odd PDF cannot exhaust memory or the cache. */
const MAX_PAGE_TEXT = 64 * 1024
const MAX_PAGES = 2000
const MAX_DOC_TEXT = 16 * 1024 * 1024

/** Turns the bytes of a PDF into the text of its pages; rejects an invalid or protected file. */
export type PdfExtractor = (bytes: Uint8Array) => Promise<string[]>

/** The text of each page of a PDF, in order (page 1 first). Throws on an invalid or protected file. */
export async function pdfPages(buffer: Uint8Array): Promise<string[]> {
  const { extractText, getDocumentProxy } = await import('unpdf')
  // pdf.js takes ownership of (and may detach) the bytes it gets: hand it a copy.
  const pdf = await getDocumentProxy(new Uint8Array(buffer))
  try {
    const { text } = await extractText(pdf, { mergePages: false })
    const pages: string[] = []
    let total = 0
    for (const page of text.slice(0, MAX_PAGES)) {
      const clean = page.replace(/\s+\n/g, '\n').slice(0, MAX_PAGE_TEXT)
      total += clean.length
      if (total > MAX_DOC_TEXT) break
      pages.push(clean)
    }
    return pages
  } finally {
    // Frees pdf.js' worker-side state; older proxies only have cleanup().
    const doc = pdf as unknown as { destroy?: () => Promise<void>; cleanup?: () => Promise<void> }
    await (doc.destroy ?? doc.cleanup)?.call(doc).catch(() => undefined)
  }
}

interface CacheEntry {
  path: string
  mtimeMs: number
  size: number
  pages: string[]
  /** The file could not be parsed: remembered, so a broken PDF is not parsed on every search. */
  failed?: boolean
  /** The pages without text went through OCR already (study-ocr.ts). */
  ocr?: boolean
}

export type FileInfo = { mtimeMs: number; size: number }

/** A page with fewer characters than this has no text layer (a scan, an image, a blank page). */
const EMPTY_PAGE_CHARS = 40
/** OCR runs when at least this share of a PDF's pages has no text: a scan, not a few blank pages. */
const OCR_EMPTY_SHARE = 0.2

/** The indexes (0-based) of the pages without a text layer. */
export function pagesWithoutText(pages: string[]): number[] {
  return pages.flatMap((text, i) => (text.trim().length < EMPTY_PAGE_CHARS ? [i] : []))
}

/** Whether a PDF looks scanned: enough of its pages have no text for OCR to be worth it. */
export function needsOcr(pages: string[]): boolean {
  const empty = pagesWithoutText(pages).length
  return empty > 0 && empty >= pages.length * OCR_EMPTY_SHARE
}

/** A scanned PDF handed to OCR; `finish` stores its pages with the recognised text. */
export interface PdfOcrJob {
  key: string
  path: string
  pages: string[]
  finish(pages: string[]): void
}

/** PDF pages cached on disk (one JSON per file version). Without a folder it only parses. */
export class PdfTextCache {
  /** Parses running now, by cache key: a second request for the same file waits for the first. */
  private readonly running = new Map<string, Promise<string[]>>()

  constructor(
    private readonly dir?: string,
    private readonly extract: PdfExtractor = pdfPages,
    /** Queues a scanned PDF for OCR (in the background; the pages without text stay empty until then). */
    private readonly ocr?: (job: PdfOcrJob) => void,
  ) {}

  /** The pages of `path`, whose bytes are `read()` only on a cache miss. */
  async pages(path: string, info: FileInfo, read: () => Buffer): Promise<string[]> {
    const key = this.key(path, info)
    const cached = this.cached(path, info)
    if (cached) return cached
    let run = this.running.get(key)
    if (!run) {
      run = this.parse(path, info, read).finally(() => this.running.delete(key))
      this.running.set(key, run)
    }
    return run
  }

  /**
   * The pages if they are cached or can be parsed before `deadline` (a Date.now() value);
   * otherwise 'pending': the parse goes on in the background, so the next search finds it.
   */
  async pagesBy(path: string, info: FileInfo, read: () => Buffer, deadline: number): Promise<string[] | 'pending'> {
    const cached = this.cached(path, info)
    if (cached) return cached
    if (Date.now() >= deadline) {
      this.pages(path, info, read).catch(() => undefined)
      return 'pending'
    }
    return this.pages(path, info, read)
  }

  /** The cached pages, or null on a miss; throws when the file is remembered as unreadable. */
  cached(path: string, info: FileInfo): string[] | null {
    const file = this.file(path, info)
    if (!file || !existsSync(file)) return null
    let entry: CacheEntry
    try {
      entry = JSON.parse(readFileSync(file, 'utf8')) as CacheEntry
    } catch {
      // A broken cache entry is parsed again and rewritten.
      return null
    }
    if (entry.path !== path || entry.mtimeMs !== info.mtimeMs || entry.size !== info.size || !Array.isArray(entry.pages)) return null
    if (entry.failed) throw new Error('PDF ilegível.')
    const pages = entry.pages.map(String)
    if (!entry.ocr) this.queueOcr(path, info, pages)
    return pages
  }

  private async parse(path: string, info: FileInfo, read: () => Buffer): Promise<string[]> {
    try {
      const pages = await this.extract(read())
      this.save(path, info, pages, false)
      this.queueOcr(path, info, pages)
      return pages
    } catch (error) {
      // A worker restart is not the file's fault; anything else marks this version unreadable.
      if (!(error as { transient?: boolean }).transient) this.save(path, info, [], true)
      throw error
    }
  }

  private queueOcr(path: string, info: FileInfo, pages: string[]): void {
    if (!this.ocr || !this.dir || !needsOcr(pages)) return
    this.ocr({ key: this.key(path, info), path, pages, finish: (done) => this.save(path, info, done, false, true) })
  }

  private save(path: string, info: FileInfo, pages: string[], failed: boolean, ocr = false): void {
    const file = this.file(path, info)
    if (!file || !this.dir) return
    try {
      if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true })
      const entry: CacheEntry = { path, mtimeMs: info.mtimeMs, size: info.size, pages, ...(failed ? { failed } : {}), ...(ocr ? { ocr } : {}) }
      writeFileAtomic(file, JSON.stringify(entry))
    } catch {
      // The cache is a speed-up only: a failed write leaves the next search to parse again.
    }
  }

  private key(path: string, info: FileInfo): string {
    return createHash('sha256').update(`${path}\n${info.mtimeMs}\n${info.size}`).digest('hex')
  }

  private file(path: string, info: FileInfo): string | null {
    return this.dir ? join(this.dir, `${this.key(path, info)}.json`) : null
  }
}
