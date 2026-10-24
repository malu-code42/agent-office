import {
  closeSync,
  fsyncSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWritingWriter } from '../src/main/writing-write'
import { parseWriting } from '../src/shared/writing'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, closeSync: vi.fn(actual.closeSync), fsyncSync: vi.fn(actual.fsyncSync), rmSync: vi.fn(actual.rmSync) }
})

const roots: string[] = []
function vault(): string {
  const root = mkdtempSync(join(tmpdir(), 'writing-writer-'))
  roots.push(root)
  return root
}
function writer() {
  let id = 0
  return createWritingWriter({
    now: () => new Date(2026, 9, 24, 10, 11, 12),
    newId: () => (id++ === 0 ? 'abc12345' : 'def67890'),
  })
}
function backupFiles(root: string): string[] {
  return readdirSync(join(root, 'backups', 'escrita'))
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('createWritingWriter', () => {
  it('recusa UTF-8 inválido na leitura sem alterar bytes nem criar backup', () => {
    const root = vault()
    const invalid = Buffer.from([0x23, 0x20, 0x4e, 0xff, 0x0a])
    writeFileSync(join(root, 'escrita.md'), invalid)
    const subject = writer()

    expect(() => subject.read(root)).toThrow(/UTF-8 inválido.*manualmente/i)
    expect(readFileSync(join(root, 'escrita.md'))).toEqual(invalid)
    expect(() => readdirSync(join(root, 'backups', 'escrita'))).toThrow()
  })

  it('recusa salvar se escrita.md se tornar UTF-8 inválido após o snapshot', () => {
    const root = vault()
    const subject = writer()
    subject.read(root)
    subject.createOriginal(root, { title: 'Ideia', body: 'Original.' })
    const selected = subject.read(root).snippets[0]!.latestVersion()
    const invalid = Buffer.from([0x23, 0x20, 0xff, 0x0a])
    const backupsBefore = backupFiles(root)
    writeFileSync(join(root, 'escrita.md'), invalid)

    expect(() =>
      subject.appendVersion(root, {
        snippetId: 'wabc12345',
        baseVersionId: selected.versionId,
        body: 'Revisado.',
      }),
    ).toThrow(/UTF-8 inválido.*manualmente/i)
    expect(readFileSync(join(root, 'escrita.md'))).toEqual(invalid)
    expect(backupFiles(root)).toEqual(backupsBefore)
  })

  it('cria Original após read e mantém texto desconhecido intacto', () => {
    const root = vault()
    const subject = writer()
    writeFileSync(join(root, 'escrita.md'), '# Minhas notas\nlinha livre\n')
    const before = subject.read(root)
    const id = subject.createOriginal(root, { title: 'Ideia', body: 'Texto original.' })
    const text = readFileSync(join(root, 'escrita.md'), 'utf8')
    expect(before.snippets).toHaveLength(0)
    expect(id).toBe('wabc12345')
    expect(text).toContain('# Minhas notas\nlinha livre\n')
    expect(parseWriting(text).snippets[0]?.latestVersion()).toMatchObject({ source: 'original', body: 'Texto original.' })
    expect(backupFiles(root)).toEqual(['escrita-2026-10-24-101112.md'])
  })

  it('anexa versão à base existente sem alterar Original, versões e conteúdo desconhecido', () => {
    const root = vault()
    const subject = writer()
    subject.read(root)
    subject.createOriginal(root, { title: 'Ideia', body: 'Original.' })
    const originalText = readFileSync(join(root, 'escrita.md'), 'utf8')
    const original = parseWriting(originalText).snippets[0]!.latestVersion()
    subject.read(root)
    subject.appendVersion(root, { snippetId: 'wabc12345', baseVersionId: original.versionId, body: 'Revisado.' })
    const after = readFileSync(join(root, 'escrita.md'), 'utf8')
    const versions = parseWriting(after).snippets[0]!.versions
    expect(after).toContain(originalText)
    expect(after).toContain('Original.')
    expect(versions).toHaveLength(2)
    expect(versions[1]).toMatchObject({ number: 2, source: 'escrita', baseVersionId: original.versionId, body: 'Revisado.' })
  })

  it('recusa versão com base inexistente sem gravar', () => {
    const root = vault()
    const subject = writer()
    subject.read(root)
    subject.createOriginal(root, { title: 'Ideia', body: 'Original.' })
    subject.read(root)
    const before = readFileSync(join(root, 'escrita.md'), 'utf8')
    expect(() => subject.appendVersion(root, { snippetId: 'wabc12345', baseVersionId: 'vmissing99', body: 'Revisado.' })).toThrow(/base/i)
    expect(readFileSync(join(root, 'escrita.md'), 'utf8')).toBe(before)
  })

  it('detecta conflito após read sem criar backup nem escrever', () => {
    const root = vault()
    const subject = writer()
    subject.read(root)
    writeFileSync(join(root, 'escrita.md'), 'edição externa\n')
    expect(() => subject.createOriginal(root, { title: 'Ideia', body: 'Texto.' })).toThrow(/mudou|conflito/i)
    expect(readFileSync(join(root, 'escrita.md'), 'utf8')).toBe('edição externa\n')
    expect(() => readdirSync(join(root, 'backups', 'escrita'))).toThrow()
  })

  it('cria backup datado sem sobrescrever backups existentes', () => {
    const root = vault()
    const subject = writer()
    const source = 'texto existente\n'
    writeFileSync(join(root, 'escrita.md'), source)
    mkdirSync(join(root, 'backups', 'escrita'), { recursive: true })
    writeFileSync(join(root, 'backups', 'escrita', 'escrita-2026-10-24-101112.md'), 'backup antigo')
    subject.read(root)
    subject.createOriginal(root, { title: 'Ideia', body: 'Texto.' })
    expect(backupFiles(root).sort()).toEqual(['escrita-2026-10-24-101112-2.md', 'escrita-2026-10-24-101112.md'])
    expect(readFileSync(join(root, 'backups', 'escrita', 'escrita-2026-10-24-101112.md'), 'utf8')).toBe('backup antigo')
    expect(readFileSync(join(root, 'backups', 'escrita', 'escrita-2026-10-24-101112-2.md'), 'utf8')).toBe(source)
  })

  it('não altera escrita.md quando a criação do backup falha', () => {
    const root = vault()
    const subject = writer()
    const source = 'texto existente\n'
    writeFileSync(join(root, 'escrita.md'), source)
    mkdirSync(join(root, 'backups'))
    writeFileSync(join(root, 'backups', 'escrita'), 'não é diretório')
    subject.read(root)
    expect(() => subject.createOriginal(root, { title: 'Ideia', body: 'Texto.' })).toThrow()
    expect(readFileSync(join(root, 'escrita.md'), 'utf8')).toBe(source)
  })

  it('usa escrita atômica e não deixa arquivo temporário', () => {
    const root = vault()
    const subject = writer()
    subject.read(root)
    subject.createOriginal(root, { title: 'Ideia', body: 'Texto.' })
    expect(readdirSync(root).sort()).toEqual(['backups', 'escrita.md'])
    expect(readdirSync(join(root, 'backups', 'escrita'))).toEqual(['escrita-2026-10-24-101112.md'])
  })

  it('preserva edição externa que ocorre enquanto o temp canônico é preparado', async () => {
    const root = vault()
    const subject = writer()
    subject.read(root)
    const originalFsync = (await vi.importActual<typeof import('node:fs')>('node:fs')).fsyncSync
    let fsyncCount = 0
    vi.mocked(fsyncSync).mockImplementation((fd) => {
      originalFsync(fd)
      fsyncCount++
      // First fsync is the backup; the second is the staged canonical file.
      if (fsyncCount === 2) writeFileSync(join(root, 'escrita.md'), 'edição externa durante staging\n')
    })

    try {
      expect(() => subject.createOriginal(root, { title: 'Ideia', body: 'Não gravar.' })).toThrow(/mudou|conflito/i)
    } finally {
      vi.restoreAllMocks()
    }

    expect(readFileSync(join(root, 'escrita.md'), 'utf8')).toBe('edição externa durante staging\n')
    expect(readdirSync(root).filter((name) => name.startsWith('escrita.md.'))).toEqual([])
  })

  it('compara bytes no último instante e preserva edição externa após staging do temporário', () => {
    const root = vault()
    const subject = createWritingWriter({
      now: () => new Date(2026, 9, 24, 10, 11, 12),
      newId: () => 'abc12345',
      afterCanonicalTempWrite: () => writeFileSync(join(root, 'escrita.md'), Buffer.from([0x61, 0x62])),
    })
    writeFileSync(join(root, 'escrita.md'), Buffer.from([0x61, 0x63]))
    subject.read(root)

    expect(() => subject.createOriginal(root, { title: 'Ideia', body: 'Não gravar.' })).toThrow(/mudou|conflito/i)
    expect(readFileSync(join(root, 'escrita.md'))).toEqual(Buffer.from([0x61, 0x62]))
    expect(readdirSync(root).filter((name) => name.startsWith('escrita.md.'))).toEqual([])
  })

  it('não publica lock se a escrita temporária falhar e preserva a mensagem original', async () => {
    const root = vault()
    const subject = writer()
    subject.read(root)
    const originalFsync = (await vi.importActual<typeof import('node:fs')>('node:fs')).fsyncSync
    let fsyncCount = 0
    vi.mocked(fsyncSync).mockImplementation((fd) => {
      fsyncCount++
      if (fsyncCount === 1) throw new Error('Falha ao sincronizar temporário do lock')
      originalFsync(fd)
    })

    try {
      expect(() => subject.createOriginal(root, { title: 'Ideia', body: 'Texto.' })).toThrow('Falha ao sincronizar temporário do lock')
    } finally {
      vi.restoreAllMocks()
    }

    expect(() => readFileSync(join(root, 'escrita.md.lock'))).toThrow()
    expect(readdirSync(root).filter((name) => name.includes('.lock.'))).toEqual([])
  })

  it('não segue escrita.md.tmp symlink ao gravar', () => {
    const root = vault()
    const outside = join(vault(), 'fora.txt')
    const subject = writer()
    writeFileSync(outside, 'segredo externo')
    symlinkSync(outside, join(root, 'escrita.md.tmp'))
    subject.read(root)
    subject.createOriginal(root, { title: 'Ideia', body: 'Texto.' })
    expect(readFileSync(outside, 'utf8')).toBe('segredo externo')
    expect(readFileSync(join(root, 'escrita.md'), 'utf8')).toContain('Texto.')
    expect(readFileSync(outside, 'utf8')).not.toContain('Texto.')
  })

  it('preserva backup em colisão de timestamp e ID', () => {
    const root = vault()
    writeFileSync(join(root, 'escrita.md'), 'texto novo para backup\n')
    const dir = join(root, 'backups', 'escrita')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'escrita-2026-10-24-101112.md'), 'backup anterior um')
    writeFileSync(join(dir, 'escrita-2026-10-24-101112-2.md'), 'backup anterior dois')
    let id = 0
    const makeWriter = () => {
      return createWritingWriter({
        now: () => new Date(2026, 9, 24, 10, 11, 12),
        newId: () => (id++ === 0 ? 'abc12345' : `def6789${id}`),
        newBackupId: () => 'colisao',
      })
    }
    const first = makeWriter()
    first.read(root)
    first.createOriginal(root, { title: 'Ideia', body: 'Texto.' })
    const firstText = readFileSync(join(root, 'escrita.md'), 'utf8')
    const second = makeWriter()
    second.read(root)
    second.createOriginal(root, { title: 'Outra ideia', body: 'Outro texto.' })
    expect(readFileSync(join(dir, 'escrita-2026-10-24-101112.md'), 'utf8')).toBe('backup anterior um')
    expect(readFileSync(join(dir, 'escrita-2026-10-24-101112-2.md'), 'utf8')).toBe('backup anterior dois')
    const added = backupFiles(root).filter((name) => name !== 'escrita-2026-10-24-101112.md' && name !== 'escrita-2026-10-24-101112-2.md')
    expect(added).toHaveLength(2)
    expect(added.map((name) => readFileSync(join(dir, name), 'utf8'))).toEqual(
      expect.arrayContaining(['texto novo para backup\n', firstText]),
    )
  })

  it('serializa writers e libera o lock após falha busy', () => {
    const root = vault()
    const second = writer()
    let attempted = false
    const first = createWritingWriter({
      now: () => new Date(2026, 9, 24, 10, 11, 12),
      newId: () => 'first123',
      newBackupId: () => {
        attempted = true
        expect(() => second.createOriginal(root, { title: 'Concorrente', body: 'Não gravar.' })).toThrow(/ocupad|aguarde/i)
        return 'backup-id'
      },
    })
    writeFileSync(join(root, 'escrita.md'), 'original\n')
    first.read(root)
    second.read(root)
    mkdirSync(join(root, 'backups', 'escrita'), { recursive: true })
    writeFileSync(join(root, 'backups', 'escrita', 'escrita-2026-10-24-101112.md'), 'colisão')
    writeFileSync(join(root, 'backups', 'escrita', 'escrita-2026-10-24-101112-2.md'), 'colisão 2')
    first.createOriginal(root, { title: 'Primeiro', body: 'Gravado.' })
    expect(attempted).toBe(true)
    expect(readFileSync(join(root, 'escrita.md'), 'utf8')).toContain('Gravado.')
    expect(readFileSync(join(root, 'escrita.md'), 'utf8')).not.toContain('Não gravar.')
    second.read(root)
    expect(() => second.createOriginal(root, { title: 'Depois', body: 'Agora grava.' })).not.toThrow()
  })

  it('recusa lock stale sem removê-lo e falha fechado para lock ambíguo', () => {
    const root = vault()
    const lock = join(root, 'escrita.md.lock')
    const subject = writer()
    subject.read(root)
    writeFileSync(lock, JSON.stringify({ pid: 2147483647, nonce: '0123456789abcdef0123456789abcdef' }))
    expect(() => subject.createOriginal(root, { title: 'Ideia', body: 'Texto.' })).toThrow(/manualmente|confirme/i)
    expect(readFileSync(lock, 'utf8')).toContain('2147483647')
    expect(() => readFileSync(join(root, 'escrita.md'), 'utf8')).toThrow()

    const ambiguous = vault()
    const blocked = writer()
    blocked.read(ambiguous)
    writeFileSync(join(ambiguous, 'escrita.md.lock'), '{"pid":')
    expect(() => blocked.createOriginal(ambiguous, { title: 'Ideia', body: 'Texto.' })).toThrow(/recuper|lock/i)
    expect(() => readFileSync(join(ambiguous, 'escrita.md'), 'utf8')).toThrow()
  })

  it('completa escritas curtas no staging do owner e limpa o temporário', () => {
    const root = vault()
    let id = 0
    const subject = createWritingWriter({
      now: () => new Date(2026, 9, 24, 10, 11, 12),
      newId: () => `abc1234${id++}`,
      writeSync: (fd, buffer, offset, length) => writeSync(fd, buffer, offset, Math.max(1, Math.floor(length / 2))),
    })
    subject.read(root)

    expect(() => subject.createOriginal(root, { title: 'Ideia', body: 'Texto.' })).not.toThrow()
    const lockFiles = readdirSync(root).filter((name) => name.includes('.lock.'))
    expect(lockFiles).toEqual([])
    expect(readFileSync(join(root, 'escrita.md'), 'utf8')).toContain('Texto.')
  })

  it('não publica lock nem deixa temporário se o staging do owner falha', () => {
    const root = vault()
    const subject = createWritingWriter({
      writeSync: () => {
        throw new Error('Falha ao escrever owner')
      },
    })
    subject.read(root)

    expect(() => subject.createOriginal(root, { title: 'Ideia', body: 'Texto.' })).toThrow('Falha ao escrever owner')
    expect(() => readFileSync(join(root, 'escrita.md.lock'))).toThrow()
    expect(readdirSync(root).filter((name) => name.includes('.lock.'))).toEqual([])
    expect(() => readFileSync(join(root, 'escrita.md'))).toThrow()
  })

  it('limpa temp se closeSync falhar durante staging e preserva escrita.md e o erro original', async () => {
    const root = vault()
    const subject = writer()
    const source = 'texto que deve permanecer\n'
    writeFileSync(join(root, 'escrita.md'), source)
    subject.read(root)
    const originalClose = (await vi.importActual<typeof import('node:fs')>('node:fs')).closeSync
    let closeCount = 0
    vi.mocked(closeSync).mockImplementation((fd) => {
      closeCount++
      originalClose(fd)
      // Lock closes first; fail the following close while staging the backup sibling.
      if (closeCount === 2) throw new Error('Falha original no close do temp')
    })

    try {
      expect(() => subject.createOriginal(root, { title: 'Ideia', body: 'Texto.' })).toThrow('Falha original no close do temp')
    } finally {
      vi.restoreAllMocks()
    }

    expect(readFileSync(join(root, 'escrita.md'), 'utf8')).toBe(source)
    expect(readdirSync(root).filter((name) => name.includes('.tmp'))).toEqual([])
    expect(() => readFileSync(join(root, 'escrita.md.lock'))).toThrow()
  })

  it('remove lock publicado se rmSync do temp lock falhar uma vez', async () => {
    const root = vault()
    const subject = writer()
    subject.read(root)
    const originalRm = (await vi.importActual<typeof import('node:fs')>('node:fs')).rmSync
    let failedTempCleanup = false
    vi.mocked(rmSync).mockImplementation((path, options) => {
      if (!failedTempCleanup && String(path).includes('.lock.') && String(path).endsWith('.tmp')) {
        failedTempCleanup = true
        throw new Error('Falha temporária ao remover temp lock')
      }
      originalRm(path, options)
    })

    try {
      expect(() => subject.createOriginal(root, { title: 'Ideia', body: 'Texto.' })).toThrow('Falha temporária ao remover temp lock')
    } finally {
      vi.restoreAllMocks()
    }

    expect(failedTempCleanup).toBe(true)
    expect(() => readFileSync(join(root, 'escrita.md.lock'))).toThrow()
    expect(readdirSync(root).filter((name) => name.includes('.lock.') || name.includes('.tmp'))).toEqual([])
    expect(() => readFileSync(join(root, 'escrita.md'))).toThrow()
  })

  it('instrui recuperação manual sem remover lock concorrente se rollback não puder liberar o lock', async () => {
    const root = vault()
    const subject = writer()
    subject.read(root)
    const originalRm = (await vi.importActual<typeof import('node:fs')>('node:fs')).rmSync
    const foreignOwner = JSON.stringify({ pid: process.pid, nonce: '0123456789abcdef0123456789abcdef' })
    let failedTempCleanup = false
    vi.mocked(rmSync).mockImplementation((path, options) => {
      if (!failedTempCleanup && String(path).includes('.lock.') && String(path).endsWith('.tmp')) {
        failedTempCleanup = true
        writeFileSync(join(root, 'escrita.md.lock'), foreignOwner)
        throw new Error('Falha ao remover temp lock')
      }
      originalRm(path, options)
    })

    try {
      expect(() => subject.createOriginal(root, { title: 'Ideia', body: 'Texto.' })).toThrow(/manualmente|recupera/i)
    } finally {
      vi.restoreAllMocks()
    }

    expect(readFileSync(join(root, 'escrita.md.lock'), 'utf8')).toBe(foreignOwner)
    expect(() => readFileSync(join(root, 'escrita.md'))).toThrow()
  })

  it('recusa lock symlink sem seguir o destino', () => {
    const root = vault()
    const outside = join(vault(), 'lock-data')
    writeFileSync(outside, 'preservar')
    symlinkSync(outside, join(root, 'escrita.md.lock'))
    const subject = writer()
    subject.read(root)
    expect(() => subject.createOriginal(root, { title: 'Ideia', body: 'Texto.' })).toThrow(/atalho|symlink|lock/i)
    expect(readFileSync(outside, 'utf8')).toBe('preservar')
    expect(() => readFileSync(join(root, 'escrita.md'), 'utf8')).toThrow()
  })

  it('recusa escrita.md que seja symlink', () => {
    const root = vault()
    const target = join(root, 'alvo.md')
    writeFileSync(target, 'preservar')
    symlinkSync(target, join(root, 'escrita.md'))
    expect(() => writer().read(root)).toThrow(/atalho|link|seguro/i)
    expect(readFileSync(target, 'utf8')).toBe('preservar')
  })

  it('recusa backups/escrita que seja symlink', () => {
    const root = vault()
    const outside = vault()
    mkdirSync(join(root, 'backups'))
    symlinkSync(outside, join(root, 'backups', 'escrita'), 'junction')
    const subject = writer()
    subject.read(root)
    expect(() => subject.createOriginal(root, { title: 'Ideia', body: 'Texto.' })).toThrow(/atalho|link|seguro/i)
    expect(readdirSync(outside)).toEqual([])
    expect(() => readFileSync(join(root, 'escrita.md'), 'utf8')).toThrow()
  })

  it('não altera nenhum arquivo de outro domínio', () => {
    const root = vault()
    const untouched = ['tarefas.md', 'agenda.md', 'planning.json', 'Iris']
    for (const name of untouched) writeFileSync(join(root, name), `sentinela:${name}`)
    mkdirSync(join(root, 'midias'))
    writeFileSync(join(root, 'midias', 'sentinela.txt'), 'mídia')
    const subject = writer()
    subject.read(root)
    subject.createOriginal(root, { title: 'Ideia', body: 'Texto.' })
    for (const name of untouched) expect(readFileSync(join(root, name), 'utf8')).toBe(`sentinela:${name}`)
    expect(readFileSync(join(root, 'midias', 'sentinela.txt'), 'utf8')).toBe('mídia')
  })
})
