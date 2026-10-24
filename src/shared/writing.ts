import { randomBytes } from 'node:crypto'

const MAX_BODY_LENGTH = 50_000
const SNIPPET_ID = /^w[a-z0-9]{8,}$/
export const VERSION_ID = /^v[a-z0-9]{8,}$/
const BEGIN = /^<!-- office-writing:begin:(v[a-z0-9]{8,}):(\d+) -->$/
const END = (id: string) => `<!-- office-writing:end:${id} -->`
const SNIPPET = /^<!-- office-writing:snippet:(.+) -->$/
const VERSION = /^<!-- office-writing:version:(.+) -->$/

export interface WritingVersion {
  readonly versionId: string
  readonly number: number
  readonly createdAt: string
  readonly source: 'original' | 'escrita'
  readonly baseVersionId?: string
  readonly body: string
}

export interface CreateOriginalInput {
  id: string
  title: string
  body: string
  createdAt: string
  versionId?: string
}

export interface AppendVersionInput {
  versionId: string
  baseVersionId: string
  body: string
  createdAt: string
}

export class WritingSnippet {
  readonly id: string
  readonly title: string
  private readonly _versions: WritingVersion[]

  get versions(): readonly WritingVersion[] {
    return Object.freeze([...this._versions])
  }

  private constructor(id: string, title: string, versions: readonly WritingVersion[]) {
    this.id = id
    this.title = title
    this._versions = versions.map((version) => Object.freeze({ ...version }))
  }

  static createOriginal(input: CreateOriginalInput): WritingSnippet {
    validateSnippetId(input.id)
    validateTitle(input.title)
    validateBody(input.body)
    validateDate(input.createdAt)
    const versionId = input.versionId ?? newVersionId()
    validateVersionId(versionId)
    ensureSafeBody(input.body, versionId)
    return new WritingSnippet(input.id, input.title, [
      {
        versionId,
        number: 1,
        createdAt: input.createdAt,
        source: 'original',
        body: input.body,
      },
    ])
  }

  static validateInstruction(instruction: string): string {
    if (!instruction.trim() || instruction.length > 2_000) throw new Error('A instrução deve ter de 1 a 2.000 caracteres.')
    return instruction
  }

  static restore(id: string, title: string, versions: readonly WritingVersion[]): WritingSnippet {
    validateSnippetId(id)
    validateTitle(title)
    if (!versions.length) throw new Error('O trecho precisa ter ao menos uma versão salva.')
    const versionIds = new Set<string>()
    let expected = 1
    for (const version of versions) {
      validateVersion(version)
      if (versionIds.has(version.versionId)) throw new Error('Há ID de versão duplicado no trecho.')
      if (version.number !== expected) throw new Error('A sequência de versões está fora de ordem.')
      if (expected === 1 && version.source !== 'original') throw new Error('A primeira versão precisa ser o Original.')
      if (expected > 1 && version.source !== 'escrita') throw new Error('Somente o Original pode ter origem original.')
      if (version.baseVersionId && !versionIds.has(version.baseVersionId))
        throw new Error('A versão base precisa existir antes da nova versão.')
      versionIds.add(version.versionId)
      expected += 1
    }
    return new WritingSnippet(id, title, versions)
  }

  appendVersion(input: AppendVersionInput): WritingVersion {
    validateVersionId(input.versionId)
    if (this.versions.some((version) => version.versionId === input.versionId)) throw new Error('ID de versão duplicado no trecho.')
    if (!this.versions.some((version) => version.versionId === input.baseVersionId))
      throw new Error('A versão base não existe neste trecho.')
    validateBody(input.body)
    validateDate(input.createdAt)
    ensureSafeBody(input.body, input.versionId)
    const version = Object.freeze({
      versionId: input.versionId,
      number: Math.max(...this.versions.map(({ number }) => number)) + 1,
      createdAt: input.createdAt,
      source: 'escrita' as const,
      baseVersionId: input.baseVersionId,
      body: input.body,
    })
    this._versions.push(version)
    return version
  }

  version(id: string): WritingVersion {
    const found = this.versions.find((version) => version.versionId === id)
    if (!found) throw new Error('A versão solicitada não existe neste trecho.')
    return found
  }

  latestVersion(): WritingVersion {
    return this.versions[this.versions.length - 1]!
  }
}

