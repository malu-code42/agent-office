import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  file: '',
  confirm: 1,
  onBeforeQuit: null as (() => void) | null,
}))

vi.mock('electron', () => ({
  app: {
    on: (event: string, listener: () => void) => {
      if (event === 'before-quit') state.onBeforeQuit = listener
    },
    once: () => undefined,
  },
  dialog: {
    showOpenDialog: async () => ({ canceled: !state.file, filePaths: state.file ? [state.file] : [] }),
    showMessageBox: async () => ({ response: state.confirm }),
  },
  ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => state.handlers.set(channel, handler) },
  safeStorage: {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'dpapi',
    encryptString: (value: string) => Buffer.from(value.split('').reverse().join('')),
    decryptString: (value: Buffer) => value.toString().split('').reverse().join(''),
  },
}))

const { registerTelegramIpc } = await import('../src/main/ipc/telegram')
const invoke = (channel: string, ...args: unknown[]) => state.handlers.get(channel)!(undefined, ...args)
let dirs: string[] = []

afterEach(() => {
  state.onBeforeQuit?.()
  state.onBeforeQuit = null
  state.handlers.clear()
  state.file = ''
  state.confirm = 1
  vi.unstubAllGlobals()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('Telegram IPC seguro', () => {
  it('links only from a native file picker, never returns the token, and confirms unlink in main', async () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), 'telegram-ipc-data-'))
    const vaultPath = mkdtempSync(join(tmpdir(), 'telegram-ipc-vault-'))
    const importDir = mkdtempSync(join(tmpdir(), 'telegram-ipc-import-'))
    dirs = [dataDirectory, vaultPath, importDir]
    const secret = '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdef'
    state.file = join(importDir, 'bot.json')
    writeFileSync(state.file, JSON.stringify({ botToken: secret, userId: 42 }))
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: { id: 123, username: 'fixture_bot' } })))
      .mockResolvedValue(new Response(JSON.stringify({ ok: true, result: [] })))
    vi.stubGlobal('fetch', fetch)
    const events: unknown[] = []
    registerTelegramIpc({
      win: () => null,
      store: { dataDirectory, settings: { vaultPath } } as never,
      broadcast: (event: unknown) => events.push(event),
    } as never)

    const initial = (await invoke('office:telegramStatus')) as { linked: boolean }
    expect(initial.linked).toBe(false)
    const linked = (await invoke('office:linkTelegram')) as { linked: boolean; botName: string; authorizedUserId: number }
    expect(linked).toMatchObject({ linked: true, botName: 'fixture_bot', authorizedUserId: 42 })
    expect(JSON.stringify(linked)).not.toContain(secret)
    const encrypted = await import('node:fs').then(({ readFileSync }) =>
      readFileSync(join(dataDirectory, 'telegram-credentials.bin'), 'utf8'),
    )
    expect(encrypted).not.toContain(secret)

    state.confirm = 1
    expect(await invoke('office:unlinkTelegram')).toBe(false)
    expect(existsSync(join(dataDirectory, 'telegram-credentials.bin'))).toBe(true)
    state.confirm = 0
    expect(await invoke('office:unlinkTelegram')).toBe(true)
    expect(existsSync(join(dataDirectory, 'telegram-credentials.bin'))).toBe(false)
    expect(events).toEqual([])
  })
})
