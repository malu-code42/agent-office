import { inflateRawSync } from 'node:zlib'
import type { StudySourceUnit } from '@shared/study-sources'

// Local text extraction for Cora's library. PowerPoint (.pptx) is a zip of XML slides; zlib
// inflates its entries. PDF goes through unpdf (study-pdf.ts), page by page, cached on disk.
// Everything stays on this computer: nothing read here is sent to Claude.

/** Hard cap on the text taken out of one file, so a zip bomb cannot exhaust memory. */
const MAX_ENTRY_BYTES = 8 * 1024 * 1024
const MAX_ARCHIVE_TEXT = 16 * 1024 * 1024

interface ZipEntry {
  name: string
  method: number
  flags: number
  compressedSize: number
  size: number
  offset: number
}

/** The entries of a zip archive (central directory), without zip64 or encryption. */
function zipEntries(buf: Buffer): ZipEntry[] {
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('Arquivo compactado inválido.')
  const count = buf.readUInt16LE(eocd + 10)
  let at = buf.readUInt32LE(eocd + 16)
  if (count === 0xffff || at === 0xffffffff) throw new Error('Arquivo compactado em formato não suportado.')
  const entries: ZipEntry[] = []
  for (let i = 0; i < count; i++) {
    if (at + 46 > buf.length || buf.readUInt32LE(at) !== 0x02014b50) throw new Error('Arquivo compactado inválido.')
    const nameLength = buf.readUInt16LE(at + 28)
    entries.push({
      flags: buf.readUInt16LE(at + 8),
      method: buf.readUInt16LE(at + 10),
      compressedSize: buf.readUInt32LE(at + 20),
      size: buf.readUInt32LE(at + 24),
      offset: buf.readUInt32LE(at + 42),
      name: buf.toString('utf8', at + 46, at + 46 + nameLength),
    })
    at += 46 + nameLength + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32)
  }
  return entries
}

function zipRead(buf: Buffer, entry: ZipEntry): Buffer {
  if (entry.flags & 1) throw new Error('Arquivo compactado protegido.')
  const at = entry.offset
  if (at + 30 > buf.length || buf.readUInt32LE(at) !== 0x04034b50) throw new Error('Arquivo compactado inválido.')
  const start = at + 30 + buf.readUInt16LE(at + 26) + buf.readUInt16LE(at + 28)
  const data = buf.subarray(start, start + entry.compressedSize)
  if (entry.method === 0) return data.subarray(0, MAX_ENTRY_BYTES)
  if (entry.method === 8) return inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES })
  throw new Error('Arquivo compactado em formato não suportado.')
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

/** XML text with its entities decoded (named and numeric). */
export function decodeXmlText(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ref: string) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
    }
    return ENTITIES[ref.toLowerCase()] ?? whole
  })
}

/**
 * The text of a PowerPoint deck: one `## Slide N` heading per slide, then one line per
 * paragraph (`<a:p>`) with its runs (`<a:t>`) joined. Slides come in their number order.
 */
export function pptxText(buf: Buffer): string {
  const slideNumber = (name: string) => Number(/^ppt\/slides\/slide(\d+)\.xml$/.exec(name)?.[1] ?? NaN)
  const slides = zipEntries(buf)
    .filter((entry) => Number.isFinite(slideNumber(entry.name)))
    .sort((a, b) => slideNumber(a.name) - slideNumber(b.name))
  const out: string[] = []
  let total = 0
  for (const slide of slides) {
    const xml = zipRead(buf, slide).toString('utf8')
    total += xml.length
    if (total > MAX_ARCHIVE_TEXT) throw new Error('Apresentação grande demais para a busca local.')
    const paragraphs = [...xml.matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)].map((p) =>
      [...p[1]!.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((t) => decodeXmlText(t[1]!)).join(''),
    )
    // Some generators write runs outside a paragraph element; take them as one line.
    const lines = paragraphs.length ? paragraphs : [[...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((t) => decodeXmlText(t[1]!)).join(' ')]
    out.push(`## Slide ${slideNumber(slide.name)}`, '', ...lines.map((line) => line.trim()).filter(Boolean), '')
  }
  return out.join('\n')
}

// ---------- documents as units (pages, slides, sections), for Cora's recommendations ----------

export { PdfTextCache, pdfPages } from './study-pdf'

/** One unit per PDF page, numbered as the PDF numbers them. */
export function pdfUnits(pages: string[]): StudySourceUnit[] {
  return pages.map((text, i) => ({ n: i + 1, text }))
}

/** A PDF as searchable text: one `## Página N` heading per page, so a passage names its page. */
export function pdfSearchText(pages: string[]): string {
  return pages.map((text, i) => `## Página ${i + 1}\n\n${text.trim()}`).join('\n\n')
}

/** One unit per slide of pptxText's output (`## Slide N`). */
export function slideUnits(deck: string): StudySourceUnit[] {
  const units: StudySourceUnit[] = []
  for (const part of deck.split(/^## Slide (?=\d+\s*$)/m).slice(1)) {
    const newline = part.indexOf('\n')
    const n = Number(part.slice(0, newline < 0 ? undefined : newline).trim())
    if (Number.isFinite(n)) units.push({ n, text: newline < 0 ? '' : part.slice(newline + 1).trim() })
  }
  return units
}

/** One unit per section of a note (a heading and what follows it), numbered in order; text before the first heading is section 1. */
export function markdownUnits(text: string): StudySourceUnit[] {
  const units: StudySourceUnit[] = []
  let heading: string | undefined
  let lines: string[] = []
  const flush = () => {
    const body = lines.join('\n').trim()
    if (body || heading) units.push({ n: units.length + 1, ...(heading ? { heading } : {}), text: body })
  }
  for (const line of text.split(/\r?\n/)) {
    const match = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line)
    if (!match) {
      lines.push(line)
      continue
    }
    flush()
    heading = match[1]!.slice(0, 160)
    lines = []
  }
  flush()
  return units
}

/** Plain text in blocks of `size` lines (numbered by their first and last line). */
export function textUnits(text: string, size = 40): StudySourceUnit[] {
  const lines = text.split(/\r?\n/)
  const units: StudySourceUnit[] = []
  for (let at = 0; at < lines.length; at += size) {
    const block = lines.slice(at, at + size)
    if (block.some((line) => line.trim())) units.push({ n: at + 1, end: at + block.length, text: block.join('\n') })
  }
  return units
}
