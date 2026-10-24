import { randomBytes } from 'node:crypto'
import { profileTaskInstructions } from '@shared/profiles'
import { WritingSnippet } from '@shared/writing'
import type { WritingWriter } from './writing-write'

const MAX_RESPONSE_LENGTH = 50_000
const MAX_ENTRIES = 100
const DEFAULT_TTL_MS = 5 * 60_000
const DEFAULT_TIMEOUT_MS = 60_000

export interface WritingInterpreter {
  interpret(context: string, signal: AbortSignal): Promise<string>
}

export interface WritingAssistantOptions {
  writer: WritingWriter
  interpret: WritingInterpreter['interpret']
  now?: () => number
  ttlMs?: number
  timeoutMs?: number
}

export interface WritingPreview {
  token: string
  context: string
  preview: string
}

export interface WritingDraft {
  draftToken: string
  snippetId: string
  baseVersionId: string
  originalText: string
  suggestedText: string
}

interface PreparedEntry {
  expiresAt: number
  vault: string
  snapshot: string | null
  snippetId: string
  baseVersionId: string
  originalText: string
  context: string
}

interface DraftEntry extends Omit<PreparedEntry, 'context'> {
  expiresAt: number
  suggestedText: string
}

interface PendingOperation {
  controller: AbortController
  interruption: Promise<never>
  interrupt: (error: Error) => void
  context: string
  entry: PreparedEntry | null
  deadline: number
  timedOut: boolean
}

function clearPreparedEntry(entry: PreparedEntry): void {
  entry.vault = ''
  entry.snapshot = null
  entry.snippetId = ''
  entry.baseVersionId = ''
  entry.originalText = ''
  entry.context = ''
  entry.expiresAt = 0
}

function clearOperation(operation: PendingOperation): void {
  operation.context = ''
  if (operation.entry) clearPreparedEntry(operation.entry)
  operation.entry = null
}

function token(): string {
  return randomBytes(24).toString('hex')
}

/** Main-process-only, short-lived writing assistance. Content is intentionally never logged or persisted here. */
export class WritingAssistant {
  private readonly previews = new Map<string, PreparedEntry>()
  private readonly drafts = new Map<string, DraftEntry>()
  private readonly pending = new Map<string, PendingOperation>()
  private readonly now: () => number
  private readonly ttlMs: number
  private readonly timeoutMs: number

