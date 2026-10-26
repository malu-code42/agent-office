import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

  it('does not treat arbitrary document uploads as audio', async () => {
    const data = temp('telegram-data-')
    const vault = temp('telegram-vault-')
    const credentialFile = join(temp('telegram-import-'), 'credentials.json')
    writeFileSync(credentialFile, JSON.stringify({ botToken: token, userId: 42 }))
    const onAudio = vi.fn()
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({ ok: true, result: { id: 123, username: 'fixture_bot' } }))
      .mockResolvedValueOnce(
        response({
          ok: true,
          result: [
            {
              update_id: 1,
              message: {
                message_id: 19,
                date: 1_800_000_000,
                document: { file_id: 'not-audio-id', file_size: 100 },
                from: { id: 42 },
                chat: { id: 42, type: 'private' },
              },
            },
          ],
        }),
      )
    const service = new TelegramService({
      dataDirectory: data,
      vaultPath: () => vault,
      safeStorage: fakeSafeStorage(),
      fetcher: fetcher as unknown as typeof fetch,
      now: () => 1_800_000_000_000,
      onAudio,
    })
    await service.linkFromFile(credentialFile)
    await service.pollOnce()

    expect(onAudio).not.toHaveBeenCalled()
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('baixa áudio somente após validar a conta privada e entrega bytes à captura local', async () => {
    const data = temp('telegram-data-')
    const vault = temp('telegram-vault-')
    const credentialFile = join(temp('telegram-import-'), 'credentials.json')
    writeFileSync(credentialFile, JSON.stringify({ botToken: token, userId: 42 }))
    const bytes = Buffer.from('synthetic telegram audio')
    const onAudio = vi.fn(async () => 'pending' as const)
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({ ok: true, result: { id: 123, username: 'fixture_bot' } }))
      .mockResolvedValueOnce(
        response({
          ok: true,
          result: [
            {
              update_id: 1,
              message: {
                message_id: 17,
                date: 1_800_000_000,
                caption: 'Áudio sintético',
                voice: { file_id: 'synthetic-file-id', file_size: bytes.length, mime_type: 'audio/ogg' },
                from: { id: 42 },
                chat: { id: 42, type: 'private' },
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(response({ ok: true, result: { file_path: 'voice/file.ogg', file_size: bytes.length } }))
      .mockResolvedValueOnce(new Response(bytes, { headers: { 'content-length': String(bytes.length) } }))
    const service = new TelegramService({
      dataDirectory: data,
      vaultPath: () => vault,
      safeStorage: fakeSafeStorage(),
      fetcher: fetcher as unknown as typeof fetch,
      now: () => 1_800_000_000_000,
      onAudio,
    })

    await service.linkFromFile(credentialFile)
    await service.pollOnce()
    await vi.waitFor(() => expect(onAudio).toHaveBeenCalledOnce())
    expect(onAudio).toHaveBeenCalledWith({
      updateId: 1,
      fileId: 'synthetic-file-id',
      fileName: 'telegram-voice.ogg',
      mime: 'audio/ogg',
      size: bytes.length,
      caption: 'Áudio sintético',
      chatId: 42,
      messageId: 17,
      receivedAt: 1_800_000_000_000,
      bytes,
    })
    expect(fetcher).toHaveBeenCalledTimes(4)
    expect(String(fetcher.mock.calls[2]?.[0])).toContain('/getFile')
    expect(String(fetcher.mock.calls[3]?.[0])).toContain('/file/bot')
  })

  it('persiste áudio pendente antes do offset e o retoma após reinício sem manter os bytes em disco', async () => {
    const data = temp('telegram-data-')
    const vault = temp('telegram-vault-')
    const credentialFile = join(temp('telegram-import-'), 'credentials.json')
    writeFileSync(credentialFile, JSON.stringify({ botToken: token, userId: 42 }))
    const bytes = Buffer.from('synthetic pending audio')
    const update = {
      update_id: 7,
      message: {
        message_id: 18,
        date: 1_800_000_000,
        voice: { file_id: 'resume-file-id', file_size: bytes.length, mime_type: 'audio/ogg' },
        from: { id: 42 },
        chat: { id: 42, type: 'private' },
      },
    }
    const getMe = () => response({ ok: true, result: { id: 123, username: 'fixture_bot' } })
    const getFile = () => response({ ok: true, result: { file_path: 'voice/resume.ogg', file_size: bytes.length } })
    const fileResponse = () => new Response(bytes, { headers: { 'content-length': String(bytes.length) } })
    const firstFetcher = vi.fn(async (input: unknown) => {
      const url = String(input)
      if (url.includes('/getMe')) return getMe()
      if (url.includes('/getUpdates')) return response({ ok: true, result: [update] })
      if (url.includes('/getFile')) return getFile()
      return fileResponse()
    })
    const pendingCallback = vi.fn(async () => 'retry' as const)
    const first = new TelegramService({
      dataDirectory: data,
      vaultPath: () => vault,
      safeStorage: fakeSafeStorage(),
      fetcher: firstFetcher as unknown as typeof fetch,
      now: () => 1_800_000_000_000,
      onAudio: pendingCallback,
    })
    await first.linkFromFile(credentialFile)
    await first.pollOnce()
    await vi.waitFor(() => expect(pendingCallback).toHaveBeenCalledOnce())

    const pendingPath = join(data, 'telegram-audio-pending.json')
    expect(readFileSync(join(data, 'telegram-offset.json'), 'utf8')).toContain('"updateId":7')
    expect(readFileSync(pendingPath, 'utf8')).toContain('"updateId":7')
    expect(readFileSync(pendingPath, 'utf8')).not.toContain(bytes.toString())
    first.stop()

    const resumedCallback = vi.fn(async () => 'complete' as const)
    const secondFetcher = vi.fn(async (input: unknown) => {
      const url = String(input)
      if (url.includes('/getUpdates')) return response({ ok: true, result: [] })
      if (url.includes('/getFile')) return getFile()
      if (url.includes('/deleteMessage')) return response({ ok: true, result: true })
      return fileResponse()
    })
    const restarted = new TelegramService({
      dataDirectory: data,
      vaultPath: () => vault,
      safeStorage: fakeSafeStorage(),
      fetcher: secondFetcher as unknown as typeof fetch,
      now: () => 1_800_000_001_000,
      onAudio: resumedCallback,
    })
    restarted.start()
    await vi.waitFor(() => expect(resumedCallback).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(existsSync(pendingPath)).toBe(false))
    restarted.stop()
  })

  it('uma decisão ainda pendente não é reapresentada automaticamente no próximo início', async () => {
    const data = temp('telegram-data-')
    const vault = temp('telegram-vault-')
    const credentialFile = join(temp('telegram-import-'), 'credentials.json')
    writeFileSync(credentialFile, JSON.stringify({ botToken: token, userId: 42 }))
    const bytes = Buffer.from('synthetic user-canceled audio')
    const fetcher = vi.fn(async (input: unknown) => {
      const url = String(input)
      if (url.includes('/getMe')) return response({ ok: true, result: { id: 123, username: 'fixture_bot' } })
      if (url.includes('/getUpdates'))
        return response({
          ok: true,
          result: [
            {
              update_id: 14,
              message: {
                message_id: 25,
                date: 1_800_000_000,
                voice: { file_id: 'pending-user-file', file_size: bytes.length, mime_type: 'audio/ogg' },
                from: { id: 42 },
                chat: { id: 42, type: 'private' },
              },
            },
          ],
        })
      if (url.includes('/getFile')) return response({ ok: true, result: { file_path: 'voice/pending.ogg', file_size: bytes.length } })
      return new Response(bytes, { headers: { 'content-length': String(bytes.length) } })
    })
    const onAudio = vi.fn(async () => 'pending' as const)
    const service = new TelegramService({
      dataDirectory: data,
      vaultPath: () => vault,
      safeStorage: fakeSafeStorage(),
      fetcher: fetcher as unknown as typeof fetch,
      now: () => 1_800_000_000_000,
      onAudio,
    })
    await service.linkFromFile(credentialFile)
    await service.pollOnce()
    await vi.waitFor(() => expect(onAudio).toHaveBeenCalledOnce())

    expect(existsSync(join(data, 'telegram-audio-pending.json'))).toBe(false)
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('/deleteMessage'))).toBe(false)
  })

  it('após salvar efeitos, persiste a etapa de exclusão para que reiniciar não repita o processamento', async () => {
    const data = temp('telegram-data-')
    const vault = temp('telegram-vault-')
    const credentialFile = join(temp('telegram-import-'), 'credentials.json')
    writeFileSync(credentialFile, JSON.stringify({ botToken: token, userId: 42 }))
    const bytes = Buffer.from('synthetic committed audio')
    let updateReturned = false
    let fileDownloads = 0
    const update = {
      update_id: 12,
      message: {
        message_id: 23,
        date: 1_800_000_000,
        voice: { file_id: 'committed-file-id', file_size: bytes.length, mime_type: 'audio/ogg' },
        from: { id: 42 },
        chat: { id: 42, type: 'private' },
      },
    }
    const fetcher = vi.fn(async (input: unknown) => {
      const url = String(input)
      if (url.includes('/getMe')) return response({ ok: true, result: { id: 123, username: 'fixture_bot' } })
      if (url.includes('/getUpdates')) {
        if (updateReturned) return response({ ok: true, result: [] })
        updateReturned = true
        return response({ ok: true, result: [update] })
      }
      if (url.includes('/getFile')) {
        fileDownloads++
        return response({ ok: true, result: { file_path: 'voice/committed.ogg', file_size: bytes.length } })
      }
      if (url.includes('/deleteMessage'))
        return new Response(JSON.stringify({ ok: false, description: 'temporary deletion failure' }), { status: 503 })
      return new Response(bytes, { headers: { 'content-length': String(bytes.length) } })
    })
    const onAudio = vi.fn(async () => 'complete' as const)
    const service = new TelegramService({
      dataDirectory: data,
      vaultPath: () => vault,
      safeStorage: fakeSafeStorage(),
      fetcher: fetcher as unknown as typeof fetch,
      now: () => 1_800_000_000_000,
      onAudio,
      audioRetryDelaysMs: [60_000],
    })
    await service.linkFromFile(credentialFile)
    service.start()
    const pendingPath = join(data, 'telegram-audio-pending.json')
    await vi.waitFor(() => expect(readFileSync(pendingPath, 'utf8')).toContain('"processed":true'))
    service.stop()
    expect(onAudio).toHaveBeenCalledOnce()
    expect(fileDownloads).toBe(1)

    const restartFetcher = vi.fn(async (input: unknown) => {
      const url = String(input)
      if (url.includes('/getUpdates')) return response({ ok: true, result: [] })
      if (url.includes('/deleteMessage')) return response({ ok: true, result: true })
      throw new Error('A mensagem já processada não deve baixar novamente o áudio.')
    })
    const onAudioAfterRestart = vi.fn()
    const restarted = new TelegramService({
      dataDirectory: data,
      vaultPath: () => vault,
      safeStorage: fakeSafeStorage(),
      fetcher: restartFetcher as unknown as typeof fetch,
      now: () => 1_800_000_001_000,
      onAudio: onAudioAfterRestart,
    })
    restarted.start()
    await vi.waitFor(() => expect(existsSync(pendingPath)).toBe(false))
    expect(onAudioAfterRestart).not.toHaveBeenCalled()
    expect(restartFetcher.mock.calls.some(([url]) => String(url).includes('/deleteMessage'))).toBe(true)
    restarted.stop()
  })

  it('reagenda falha transitória de download durante a sessão com backoff limitado', async () => {
    const data = temp('telegram-data-')
    const vault = temp('telegram-vault-')
    const credentialFile = join(temp('telegram-import-'), 'credentials.json')
    writeFileSync(credentialFile, JSON.stringify({ botToken: token, userId: 42 }))
    const bytes = Buffer.from('synthetic retry audio')
    let updateReturned = false
    let getFileCalls = 0
    const fetcher = vi.fn(async (input: unknown) => {
      const url = String(input)
      if (url.includes('/getMe')) return response({ ok: true, result: { id: 123, username: 'fixture_bot' } })
      if (url.includes('/getUpdates')) {
        if (updateReturned) return response({ ok: true, result: [] })
        updateReturned = true
        return response({
          ok: true,
          result: [
            {
              update_id: 9,
              message: {
                message_id: 20,
                date: 1_800_000_000,
                voice: { file_id: 'retry-file-id', file_size: bytes.length, mime_type: 'audio/ogg' },
                from: { id: 42 },
                chat: { id: 42, type: 'private' },
              },
            },
          ],
        })
      }
      if (url.includes('/getFile')) {
        getFileCalls++
        if (getFileCalls === 1) return new Response('temporary outage', { status: 503 })
        return response({ ok: true, result: { file_path: 'voice/retry.ogg', file_size: bytes.length } })
      }
      if (url.includes('/deleteMessage')) return response({ ok: true, result: true })
      return new Response(bytes, { headers: { 'content-length': String(bytes.length) } })
    })
    const onAudio = vi.fn(async () => 'complete' as const)
    const service = new TelegramService({
      dataDirectory: data,
      vaultPath: () => vault,
      safeStorage: fakeSafeStorage(),
      fetcher: fetcher as unknown as typeof fetch,
      now: () => 1_800_000_000_000,
      onAudio,
      audioRetryDelaysMs: [0],
    })
    await service.linkFromFile(credentialFile)
    service.start()
    await vi.waitFor(() => expect(onAudio).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(existsSync(join(data, 'telegram-audio-pending.json'))).toBe(false))
    expect(getFileCalls).toBe(2)
    service.stop()
  })

  it('persiste o limite de tentativas e não reinicia um ciclo infinito após reiniciar', async () => {
    const data = temp('telegram-data-')
    const vault = temp('telegram-vault-')
    const credentialFile = join(temp('telegram-import-'), 'credentials.json')
    writeFileSync(credentialFile, JSON.stringify({ botToken: token, userId: 42 }))
    let updateReturned = false
    let downloadCalls = 0
    const fetcher = vi.fn(async (input: unknown) => {
      const url = String(input)
      if (url.includes('/getMe')) return response({ ok: true, result: { id: 123, username: 'fixture_bot' } })
      if (url.includes('/getUpdates')) {
        if (updateReturned) return response({ ok: true, result: [] })
        updateReturned = true
        return response({
          ok: true,
          result: [
            {
              update_id: 15,
              message: {
                message_id: 26,
                date: 1_800_000_000,
                voice: { file_id: 'exhausted-file-id', mime_type: 'audio/ogg' },
                from: { id: 42 },
                chat: { id: 42, type: 'private' },
              },
            },
          ],
        })
      }
      if (url.includes('/getFile')) {
        downloadCalls++
        return new Response('temporary outage', { status: 503 })
      }
      throw new Error('An oversized or failed download must not reach file/delete routes.')
    })
    const onAudioError = vi.fn()
    const service = new TelegramService({
      dataDirectory: data,
      vaultPath: () => vault,
      safeStorage: fakeSafeStorage(),
      fetcher: fetcher as unknown as typeof fetch,
      now: () => 1_800_000_000_000,
      onAudioError,
      audioRetryDelaysMs: [0],
    })
    await service.linkFromFile(credentialFile)
    service.start()
    const pendingPath = join(data, 'telegram-audio-pending.json')
    await vi.waitFor(() => expect(readFileSync(pendingPath, 'utf8')).toContain('"exhausted":true'))
    service.stop()
    expect(downloadCalls).toBe(2)
    expect(onAudioError).toHaveBeenCalledOnce()

    const afterRestartFetcher = vi.fn(async (input: unknown) => {
      if (String(input).includes('/getUpdates')) return response({ ok: true, result: [] })
      throw new Error('An exhausted retry must not fetch the file again automatically.')
    })
    const afterRestartError = vi.fn()
    const restarted = new TelegramService({
      dataDirectory: data,
      vaultPath: () => vault,
      safeStorage: fakeSafeStorage(),
      fetcher: afterRestartFetcher as unknown as typeof fetch,
      now: () => 1_800_000_001_000,
      onAudioError: afterRestartError,
    })
    restarted.start()
    await vi.waitFor(() => expect(afterRestartError).toHaveBeenCalledOnce())
    expect(afterRestartFetcher.mock.calls.some(([input]) => String(input).includes('/getFile'))).toBe(false)
    expect(readFileSync(pendingPath, 'utf8')).toContain('"exhausted":true')
    restarted.stop()
  })

  it('rejeita um stream acima de 20 MB sem materializar o corpo inteiro', async () => {
    const data = temp('telegram-data-')
    const vault = temp('telegram-vault-')
    const credentialFile = join(temp('telegram-import-'), 'credentials.json')
    writeFileSync(credentialFile, JSON.stringify({ botToken: token, userId: 42 }))
    const onAudio = vi.fn()
    const onAudioError = vi.fn()
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({ ok: true, result: { id: 123, username: 'fixture_bot' } }))
      .mockResolvedValueOnce(
        response({
          ok: true,
          result: [
            {
              update_id: 10,
              message: {
                message_id: 21,
                date: 1_800_000_000,
                voice: { file_id: 'oversize-file-id', mime_type: 'audio/ogg' },
                from: { id: 42 },
                chat: { id: 42, type: 'private' },
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(response({ ok: true, result: { file_path: 'voice/large.ogg' } }))
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(20 * 1024 * 1024 + 1))
              controller.close()
            },
          }),
        ),
      )
    const service = new TelegramService({
      dataDirectory: data,
      vaultPath: () => vault,
      safeStorage: fakeSafeStorage(),
      fetcher: fetcher as unknown as typeof fetch,
      now: () => 1_800_000_000_000,
      onAudio,
      onAudioError,
    })
    await service.linkFromFile(credentialFile)
    await service.pollOnce()
    await vi.waitFor(() => expect(onAudioError).toHaveBeenCalledOnce())

    expect(onAudio).not.toHaveBeenCalled()
    expect(existsSync(join(data, 'telegram-audio-pending.json'))).toBe(false)
  })

  it('apaga somente mensagem privada da conta vinculada e não expõe erro Telegram', async () => {
    const data = temp('telegram-data-')
    const vault = temp('telegram-vault-')
    const credentialFile = join(temp('telegram-import-'), 'credentials.json')
    writeFileSync(credentialFile, JSON.stringify({ botToken: token, userId: 42 }))
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({ ok: true, result: { id: 123, username: 'fixture_bot' } }))
      .mockResolvedValueOnce(response({ ok: true, result: true }))
    const service = new TelegramService({
      dataDirectory: data,
      vaultPath: () => vault,
      safeStorage: fakeSafeStorage(),
      fetcher: fetcher as unknown as typeof fetch,
    })
    await service.linkFromFile(credentialFile)

    expect(await service.deleteAudioMessage(43, 17)).toBe(false)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(await service.deleteAudioMessage(42, 17)).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({ method: 'POST', body: JSON.stringify({ chat_id: 42, message_id: 17 }) })
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