export interface WritingDocument {
  readonly source: string
  readonly snippets: readonly WritingSnippet[]
  readonly lineEnding: '\n' | '\r\n'
}

interface VersionMetadata {
  versionId: string
  number: number
  createdAt: string
  source: 'original' | 'escrita'
  baseVersionId?: string
}

export function parseWriting(text: string): WritingDocument {
  const snippets: WritingSnippet[] = []
  const snippetIds = new Set<string>()
  const versionIds = new Set<string>()
  const lines = physicalLines(text)
  let current: { id: string; title: string; versions: WritingVersion[] } | null = null
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!
    const snippetMarker = SNIPPET.exec(line.content)
    if (snippetMarker) {
      if (current) snippets.push(WritingSnippet.restore(current.id, current.title, current.versions))
      let metadata: unknown
      try {
        metadata = JSON.parse(snippetMarker[1]!)
      } catch {
        throw new Error('Os metadados do trecho estão inválidos.')
      }
      if (!isRecord(metadata) || typeof metadata.id !== 'string' || typeof metadata.title !== 'string')
        throw new Error('Os metadados do trecho estão inválidos.')
      validateSnippetId(metadata.id)
      validateTitle(metadata.title)
      if (snippetIds.has(metadata.id)) throw new Error('Há ID de trecho duplicado no arquivo.')
      snippetIds.add(metadata.id)
      current = { id: metadata.id, title: metadata.title, versions: [] }
      continue
    }
    const versionMarker = VERSION.exec(line.content)
    if (!versionMarker) continue
    if (!current) throw new Error('Há metadados de versão sem um trecho correspondente.')
    let metadata: VersionMetadata
    try {
      metadata = JSON.parse(versionMarker[1]!) as VersionMetadata
    } catch {
      throw new Error('Os metadados da versão estão inválidos.')
    }
    if (
      !isRecord(metadata) ||
      typeof metadata.versionId !== 'string' ||
      typeof metadata.number !== 'number' ||
      typeof metadata.createdAt !== 'string' ||
      (metadata.source !== 'original' && metadata.source !== 'escrita')
    )
      throw new Error('Os metadados da versão estão inválidos.')
    if (versionIds.has(metadata.versionId)) throw new Error('Há ID de versão duplicado no arquivo.')
    const begin = lines[index + 1]
    const match = begin && BEGIN.exec(begin.content)
    if (!begin || !match || match[1] !== metadata.versionId) throw new Error('O delimitador inicial da versão está inválido.')
    const length = Number(match[2])
    const bodyStart = begin.next
    const bodyEnd = bodyStart + length
    const body = text.slice(bodyStart, bodyEnd)
    const endLineStart = bodyEnd + (text.startsWith('\r\n', bodyEnd) ? 2 : text.startsWith('\n', bodyEnd) ? 1 : 0)
    const endLine = physicalLines(text.slice(endLineStart))[0]
    if (
      !Number.isSafeInteger(length) ||
      length < 1 ||
      length > MAX_BODY_LENGTH ||
      body.length !== length ||
      endLine?.content !== END(metadata.versionId)
    )
      throw new Error('O corpo ou delimitador da versão está inválido.')
    const version: WritingVersion = { ...metadata, body }
    validateVersion(version)
    current.versions.push(version)
    versionIds.add(metadata.versionId)
    while (index + 1 < lines.length && lines[index + 1]!.start < endLineStart + endLine.content.length) index += 1
  }
  if (current) snippets.push(WritingSnippet.restore(current.id, current.title, current.versions))
  return { source: text, snippets, lineEnding: text.includes('\r\n') ? '\r\n' : '\n' }
}

export function serializeWriting(document: WritingDocument): string {
  return document.source
}

export function appendSnippet(document: WritingDocument, snippet: WritingSnippet): WritingDocument {
  if (document.snippets.some((item) => item.id === snippet.id)) throw new Error('ID de trecho duplicado no arquivo.')
  const block = serializeSnippet(snippet, document.lineEnding)
  return parseWriting(appendBlock(document.source, block, document.lineEnding))
}

/**
 * Constructs updated document content in memory only; this function does not persist anything.
 * Only WritingWriter may persist it, through its appendVersion after the explicit Save action.
 */