  constructor(private readonly options: WritingAssistantOptions) {
    this.now = options.now ?? Date.now
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  prepare(vault: string, snippetId: string, versionId: string, instruction: string): WritingPreview {
    this.cleanExpired()
    WritingSnippet.validateInstruction(instruction)
    const snapshot = this.options.writer.read(vault)
    const snippet = snapshot.snippets.find((item) => item.id === snippetId)
    if (!snippet) throw new Error('O trecho solicitado não existe em escrita.md. Recarregue a biblioteca.')
    const version = snippet.version(versionId)
    const context = [
      'Perfil: Escrita',
      profileTaskInstructions('escrita'),
      `Título: ${snippet.title}`,
      `ID do trecho: ${snippet.id}`,
      `ID da versão selecionada: ${version.versionId}`,
      'Texto selecionado:',
      version.body,
      'Instrução:',
      instruction,
    ].join('\n')
    const previewToken = token()
    this.ensureCapacity(this.previews)
    this.previews.set(previewToken, {
      expiresAt: this.now() + this.ttlMs,
      vault,
      snapshot: snapshot.snapshot,
      snippetId,
      baseVersionId: version.versionId,
      originalText: version.body,
      context,
    })
    return { token: previewToken, context, preview: context }
  }

  async send(previewToken: string): Promise<WritingDraft> {
    this.cleanExpired()
    const entry = this.previews.get(previewToken)
    this.previews.delete(previewToken)
    if (!entry) throw new Error('A prévia expirou ou já foi usada. Prepare a revisão novamente.')
    let rejectInterruption!: (error: Error) => void
    const interruption = new Promise<never>((_resolve, reject) => {
      rejectInterruption = reject
    })
    const controller = new AbortController()
    const operation: PendingOperation = {
      controller,
      interruption,
      interrupt: (error) => {
        controller.abort()
        rejectInterruption(error)
      },
      context: entry.context,
      entry,
      deadline: this.now() + this.timeoutMs,
      timedOut: false,
    }
    this.pending.set(previewToken, operation)
    const timeout = setTimeout(() => {
      operation.timedOut = true
      if (this.pending.get(previewToken) === operation) this.pending.delete(previewToken)
      clearOperation(operation)
      operation.interrupt(new Error('A revisão excedeu o tempo limite.'))
    }, this.timeoutMs)
    try {
      const suggestedText = await Promise.race([
        this.options.interpret(operation.context, operation.controller.signal),
        operation.interruption,
      ])
      if (operation.timedOut || this.now() >= operation.deadline) {
        throw new Error('A revisão excedeu o tempo limite.')
      }
      if (operation.controller.signal.aborted || this.pending.get(previewToken) !== operation) throw new Error('A revisão foi cancelada.')
      if (this.now() >= entry.expiresAt) throw new Error('A prévia expirou. Prepare a revisão novamente.')
      if (typeof suggestedText !== 'string' || !suggestedText.trim() || suggestedText.length > MAX_RESPONSE_LENGTH)
        throw new Error('A Escrita não devolveu um rascunho válido. Tente novamente.')
      // Refuse a stale result before exposing a draft; Save independently rechecks the captured bytes.
      this.options.writer.assertSnapshot(entry.vault, entry.snapshot)
      const draftToken = token()
      this.ensureCapacity(this.drafts)
      this.drafts.set(draftToken, { ...entry, expiresAt: this.now() + this.ttlMs, suggestedText })
      operation.entry = null
      return {
        draftToken,
        snippetId: entry.snippetId,
        baseVersionId: entry.baseVersionId,
        originalText: entry.originalText,
        suggestedText,
      }
    } catch (error) {
      // Never expose interpreter errors, which may contain prompt or response text.
      if (operation.timedOut || this.now() >= operation.deadline) {
        // Do not retain an interpreter error as `cause`; it could contain the prompt or response text.
        // eslint-disable-next-line preserve-caught-error
        throw new Error('A revisão excedeu o tempo limite.')
      }
      if (error instanceof Error && error.message === 'A revisão excedeu o tempo limite.') throw error
      if (error instanceof Error && error.message === 'A prévia expirou. Prepare a revisão novamente.') throw error
      if (error instanceof Error && error.message === 'A Escrita não devolveu um rascunho válido. Tente novamente.') throw error
      if (error instanceof Error && error.message.includes('mudou desde que você abriu')) throw error
      // Do not retain an interpreter error as `cause`: it could contain the prompt or response text.
      // eslint-disable-next-line preserve-caught-error
      throw new Error('Não foi possível concluir a revisão com a Escrita.')
    } finally {
      clearTimeout(timeout)
      if (this.pending.get(previewToken) === operation) this.pending.delete(previewToken)
      clearOperation(operation)
    }
  }

  cancel(previewToken: string): void {
    this.previews.delete(previewToken)
    const operation = this.pending.get(previewToken)
    if (operation) {
      this.pending.delete(previewToken)
      clearOperation(operation)
      operation.interrupt(new Error('A revisão foi cancelada.'))
    }
  }

  discard(draftToken: string): void {
    const entry = this.drafts.get(draftToken)
    if (entry) {
      entry.vault = ''
      entry.snapshot = null
      entry.snippetId = ''
      entry.baseVersionId = ''
      entry.originalText = ''
      entry.suggestedText = ''
      entry.expiresAt = 0
    }
    this.drafts.delete(draftToken)
  }

  /** Drop all ephemeral content and abort in-flight Claude calls when the app session ends. */
  shutdown(): void {
    for (const key of this.previews.keys()) this.cancel(key)
    for (const operation of this.pending.values()) operation.interrupt(new Error('A revisão foi cancelada.'))
    this.pending.clear()
    for (const key of this.drafts.keys()) this.discard(key)
    this.previews.clear()
  }

  saveDraft(draftToken: string, editedText: string): void {
    this.cleanExpired()
    if (typeof editedText !== 'string' || editedText.length < 1 || editedText.length > MAX_RESPONSE_LENGTH)
      throw new Error('O rascunho deve ter de 1 a 50.000 caracteres.')
    const entry = this.drafts.get(draftToken)
    this.drafts.delete(draftToken)
    if (!entry) throw new Error('O rascunho expirou ou já foi usado.')
    this.options.writer.appendVersion(entry.vault, {
      snippetId: entry.snippetId,
      baseVersionId: entry.baseVersionId,
      body: editedText,
      expectedSnapshot: entry.snapshot,
    })
  }

  private cleanExpired(): void {
    const now = this.now()
    for (const [key, value] of this.previews) if (value.expiresAt <= now) this.previews.delete(key)
    for (const [key, value] of this.drafts) if (value.expiresAt <= now) this.drafts.delete(key)
  }

  private ensureCapacity<T>(entries: Map<string, T>): void {
    while (entries.size >= MAX_ENTRIES) entries.delete(entries.keys().next().value!)
  }
}

export function createWritingAssistant(options: WritingAssistantOptions): WritingAssistant {
  return new WritingAssistant(options)
}
