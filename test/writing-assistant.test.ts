import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWritingAssistant, type WritingInterpreter } from '../src/main/writing-assistant'
import { createWritingWriter } from '../src/main/writing-write'
import { parseWriting } from '../src/shared/writing'

const roots: string[] = []
function vault(): string {
  const root = mkdtempSync(join(tmpdir(), 'writing-assistant-'))
  roots.push(root)
  return root
}
function writer() {
  let id = 0
  return createWritingWriter({ newId: () => `${id++}`.padStart(8, '0') })
}
function seeded(root: string) {
  const subject = writer()
  subject.read(root)
  const id = subject.createOriginal(root, { title: 'Meu texto', body: 'Corpo selecionado.' })
  const snapshot = subject.read(root)
  const selected = snapshot.snippets[0]!.latestVersion()
  subject.createOriginal(root, { title: 'Outro texto secreto', body: 'Não incluir outro trecho.' })
  // Restore the initial snapshot for the assistant's setup and retain a second snippet on disk.
  subject.read(root)
  return { subject, id, selected }
}
function makeAssistant(
  subject: ReturnType<typeof writer>,
  interpret: WritingInterpreter['interpret'] = vi.fn(async () => 'Sugestão revisada.'),
  now = () => Date.now(),
) {
  return { assistant: createWritingAssistant({ writer: subject, interpret, now, ttlMs: 1_000 }), interpret }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('WritingAssistant', () => {
  it('prepara prévia restrita à versão escolhida, instrução e perfil Escrita', () => {
    const root = vault()
    const { subject, id, selected } = seeded(root)
    const { assistant } = makeAssistant(subject)
    const prepared = assistant.prepare(root, id, selected.versionId, 'Revise a clareza.')
    expect(prepared.preview).toContain('Meu texto')
    expect(prepared.preview).toContain(id)
    expect(prepared.preview).toContain(selected.versionId)
    expect(prepared.preview).toContain('Corpo selecionado.')
    expect(prepared.preview).toContain('Revise a clareza.')
    expect(prepared.preview).toContain('Work as Escrita')
    expect(prepared.preview).not.toContain('Outro texto secreto')
    expect(prepared.preview).not.toContain('Não incluir outro trecho.')
    expect(prepared.preview).not.toMatch(/tasks\.md|agenda\.md|memories|planning\.json/i)
  })

  it('cancelar limpa a prévia sem persistir ou chamar o interpreter', async () => {
    const root = vault()
    const { subject, id, selected } = seeded(root)
    const { assistant, interpret } = makeAssistant(subject)
    const before = readFileSync(join(root, 'escrita.md'), 'utf8')
    const preview = assistant.prepare(root, id, selected.versionId, 'Revise.')
    assistant.cancel(preview.token)
    await expect(assistant.send(preview.token)).rejects.toThrow()
    expect(interpret).not.toHaveBeenCalled()
    expect(readFileSync(join(root, 'escrita.md'), 'utf8')).toBe(before)
  })

  it('cancelar depois de send aborta a operação e descarta uma resposta tardia', async () => {
    const root = vault()
    const { subject, id, selected } = seeded(root)
    let resolve!: (value: string) => void
    let signal!: AbortSignal
    const interpret = vi.fn((_context: string, receivedSignal: AbortSignal) => {
      signal = receivedSignal
      return new Promise<string>((done) => (resolve = done))
    })
    const { assistant } = makeAssistant(subject, interpret)
    const before = readFileSync(join(root, 'escrita.md'), 'utf8')
    const preview = assistant.prepare(root, id, selected.versionId, 'Revise.')
    const sending = assistant.send(preview.token)
    assistant.cancel(preview.token)
    expect(signal.aborted).toBe(true)
    resolve('Resposta tardia.')
    await expect(sending).rejects.toThrow()
    expect(assistant['drafts'].size).toBe(0)
    expect(readFileSync(join(root, 'escrita.md'), 'utf8')).toBe(before)
    expect(() => assistant.saveDraft('qualquer-token', 'Tentativa de salvar.')).toThrow()
  })

  it('cancelar rejeita send mesmo se o interpreter nunca resolver', async () => {
    const root = vault()
    const { subject, id, selected } = seeded(root)
    let signal!: AbortSignal
    const interpret = vi.fn((_context: string, receivedSignal: AbortSignal) => {
      signal = receivedSignal
      return new Promise<string>(() => {})
    })
    const assistant = createWritingAssistant({ writer: subject, interpret, ttlMs: 1_000, timeoutMs: 25 })
    const before = readFileSync(join(root, 'escrita.md'), 'utf8')
    const preview = assistant.prepare(root, id, selected.versionId, 'Revise.')
    const sending = assistant.send(preview.token)
    assistant.cancel(preview.token)
    await expect(sending).rejects.toThrow()
    expect(signal.aborted).toBe(true)
    expect(assistant['pending'].size).toBe(0)
    expect(assistant['drafts'].size).toBe(0)
    expect(readFileSync(join(root, 'escrita.md'), 'utf8')).toBe(before)
    expect(() => assistant.saveDraft('qualquer-token', 'Tentativa de salvar.')).toThrow()
  })

  it('timeout invalida resposta tardia de interpreter que ignora o signal', async () => {
    const root = vault()
    const { subject, id, selected } = seeded(root)
    let resolve!: (value: string) => void
    let signal!: AbortSignal
    const interpret = vi.fn((_context: string, receivedSignal: AbortSignal) => {
      signal = receivedSignal
      return new Promise<string>((done) => (resolve = done))
    })
    const assistant = createWritingAssistant({ writer: subject, interpret, ttlMs: 1_000, timeoutMs: 25 })
    const assertSnapshot = vi.spyOn(subject, 'assertSnapshot')
    const before = readFileSync(join(root, 'escrita.md'), 'utf8')
    const preview = assistant.prepare(root, id, selected.versionId, 'Revise.')
    vi.useFakeTimers()
    try {
      const sending = assistant.send(preview.token)
      const rejection = expect(sending).rejects.toThrow(/tempo|timeout|expirou/i)
      await vi.advanceTimersByTimeAsync(25)
      expect(signal.aborted).toBe(true)
      resolve('Resposta depois do timeout.')
      await rejection
      expect(assertSnapshot).not.toHaveBeenCalled()
      expect(assistant['drafts'].size).toBe(0)
      expect(readFileSync(join(root, 'escrita.md'), 'utf8')).toBe(before)
      expect(() => assistant.saveDraft('qualquer-token', 'Tentativa de salvar.')).toThrow()
    } finally {
      vi.useRealTimers()
    }
  })

  it('timeout rejeita send mesmo se o interpreter nunca resolver', async () => {
    const root = vault()
    const { subject, id, selected } = seeded(root)
    let signal!: AbortSignal
    const interpret = vi.fn((_context: string, receivedSignal: AbortSignal) => {
      signal = receivedSignal
      return new Promise<string>(() => {})
    })
    const assistant = createWritingAssistant({ writer: subject, interpret, ttlMs: 1_000, timeoutMs: 25 })
    const assertSnapshot = vi.spyOn(subject, 'assertSnapshot')
    const before = readFileSync(join(root, 'escrita.md'), 'utf8')
    const preview = assistant.prepare(root, id, selected.versionId, 'Revise.')
    vi.useFakeTimers()
    try {
      const sending = assistant.send(preview.token)
      const rejection = expect(sending).rejects.toThrow(/tempo|timeout|expirou/i)
      await vi.advanceTimersByTimeAsync(25)
      await rejection
      expect(signal.aborted).toBe(true)
      expect(assistant['pending'].size).toBe(0)
      expect(assertSnapshot).not.toHaveBeenCalled()
      expect(assistant['drafts'].size).toBe(0)
      expect(readFileSync(join(root, 'escrita.md'), 'utf8')).toBe(before)
      expect(() => assistant.saveDraft('qualquer-token', 'Tentativa de salvar.')).toThrow()
    } finally {
      vi.useRealTimers()
    }
  })

  it('abort normal do interpreter ao cancelar rejeita send', async () => {
    const root = vault()
    const { subject, id, selected } = seeded(root)
    const interpret = vi.fn(
      (_context: string, signal: AbortSignal) =>
        new Promise<string>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('cancelado')), { once: true })
        }),
    )
    const { assistant } = makeAssistant(subject, interpret)
    const preview = assistant.prepare(root, id, selected.versionId, 'Revise.')
    const sending = assistant.send(preview.token)
    assistant.cancel(preview.token)
    await expect(sending).rejects.toThrow()
  })

  it('send retorna rascunho efêmero sem gravar e consome token uma vez', async () => {
    const root = vault()
    const { subject, id, selected } = seeded(root)
    const { assistant, interpret } = makeAssistant(subject)
    const before = readFileSync(join(root, 'escrita.md'), 'utf8')
    const preview = assistant.prepare(root, id, selected.versionId, 'Revise.')
    const draft = await assistant.send(preview.token)
    expect(interpret).toHaveBeenCalledOnce()
    expect(draft).toMatchObject({ baseVersionId: selected.versionId, originalText: selected.body, suggestedText: 'Sugestão revisada.' })
    expect(draft.draftToken).toBeTruthy()
    expect(readFileSync(join(root, 'escrita.md'), 'utf8')).toBe(before)
    await expect(assistant.send(preview.token)).rejects.toThrow()
  })

  it.each([
    ['empty', async () => '  '],
    ['oversized', async () => 'x'.repeat(50_001)],
    [
      'error',
      async () => {
        throw new Error('falha sem conteúdo')
      },
    ],
  ])('não cria rascunho nem persiste em resposta %s', async (_case, interpret) => {
    const root = vault()
    const { subject, id, selected } = seeded(root)
    const { assistant } = makeAssistant(subject, vi.fn(interpret))
    const before = readFileSync(join(root, 'escrita.md'), 'utf8')
    const preview = assistant.prepare(root, id, selected.versionId, 'Revise.')
    await expect(assistant.send(preview.token)).rejects.toThrow()
    expect(readFileSync(join(root, 'escrita.md'), 'utf8')).toBe(before)
  })

  it('expira previews e drafts sem guardar conteúdo e respeita uso único', async () => {
    const root = vault()
    const { subject, id, selected } = seeded(root)
    let now = 100
    const { assistant } = makeAssistant(
      subject,
      vi.fn(async () => 'Sugestão.'),
      () => now,
    )
    const preview = assistant.prepare(root, id, selected.versionId, 'Revise.')
    now += 1_001
    await expect(assistant.send(preview.token)).rejects.toThrow()
    const valid = assistant.prepare(root, id, selected.versionId, 'Revise.')
    const draft = await assistant.send(valid.token)
    now += 1_001
    expect(() => assistant.saveDraft(draft.draftToken, 'Editado.')).toThrow()
  })

  it('salva exatamente o texto editado e preserva a versão base', async () => {
    const root = vault()
    const { subject, id, selected } = seeded(root)
    const { assistant } = makeAssistant(subject)
    const preview = assistant.prepare(root, id, selected.versionId, 'Revise.')
    const draft = await assistant.send(preview.token)
    assistant.saveDraft(draft.draftToken, 'Texto editado pela usuária.')
    const saved = parseWriting(readFileSync(join(root, 'escrita.md'), 'utf8')).snippets.find((s) => s.id === id)!
    expect(saved.versions.at(-1)).toMatchObject({
      body: 'Texto editado pela usuária.',
      baseVersionId: selected.versionId,
      source: 'escrita',
    })
  })

  it('recusa conflito após send mesmo se outro read atualizou o snapshot do writer', async () => {
    const root = vault()
    const { subject, id, selected } = seeded(root)
    const { assistant } = makeAssistant(subject)
    const preview = assistant.prepare(root, id, selected.versionId, 'Revise.')
    const draft = await assistant.send(preview.token)
    const changed = readFileSync(join(root, 'escrita.md'), 'utf8') + '\nEdição externa\n'
    writeFileSync(join(root, 'escrita.md'), changed)
    subject.read(root)
    expect(() => assistant.saveDraft(draft.draftToken, 'Revisão.')).toThrow(/mudou|conflito/i)
    expect(readFileSync(join(root, 'escrita.md'), 'utf8')).toBe(changed)
  })

  it('detecta stale durante a chamada e preserva nova versão no disco', async () => {
    const root = vault()
    const { subject, id, selected } = seeded(root)
    let during: string | undefined
    const interpret = vi.fn(async () => {
      during = readFileSync(join(root, 'escrita.md'), 'utf8') + '\nMudança externa\n'
      writeFileSync(join(root, 'escrita.md'), during)
      return 'Sugestão.'
    })
    const { assistant } = makeAssistant(subject, interpret)
    const preview = assistant.prepare(root, id, selected.versionId, 'Revise.')
    await expect(assistant.send(preview.token)).rejects.toThrow(/mudou|conflito/i)
    expect(readFileSync(join(root, 'escrita.md'), 'utf8')).toBe(during)
  })

  it('discard limpa rascunho sem gravar', async () => {
    const root = vault()
    const { subject, id, selected } = seeded(root)
    const { assistant } = makeAssistant(subject)
    const before = readFileSync(join(root, 'escrita.md'), 'utf8')
    const preview = assistant.prepare(root, id, selected.versionId, 'Revise.')
    const draft = await assistant.send(preview.token)
    assistant.discard(draft.draftToken)
    expect(() => assistant.saveDraft(draft.draftToken, 'Editado.')).toThrow()
    expect(readFileSync(join(root, 'escrita.md'), 'utf8')).toBe(before)
  })

  it('valida limites de instrução e texto editado', async () => {
    const root = vault()
    const { subject, id, selected } = seeded(root)
    const { assistant } = makeAssistant(subject)
    expect(() => assistant.prepare(root, id, selected.versionId, 'x'.repeat(2_001))).toThrow()
    const preview = assistant.prepare(root, id, selected.versionId, 'x'.repeat(2_000))
    const draft = await assistant.send(preview.token)
    expect(() => assistant.saveDraft(draft.draftToken, 'x'.repeat(50_001))).toThrow()
    assistant.saveDraft(draft.draftToken, 'x'.repeat(50_000))
  })

  it('não registra conteúdo sensível em logs', async () => {
    const root = vault()
    const { subject, id, selected } = seeded(root)
    const logs = vi.spyOn(console, 'log')
    const errors = vi.spyOn(console, 'error')
    const { assistant } = makeAssistant(subject)
    const preview = assistant.prepare(root, id, selected.versionId, 'INSTRUÇÃO SENSÍVEL')
    await assistant.send(preview.token)
    expect([...logs.mock.calls, ...errors.mock.calls].flat().join(' ')).not.toContain('INSTRUÇÃO SENSÍVEL')
  })
})
