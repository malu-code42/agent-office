import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWritingAssistant } from '../src/main/writing-assistant'
import { createWritingWriter } from '../src/main/writing-write'

const ipc = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => unknown>() }))
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => ipc.handlers.set(channel, handler) },
}))
const { registerWritingIpc } = await import('../src/main/ipc/writing')
const invoke = (channel: string, ...args: unknown[]) => ipc.handlers.get(channel)!(undefined, ...args)

let vault: string
let writer: ReturnType<typeof createWritingWriter>
let interpret: (context: string, signal: AbortSignal) => Promise<string>
let settings: { vaultPath?: string }
let snippetId: string
let versionId: string
let assistant: ReturnType<typeof createWritingAssistant>

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), 'ao-writing-ipc-'))
  settings = { vaultPath: vault }
  let id = 0
  writer = createWritingWriter({ newId: () => (++id === 1 ? 'a'.repeat(16) : 'b'.repeat(16)), now: () => new Date('2026-10-24T12:00:00Z') })
  writer.read(vault)
  writer.createOriginal(vault, { title: 'Rascunho', body: 'Texto original' })
  snippetId = writer.read(vault).snippets[0]!.id
  versionId = writer.read(vault).snippets[0]!.versions[0]!.versionId
  interpret = vi.fn(async (_context: string, _signal: AbortSignal): Promise<string> => 'Texto revisado')
  assistant = createWritingAssistant({ writer, interpret })
  ipc.handlers.clear()
  registerWritingIpc({
    store: {
      get settings() {
        return settings
      },
    },
    writing: writer,
    writingAssistant: assistant,
  } as never)
})

afterEach(() => rmSync(vault, { recursive: true, force: true }))

