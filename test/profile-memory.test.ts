import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DATA_FILES, DATA_SHAPES } from '../src/main/backups'
import { irisContext } from '../src/shared/iris'
import { ProfileMemoryStore } from '../src/main/profile-memory'
import * as fsSafe from '../src/main/fs-safe'
import { hasRecognizableProfileMemorySecret, parseProfileMemoryText, parse, profileChoiceSchema } from '../src/main/validate'

const NOW = 1_900_000_000_000

let dir: string
let stores: ProfileMemoryStore[] = []

function createStore(): ProfileMemoryStore {
  const store = new ProfileMemoryStore(dir)
  stores.push(store)
  return store
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ao-profile-memory-'))
})

afterEach(() => {
  for (const store of stores) store.lock()
  stores = []
  rmSync(dir, { recursive: true, force: true })
})

describe('ProfileMemoryStore', () => {
  it('isolates each profile: saving and deleting one leaves the others alone', () => {
    const store = createStore()
    store.set('tecnica', 'Prefere decisões com números.')
    store.set('estudo-avulso', 'Gosta de exemplos do dia a dia.')
    expect(store.view('tecnica')?.text).toBe('Prefere decisões com números.')
    expect(store.view('estudo-avulso')?.text).toBe('Gosta de exemplos do dia a dia.')

    store.remove('tecnica')
    expect(store.view('tecnica')).toBeNull()
    expect(store.view('estudo-avulso')?.text).toBe('Gosta de exemplos do dia a dia.')
  })

  it('editing overwrites the same profile, with a new time', () => {
    const store = createStore()
    const first = store.set('escrita', 'Escreve no padrão do jogo.')
    const second = store.set('escrita', 'Escreve curtinho.')
    expect(second.updatedAt).toBeGreaterThanOrEqual(first.updatedAt)
    expect(store.view('escrita')?.text).toBe('Escreve curtinho.')
    expect(second.text).toBe('Escreve curtinho.')
  })

  it('refuses an empty (or blanks-only) text, and refuses unknown profile ids', () => {
    const store = createStore()
    expect(() => store.set('tecnica', '   ')).toThrow(/apague a memória/)
    expect(() => store.set('tecnica', '')).toThrow(/apague a memória/)
    expect(() => store.set('nizzie-no-such', 'oi')).toThrow(/não existe/)
    expect(() => store.remove('nizzie-no-such')).toThrow(/não existe/)
    expect(store.all()).toEqual({})
  })

  it('summaries() brings only what has memory, one line per profile', () => {
    const store = createStore()
    expect(store.summaries()).toEqual([])
    store.set('tecnica', 'Prefere números.')
    store.set('escrita', 'Curtinho.')
    const list = store.summaries()
    expect(list).toHaveLength(2)
    expect(list.some((s) => s.profile === 'Ajuda técnica' && s.summary === 'Prefere números.')).toBe(true)
  })

  it('reading again only keeps what the app knows and shaped right', () => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'profile-memory.json'),
      JSON.stringify({
        memories: {
          tecnica: { text: '  bom  ', updatedAt: NOW },
          'nizzie-no-such': { text: 'vazar', updatedAt: NOW },
          'estudo-avulso': { text: '   ', updatedAt: NOW },
          escrita: { nope: true },
          'estudo-avulso-x': 'texto solto',
        },
      }),
      'utf8',
    )
    const store = createStore()
    expect(store.view('tecnica')?.text).toBe('bom')
    expect(store.view('tecnica')?.updatedAt).toBe(NOW)
    expect(store.view('nizzie-no-such')).toBeNull()
    expect(store.view('estudo-avulso')).toBeNull()
    expect(store.view('escrita')).toBeNull()
  })

  it("an entry whose updatedAt makes no sense gets today's, and still counts", () => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'profile-memory.json'), JSON.stringify({ memories: { tecnica: { text: 'bom', updatedAt: 'ontem' } } }), 'utf8')
    const store = createStore()
    expect(store.view('tecnica')?.updatedAt).toBeTypeOf('number')
  })

  it('the memory survives a new session (and a restart)', () => {
    const before = createStore()
    before.set('tecnica', 'Prefere números.')
    before.flush()

    const after = createStore()
    expect(after.view('tecnica')?.text).toBe('Prefere números.')
    // And the file on disk says the same.
    const file = JSON.parse(readFileSync(join(dir, 'profile-memory.json'), 'utf8'))
    expect(file.memories.tecnica.text).toBe('Prefere números.')
    expect(readdirSync(dir).filter((n) => n.endsWith('.tmp'))).toEqual([])
  })

  it('a file that cannot be parsed is set aside, and the .bak written at the last good read comes back', () => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'profile-memory.json'), JSON.stringify({ memories: { tecnica: { text: 'bom', updatedAt: NOW } } }), 'utf8')
    // The .bak only exists from an ok read: this one makes it.
    createStore()
    writeFileSync(join(dir, 'profile-memory.json'), '{ isto não é json', 'utf8')

    expect(createStore().view('tecnica')?.text).toBe('bom')
    expect(readdirSync(dir).some((n) => n.startsWith('profile-memory.corrupt-'))).toBe(true)
  })

  it('profile-memory.json is among the data files that are backed up, and its shape is checked', () => {
    expect(DATA_FILES).toContain('profile-memory.json')
    expect(DATA_SHAPES['profile-memory.json']({ memories: { tecnica: { text: 'bom', updatedAt: NOW } } })).toBe(true)
    expect(
      DATA_SHAPES['profile-memory.json']({
        memories: { tecnica: { text: 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234567890', updatedAt: NOW } },
      }),
    ).toBe(false)
    expect(
      DATA_SHAPES['profile-memory.json']({
        memories: { tecnica: { text: 'sk-proj-abcdefghijklmnopqrstuvwxyz1234567890', updatedAt: NOW } },
      }),
    ).toBe(false)
    expect(DATA_SHAPES['profile-memory.json']({ memories: { tecnica: { updatedAt: NOW } } })).toBe(false)
    expect(DATA_SHAPES['profile-memory.json']({})).toBe(true) // no memory yet is a valid first run
    expect(DATA_SHAPES['profile-memory.json']({ memories: 3 })).toBe(false)
    expect(DATA_SHAPES['profile-memory.json']('3')).toBe(false)
  })
})

