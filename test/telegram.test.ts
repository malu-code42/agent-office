import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TelegramService } from '../src/main/telegram'

const dirs: string[] = []
const temp = (prefix: string): string => {
  const path = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(path)
  return path
}
const token = '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdef'
const fakeSafeStorage = () => ({
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => 'dpapi',
  encryptString: (value: string) => Buffer.from(value.split('').reverse().join(''), 'utf8'),
  decryptString: (value: Buffer) => value.toString('utf8').split('').reverse().join(''),
})
const response = (payload: unknown) => ({ ok: true, json: async () => payload }) as Response

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('integração Telegram local', () => {
  it('encrypts bot credentials, filters unauthorized/duplicate updates and reports expired messages', async () => {
    const data = temp('telegram-data-')
    const vault = temp('telegram-vault-')
    const credentialFile = join(temp('telegram-import-'), 'credentials.json')
    writeFileSync(credentialFile, JSON.stringify({ botToken: token, userId: 42 }))
    const now = 1_800_000_000_000
    const onMessage = vi.fn()
    const onExpired = vi.fn()
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({ ok: true, result: { id: 123, username: 'fixture_bot' } }))
      .mockResolvedValueOnce(
        response({
          ok: true,
          result: [
            { update_id: 1, message: { date: now / 1000, text: 'Oi Luna', from: { id: 42 }, chat: { id: 42, type: 'private' } } },
            { update_id: 1, message: { date: now / 1000, text: 'Duplicada', from: { id: 42 }, chat: { id: 42, type: 'private' } } },
            { update_id: 2, message: { date: now / 1000, text: 'Não autorizada', from: { id: 43 }, chat: { id: 43, type: 'private' } } },
            { update_id: 3, message: { date: now / 1000 - 86_401, text: 'Expirada', from: { id: 42 }, chat: { id: 42, type: 'private' } } },
            {
              update_id: 4,
              message: { date: now / 1000, text: `Token ecoado: ${token}`, from: { id: 42 }, chat: { id: 42, type: 'private' } },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        response({
          ok: true,
          result: [
            { update_id: 4, message: { date: now / 1000, text: 'Duplicada depois', from: { id: 42 }, chat: { id: 42, type: 'private' } } },
          ],
        }),
      )
    const service = new TelegramService({
      dataDirectory: data,
      vaultPath: () => vault,
      safeStorage: fakeSafeStorage(),
      fetcher: fetcher as unknown as typeof fetch,
      now: () => now,
      onMessage,
      onExpired,
    })

    const linked = await service.linkFromFile(credentialFile)
    expect(linked).toMatchObject({ linked: true, botName: 'fixture_bot', authorizedUserId: 42 })
    expect(JSON.stringify(linked)).not.toContain(token)
    const encrypted = readFileSync(join(data, 'telegram-credentials.bin'))
    expect(encrypted.toString('utf8')).not.toContain(token)
    await service.pollOnce()
    await service.pollOnce()
    expect(onMessage).toHaveBeenCalledTimes(2)
    expect(onMessage).toHaveBeenCalledWith({ text: 'Oi Luna', receivedAt: now })
    expect(onMessage).toHaveBeenCalledWith({ text: 'Token ecoado: [token oculto]', receivedAt: now })
    expect(onExpired).toHaveBeenCalledTimes(1)
    expect(onExpired).toHaveBeenCalledWith({ receivedAt: now })
    expect(readFileSync(join(data, 'telegram-offset.json'), 'utf8')).toContain('"updateId":4')
  })

  it('refuses credentials imported from inside the vault or insecure storage backends', async () => {
    const data = temp('telegram-data-')
    const vault = temp('telegram-vault-')
    const insideVault = join(vault, 'bot.json')
    writeFileSync(insideVault, JSON.stringify({ botToken: token, userId: 42 }))
    const fetcher = vi.fn(async () => response({ ok: true, result: { id: 123, username: 'fixture_bot' } }))
    const service = new TelegramService({
      dataDirectory: data,
      vaultPath: () => vault,
      safeStorage: fakeSafeStorage(),
      fetcher: fetcher as unknown as typeof fetch,
    })
    await expect(service.linkFromFile(insideVault)).rejects.toThrow(/não pode ficar dentro do vault/i)
    expect(fetcher).not.toHaveBeenCalled()

    const outside = join(temp('telegram-import-'), 'bot.json')
    writeFileSync(outside, JSON.stringify({ botToken: token, userId: 42 }))
    const insecure = new TelegramService({
      dataDirectory: data,
      vaultPath: () => vault,
      safeStorage: { ...fakeSafeStorage(), getSelectedStorageBackend: () => 'basic_text' },
      fetcher: fetcher as unknown as typeof fetch,
    })
    await expect(insecure.linkFromFile(outside)).rejects.toThrow(/armazenamento seguro/i)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('requires private chat and exact authorized Telegram user ID', async () => {
    const data = temp('telegram-data-')
    const vault = temp('telegram-vault-')
    const credentialFile = join(temp('telegram-import-'), 'credentials.json')
    writeFileSync(credentialFile, JSON.stringify({ botToken: token, userId: 42 }))
    const onMessage = vi.fn()
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({ ok: true, result: { id: 123, username: 'fixture_bot' } }))
      .mockResolvedValueOnce(
        response({
          ok: true,
          result: [
            { update_id: 1, message: { date: 1_800_000_000, text: 'Grupo', from: { id: 42 }, chat: { id: -42, type: 'group' } } },
            { update_id: 2, message: { date: 1_800_000_000, text: 'Outra pessoa', from: { id: 43 }, chat: { id: 43, type: 'private' } } },
          ],
        }),
      )
    const service = new TelegramService({
      dataDirectory: data,
      vaultPath: () => vault,
      safeStorage: fakeSafeStorage(),
      fetcher: fetcher as unknown as typeof fetch,
      now: () => 1_800_000_000_000,
      onMessage,
    })
    await service.linkFromFile(credentialFile)
    await service.pollOnce()
    expect(onMessage).not.toHaveBeenCalled()
  })

  it('stops polling and reports a revoked bot token without exposing it', async () => {
    const data = temp('telegram-data-')
    const vault = temp('telegram-vault-')
    const credentialFile = join(temp('telegram-import-'), 'credentials.json')
    writeFileSync(credentialFile, JSON.stringify({ botToken: token, userId: 42 }))
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({ ok: true, result: { id: 123, username: 'fixture_bot' } }))
      .mockResolvedValueOnce({ ok: false, status: 401 } as Response)
    const service = new TelegramService({
      dataDirectory: data,
      vaultPath: () => vault,
      safeStorage: fakeSafeStorage(),
      fetcher: fetcher as unknown as typeof fetch,
    })
    await service.linkFromFile(credentialFile)
    await expect(service.pollOnce()).rejects.toThrow(/revogou o token/i)
    expect(service.status()).toMatchObject({ linked: true, polling: false, warning: /revogou o token/i })
    expect(JSON.stringify(service.status())).not.toContain(token)
  })
})