export function appendVersion(document: WritingDocument, snippetId: string, version: WritingVersion): WritingDocument {
  const snippet = document.snippets.find((item) => item.id === snippetId)
  if (!snippet) throw new Error('O trecho solicitado não existe no arquivo.')
  if (document.snippets.some((item) => item.versions.some((itemVersion) => itemVersion.versionId === version.versionId)))
    throw new Error('ID de versão duplicado no arquivo.')
  if (!snippet.versions.some((item) => item.versionId === version.baseVersionId)) throw new Error('A versão base não existe neste trecho.')
  if (version.number !== Math.max(...snippet.versions.map(({ number }) => number)) + 1)
    throw new Error('A sequência de versões está fora de ordem.')
  validateVersion(version)
  const block = serializeVersion(version, document.lineEnding)
  return parseWriting(appendBlock(document.source, block, document.lineEnding))
}

function serializeSnippet(snippet: WritingSnippet, eol: string): string {
  return [
    `<!-- office-writing:snippet:${JSON.stringify({ id: snippet.id, title: snippet.title })} -->`,
    ...snippet.versions.map((version) => serializeVersion(version, eol)),
  ].join(eol)
}

function serializeVersion(version: WritingVersion, eol: string): string {
  ensureSafeBody(version.body, version.versionId)
  return [
    `<!-- office-writing:version:${JSON.stringify({ versionId: version.versionId, number: version.number, createdAt: version.createdAt, source: version.source, ...(version.baseVersionId ? { baseVersionId: version.baseVersionId } : {}) })} -->`,
    `<!-- office-writing:begin:${version.versionId}:${version.body.length} -->`,
    version.body,
    END(version.versionId),
  ].join(eol)
}

function appendBlock(source: string, block: string, eol: string): string {
  if (!source) return block + eol
  return source + (source.endsWith('\n') ? '' : eol) + block + eol
}

function physicalLines(text: string): { content: string; start: number; next: number }[] {
  const lines: { content: string; start: number; next: number }[] = []
  let start = 0
  while (start < text.length) {
    const newline = text.indexOf('\n', start)
    const next = newline < 0 ? text.length : newline + 1
    const end = newline < 0 ? text.length : newline > start && text[newline - 1] === '\r' ? newline - 1 : newline
    lines.push({ content: text.slice(start, end), start, next })
    start = next
  }
  if (!text.length || text.endsWith('\n')) lines.push({ content: '', start: text.length, next: text.length })
  return lines
}

function validateSnippetId(id: string): void {
  if (!SNIPPET_ID.test(id)) throw new Error('ID do trecho inválido; use w seguido de ao menos 8 letras minúsculas ou dígitos.')
}
function validateVersionId(id: string): void {
  if (!VERSION_ID.test(id)) throw new Error('ID de versão inválido; use v seguido de ao menos 8 letras minúsculas ou dígitos.')
}
function validateTitle(title: string): void {
  if (!title.trim() || title.length > 200 || /[\r\n]/.test(title))
    throw new Error('O título deve ter de 1 a 200 caracteres em uma única linha.')
}
function validateBody(body: string): void {
  if (!body.length || body.length > MAX_BODY_LENGTH) throw new Error('O corpo deve ter de 1 a 50.000 caracteres.')
}
function validateDate(date: string): void {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(date) || Number.isNaN(Date.parse(date)))
    throw new Error('A data da versão deve estar no formato ISO.')
}
function validateVersion(version: WritingVersion): void {
  validateVersionId(version.versionId)
  validateDate(version.createdAt)
  validateBody(version.body)
  if (!Number.isSafeInteger(version.number) || version.number < 1) throw new Error('O número da versão é inválido.')
  if (version.source !== 'original' && version.source !== 'escrita') throw new Error('A origem da versão é inválida.')
  if (version.source === 'original' && (version.number !== 1 || version.baseVersionId))
    throw new Error('O Original deve ser a primeira versão e não pode ter versão base.')
  if (version.source === 'escrita' && (!version.baseVersionId || !VERSION_ID.test(version.baseVersionId)))
    throw new Error('A versão Escrita precisa indicar uma versão base válida.')
  ensureSafeBody(version.body, version.versionId)
}
function ensureSafeBody(body: string, id: string): void {
  if (body.includes(END(id))) throw new Error('O corpo contém o delimitador de fechamento da versão; altere o texto antes de salvar.')
}
function newVersionId(): string {
  return `v${randomBytes(16).toString('hex')}`
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