describe('AO-43 validation and context', () => {
  it('the renderer text is trimmed, and an empty one is refused', () => {
    expect(parseProfileMemoryText('  bonito  ')).toBe('bonito')
    expect(() => parseProfileMemoryText(' \n ')).toThrow(/apague a memória/)
    expect(() => parseProfileMemoryText('x'.repeat(10_001))).toThrow(/10\.000/)
  })

  it('rejects recognizable credentials without trying to classify ordinary prose', () => {
    const rejected = [
      '-----BEGIN PRIVATE KEY-----\\nabc',
      'token ghp_abcdefghijklmnopqrstuvwxyz123456',
      'key AKIAIOSFODNN7EXAMPLE',
      'password=hunter2',
      'api_key: abc123',
      'client secret: value',
      'sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234567890',
      'sk-proj-abcdefghijklmnopqrstuvwxyz1234567890',
      'sk-abcdefghijklmnopqrstuvwxyz12345678901234567890',
      'AIzaSyABCDEFGHIJKLMNOPQRSTUVWXY01234567',
    ]
    for (const text of rejected) {
      expect(hasRecognizableProfileMemorySecret(text)).toBe(true)
      expect(() => parseProfileMemoryText(text)).toThrow(/credencial ou segredo/)
    }

    const accepted = [
      'Prefere explicações com exemplos.',
      'A senha é um conceito discutido no curso.',
      'Resumo da reunião de hoje.',
      'sk- é só um prefixo citado.',
    ]
    for (const text of accepted) {
      expect(hasRecognizableProfileMemorySecret(text)).toBe(false)
      expect(parseProfileMemoryText(text)).toBe(text)
    }
  })

  it('a profile id the app does not know gets refused', () => {
    expect(() => parse(profileChoiceSchema, 'nizzie-no-such', 'Esse perfil não existe.')).toThrow(/não existe/)
    expect(() => parse(profileChoiceSchema, undefined, 'Esse perfil não existe.')).toThrow(/não existe/)
    parse(profileChoiceSchema, 'tecnica', 'Esse perfil não existe.')
  })

  it('the Luna context shows the written memories, and hides the block when they are gone', () => {
    const base = { request: 'oi', today: '2026-01-30', commitments: [], lists: [], profiles: [] }
    const withMemory = irisContext({
      ...base,
      memories: [
        { profile: 'Técnica', summary: 'Prefere números.' },
        { profile: 'Agatha', summary: '   ' },
      ],
    })
    expect(withMemory).toContain('Memória dos perfis')
    expect(withMemory).toContain('- Técnica: Prefere números.')
    expect(withMemory).not.toContain('Agatha:')

    expect(irisContext(base)).not.toContain('Memória dos perfis')
  })

  it('filters unsafe persisted entries before summaries can reach Luna', () => {
    writeFileSync(
      join(dir, 'profile-memory.json'),
      JSON.stringify({
        memories: {
          tecnica: { text: 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234567890', updatedAt: NOW },
          escrita: { text: 'sk-proj-abcdefghijklmnopqrstuvwxyz1234567890', updatedAt: NOW },
          'estudo-avulso': { text: 'Resumo seguro.', updatedAt: NOW },
        },
      }),
      'utf8',
    )
    const store = createStore()
    expect(store.summaries().map((memory) => memory.summary)).toEqual(['Resumo seguro.'])
    const context = irisContext({
      request: 'oi',
      today: '2026-01-30',
      commitments: [],
      lists: [],
      profiles: [],
      memories: store.summaries(),
    })
    expect(context).not.toContain('sk-ant-')
    expect(context).not.toContain('sk-proj-')
  })

  it('sanitizes unsafe entries from the main file and profile-memory backups while preserving safe summaries', () => {
    const secret = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234567890'
    const unsafeData = JSON.stringify({
      memories: {
        tecnica: { text: secret, updatedAt: NOW },
        'estudo-avulso': { text: 'Resumo seguro.', updatedAt: NOW },
      },
    })
    const main = join(dir, 'profile-memory.json')
    const bak = join(dir, 'profile-memory.json.bak')
    const daily = join(dir, 'backups', '2026-10-23')
    mkdirSync(daily, { recursive: true })
    writeFileSync(main, unsafeData, 'utf8')
    writeFileSync(bak, unsafeData, 'utf8')
    writeFileSync(join(daily, 'profile-memory.json'), unsafeData, 'utf8')

    const store = createStore()
    const context = irisContext({
      request: 'oi',
      today: '2026-01-30',
      commitments: [],
      lists: [],
      profiles: [],
      memories: store.summaries(),
    })

    expect(store.summaries().map((memory) => memory.summary)).toEqual(['Resumo seguro.'])
    expect(context).toContain('Resumo seguro.')
    for (const path of [main, bak, join(daily, 'profile-memory.json')]) {
      expect(readFileSync(path, 'utf8')).not.toContain(secret)
    }
  })

  it('normalizes unknown top-level and entry fields away while preserving known summaries', () => {
    const main = join(dir, 'profile-memory.json')
    writeFileSync(
      main,
      JSON.stringify({
        credential: 'arbitrary-secret-value',
        memories: { tecnica: { text: 'Resumo seguro.', updatedAt: NOW, credential: 'nested-secret-value' } },
      }),
      'utf8',
    )

    const store = createStore()
    const normalized = JSON.parse(readFileSync(main, 'utf8'))
    expect(store.view('tecnica')?.text).toBe('Resumo seguro.')
    expect(normalized).toEqual({ memories: { tecnica: { text: 'Resumo seguro.', updatedAt: NOW } } })
    expect(readFileSync(main, 'utf8')).not.toContain('secret-value')
  })

  it('does not restore a secret-only .bak as profile context', () => {
    const secret = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234567890'
    const main = join(dir, 'profile-memory.json')
    const bak = join(dir, 'profile-memory.json.bak')
    writeFileSync(main, '{broken', 'utf8')
    writeFileSync(bak, JSON.stringify({ memories: { tecnica: { text: secret, updatedAt: NOW } } }), 'utf8')

    const store = createStore()
    expect(store.summaries()).toEqual([])
    expect(readFileSync(bak, 'utf8')).not.toContain(secret)
  })

  it('surfaces non-ENOENT main-file read failures instead of starting empty', () => {
    mkdirSync(join(dir, 'profile-memory.json'))
    expect(() => createStore()).toThrow()
  })

  it('fails closed when sanitation of the main file cannot be written', () => {
    const secret = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234567890'
    const main = join(dir, 'profile-memory.json')
    const bak = join(dir, 'profile-memory.json.bak')
    writeFileSync(main, JSON.stringify({ memories: { tecnica: { text: secret, updatedAt: NOW } } }), 'utf8')
    const write = vi.spyOn(fsSafe, 'writeFileAtomic').mockImplementation(() => {
      throw new Error('simulated disk failure')
    })
    const store = createStore()
    write.mockRestore()

    expect(store.summaries()).toEqual([])
    expect(existsSync(bak)).toBe(false)
    expect(readFileSync(main, 'utf8')).toContain(secret)
    expect(
      irisContext({
        request: 'oi',
        today: '2026-01-30',
        commitments: [],
        lists: [],
        profiles: [],
        memories: store.summaries(),
      }),
    ).not.toContain(secret)
  })

  it('stops initialization when an unsafe backup cannot be atomically sanitized', () => {
    const secret = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234567890'
    const main = join(dir, 'profile-memory.json')
    const bak = join(dir, 'profile-memory.json.bak')
    writeFileSync(main, '{broken', 'utf8')
    writeFileSync(bak, JSON.stringify({ memories: { tecnica: { text: secret, updatedAt: NOW } } }), 'utf8')
    const originalWrite = fsSafe.writeFileAtomic
    const write = vi.spyOn(fsSafe, 'writeFileAtomic').mockImplementation((path, text, mode, tmpSuffix) => {
      if (path === bak) throw new Error('simulated disk failure')
      return originalWrite(path, text, mode, tmpSuffix)
    })

    try {
      expect(() => createStore()).toThrow(/inicialização foi interrompida/)
      expect(readFileSync(bak, 'utf8')).toContain(secret)
    } finally {
      write.mockRestore()
    }
  })

  it('does not follow a symlinked backup folder or backups root during sanitation', () => {
    const secret = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234567890'
    const main = join(dir, 'profile-memory.json')
    const outside = mkdtempSync(join(tmpdir(), 'ao-profile-memory-outside-'))
    const externalFile = join(outside, 'profile-memory.json')
    const backupRoot = join(dir, 'backups')
    mkdirSync(backupRoot)
    writeFileSync(main, '{broken', 'utf8')
    writeFileSync(externalFile, JSON.stringify({ memories: { tecnica: { text: secret, updatedAt: NOW } } }), 'utf8')
    try {
      symlinkSync(outside, join(backupRoot, '2026-10-23'), 'junction')
      const store = createStore()
      expect(readFileSync(externalFile, 'utf8')).toContain(secret)
      expect(store.summaries()).toEqual([])
    } catch (err) {
      if (!['EPERM', 'EACCES', 'ENOTSUP', 'EINVAL'].includes((err as NodeJS.ErrnoException).code ?? '')) throw err
      expect(true).toBe(true)
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('does not traverse a symlinked backups root', () => {
    const secret = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234567890'
    const main = join(dir, 'profile-memory.json')
    const outside = mkdtempSync(join(tmpdir(), 'ao-profile-memory-outside-root-'))
    const daily = join(outside, '2026-10-23')
    mkdirSync(daily)
    writeFileSync(main, '{broken', 'utf8')
    const externalFile = join(daily, 'profile-memory.json')
    writeFileSync(externalFile, JSON.stringify({ memories: { tecnica: { text: secret, updatedAt: NOW } } }), 'utf8')
    try {
      symlinkSync(outside, join(dir, 'backups'), 'junction')
      expect(createStore().summaries()).toEqual([])
      expect(readFileSync(externalFile, 'utf8')).toContain(secret)
    } catch (err) {
      if (!['EPERM', 'EACCES', 'ENOTSUP', 'EINVAL'].includes((err as NodeJS.ErrnoException).code ?? '')) throw err
      expect(true).toBe(true)
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('does not restore profile memory through symlinked daily or snapshot folders', () => {
    const main = join(dir, 'profile-memory.json')
    const outside = mkdtempSync(join(tmpdir(), 'ao-profile-memory-fallback-outside-'))
    const externalFile = join(outside, 'profile-memory.json')
    const backups = join(dir, 'backups')
    mkdirSync(backups)
    writeFileSync(main, '{broken', 'utf8')
    writeFileSync(externalFile, JSON.stringify({ memories: { tecnica: { text: 'EXTERNAL MEMORY', updatedAt: NOW } } }), 'utf8')
    try {
      symlinkSync(outside, join(backups, '2026-10-23'), 'junction')
      symlinkSync(outside, join(backups, 'antes-2026-10-23T12-00-00'), 'junction')
      expect(createStore().summaries()).toEqual([])
      expect(readFileSync(externalFile, 'utf8')).toContain('EXTERNAL MEMORY')
    } catch (err) {
      if (!['EPERM', 'EACCES', 'ENOTSUP', 'EINVAL'].includes((err as NodeJS.ErrnoException).code ?? '')) throw err
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('quarantines a .bak symlink without reading or changing its external target', () => {
    const main = join(dir, 'profile-memory.json')
    const outside = mkdtempSync(join(tmpdir(), 'ao-profile-memory-bak-outside-'))
    const externalFile = join(outside, 'external.json')
    const bak = `${main}.bak`
    writeFileSync(main, '{broken', 'utf8')
    writeFileSync(externalFile, JSON.stringify({ memories: { tecnica: { text: 'EXTERNAL MEMORY', updatedAt: NOW } } }), 'utf8')
    try {
      symlinkSync(externalFile, bak, 'file')
      expect(createStore().summaries()).toEqual([])
      expect(readFileSync(externalFile, 'utf8')).toContain('EXTERNAL MEMORY')
      expect(existsSync(bak)).toBe(false)
      expect(readdirSync(dir).some((name) => name.startsWith('profile-memory.json.bak.symlink-quarantined-'))).toBe(true)
    } catch (err) {
      if (!['EPERM', 'EACCES', 'ENOTSUP', 'EINVAL'].includes((err as NodeJS.ErrnoException).code ?? '')) throw err
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('preserves and restores a valid regular daily fallback', () => {
    const main = join(dir, 'profile-memory.json')
    const dailyFile = join(dir, 'backups', '2026-10-23', 'profile-memory.json')
    mkdirSync(join(dir, 'backups', '2026-10-23'), { recursive: true })
    writeFileSync(main, '{broken', 'utf8')
    const fallback = JSON.stringify({ memories: { tecnica: { text: 'SAFE FALLBACK', updatedAt: NOW } } })
    writeFileSync(dailyFile, fallback, 'utf8')
    expect(createStore().view('tecnica')?.text).toBe('SAFE FALLBACK')
    expect(readFileSync(dailyFile, 'utf8')).toBe(fallback)
  })

  it('refuses a symlinked userData directory before any profile-memory writes', () => {
    const parent = mkdtempSync(join(tmpdir(), 'ao-profile-memory-parent-'))
    const external = join(parent, 'external')
    const linked = join(parent, 'linked')
    mkdirSync(external)
    try {
      symlinkSync(external, linked, 'junction')
      expect(() => new ProfileMemoryStore(linked)).toThrow(/link simbólico/)
      expect(readdirSync(external)).toEqual([])
    } catch (err) {
      if (!['EPERM', 'EACCES', 'ENOTSUP', 'EINVAL'].includes((err as NodeJS.ErrnoException).code ?? '')) throw err
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })
})