describe('writing IPC', () => {
  it('refuses malformed schemas and paths in the renderer payload', async () => {
    await expect(invoke('office:prepareWritingReview', '../vault', versionId, 'revise')).rejects.toThrow('Pedido de revisão inválido.')
    await expect(invoke('office:createWritingOriginal', { title: 'x\ny', body: 'body' })).rejects.toThrow('Original inválido.')
    await expect(invoke('office:createWritingOriginal', { title: 'x', body: 'x'.repeat(50_001), path: vault })).rejects.toThrow(
      'Original inválido.',
    )
    await expect(invoke('office:saveWritingDraft', 'invalid', 'body')).rejects.toThrow('Rascunho inválido.')
    await expect(invoke('office:sendWritingPreview', '../path')).rejects.toThrow('A prévia não é válida.')
  })

  it('reads the configured vault, then creates an Original only on the explicit save operation', async () => {
    const before = readFileSync(join(vault, 'escrita.md'))
    const result = (await invoke('office:readWriting', 'C:\\ignored')) as { snippets: { id: string }[] }
    expect(result.snippets).toHaveLength(1)
    expect(await invoke('office:createWritingOriginal', { title: 'Segundo', body: 'Mais texto' })).toMatch(/^w/)
    expect(writer.read(vault).snippets).toHaveLength(2)
    expect(readFileSync(join(vault, 'escrita.md'))).not.toEqual(before)
  })

  it('prepares the exact preview and sends only after confirmation, without writing before save', async () => {
    const before = readFileSync(join(vault, 'escrita.md'))
    const preview = (await invoke('office:prepareWritingReview', snippetId, versionId, 'Deixe mais claro')) as {
      token: string
      preview: string
    }
    expect(preview.preview).toContain('Texto original')
    expect(preview.preview).toContain('Deixe mais claro')
    expect(preview).not.toHaveProperty('context')
    expect(interpret).not.toHaveBeenCalled()
    expect(readFileSync(join(vault, 'escrita.md'))).toEqual(before)
    const draft = (await invoke('office:sendWritingPreview', preview.token)) as { draftToken: string; suggestedText: string }
    expect(draft.suggestedText).toBe('Texto revisado')
    expect(readFileSync(join(vault, 'escrita.md'))).toEqual(before)
    expect(existsSync(join(vault, 'tarefas.md'))).toBe(false)
    expect(existsSync(join(vault, 'agenda.md'))).toBe(false)
    expect(readdirSync(vault).filter((name) => name === 'planning.json')).toEqual([])
  })

  it('cancel and discard do not write; save appends a new version through the writer', async () => {
    const before = readFileSync(join(vault, 'escrita.md'))
    const canceled = (await invoke('office:prepareWritingReview', snippetId, versionId, 'Revise')) as { token: string }
    await invoke('office:cancelWritingPreview', canceled.token)
    expect(interpret).not.toHaveBeenCalled()
    expect(readFileSync(join(vault, 'escrita.md'))).toEqual(before)
    const preview = (await invoke('office:prepareWritingReview', snippetId, versionId, 'Revise')) as { token: string }
    const draft = (await invoke('office:sendWritingPreview', preview.token)) as { draftToken: string }
    await invoke('office:discardWritingDraft', draft.draftToken)
    expect(readFileSync(join(vault, 'escrita.md'))).toEqual(before)
    const preview2 = (await invoke('office:prepareWritingReview', snippetId, versionId, 'Revise')) as { token: string }
    const draft2 = (await invoke('office:sendWritingPreview', preview2.token)) as { draftToken: string }
    await invoke('office:saveWritingDraft', draft2.draftToken, 'Texto editado e confirmado')
    const versions = writer.read(vault).snippets[0]!.versions
    expect(versions).toHaveLength(2)
    expect(versions[1]).toMatchObject({ body: 'Texto editado e confirmado', source: 'escrita', baseVersionId: versionId })
  })

  it('rejects a stale draft and invalid identifiers/bodies without changing the file', async () => {
    const preview = (await invoke('office:prepareWritingReview', snippetId, versionId, 'Revise')) as { token: string }
    const draft = (await invoke('office:sendWritingPreview', preview.token)) as { draftToken: string }
    const before = readFileSync(join(vault, 'escrita.md'))
    writeFileSync(join(vault, 'escrita.md'), before.toString() + '\nEdi\u00e7\u00e3o externa\n')
    const changed = readFileSync(join(vault, 'escrita.md'))
    await expect(invoke('office:saveWritingDraft', draft.draftToken, 'Texto revisado')).rejects.toThrow('mudou desde que')
    await expect(invoke('office:prepareWritingReview', 'wbad', 'vbad', 'Revise')).rejects.toThrow('Pedido de revisão inválido.')
    await expect(invoke('office:saveWritingDraft', draft.draftToken, '')).rejects.toThrow('Rascunho inválido.')
    expect(readFileSync(join(vault, 'escrita.md'))).toEqual(changed)
  })

  it('refuses operations when no vault is selected and never exposes a path in the result', async () => {
    settings.vaultPath = undefined
    await expect(invoke('office:readWriting')).rejects.toThrow('Configure a pasta do vault')
  })

  it('hides local paths when reading or writing escrita.md fails', async () => {
    const sensitiveVault = join(vault, 'Sensitive Local Vault')
    mkdirSync(sensitiveVault)
    mkdirSync(join(sensitiveVault, 'escrita.md'))
    settings.vaultPath = sensitiveVault

    let readError: Error | undefined
    try {
      await invoke('office:readWriting')
    } catch (error) {
      readError = error as Error
    }
    expect(readError?.message).toBe('Não foi possível ler a biblioteca de escrita. Verifique escrita.md e tente novamente.')
    expect(readError?.message).not.toContain(sensitiveVault)

    let writeError: Error | undefined
    try {
      await invoke('office:createWritingOriginal', { title: 'Novo', body: 'Texto' })
    } catch (error) {
      writeError = error as Error
    }
    expect(writeError?.message).toBe('Não foi possível salvar o Original. Recarregue a biblioteca e tente novamente.')
    expect(writeError?.message).not.toContain(sensitiveVault)
  })
})
