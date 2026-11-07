import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callHandler } from './mocks/electron'
import { TelegramService } from '../src/main/telegram-service'
import { TelegramSettingsStore, type TokenCrypto } from '../src/main/telegram-settings'
import { registerTelegramIpc } from '../src/main/ipc/telegram'
import { LUNA_TELEGRAM_RULE } from '../src/main/luna-prompt'
import { MSG_CHAT_INVALID, MSG_TOKEN_REQUIRED, type TelegramView } from '../src/shared/telegram'

// Token fictício: nenhuma chamada real ao Telegram; tudo passa por fetch simulado.
const TOKEN = '123456789:FAKE-token-for-tests_ABCdefGHIjkl'
const crypto: TokenCrypto = {
  isAvailable: () => true,
  encrypt: (plain) => Buffer.from(plain, 'utf8').reverse(),
  decrypt: (data) => Buffer.from(data).reverse().toString('utf8'),
}

/** getUpdates fica pendente até abortar; registra as chamadas. */
function fakeFetch() {
  const calls: string[] = []
  const signals: AbortSignal[] = []
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push(String(url))
    const signal = init?.signal as AbortSignal
    return new Promise<Response>((_resolve, reject) => {
      signals.push(signal)
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    })
  })
  return { fetch: fn as unknown as typeof fetch, calls, signals }
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ao-telegram-svc-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function build() {
  const net = fakeFetch()
  const service = new TelegramService({ store: new TelegramSettingsStore(dir, crypto), fetch: net.fetch })
  return { service, net }
}

describe('IPC do Telegram', () => {
  it('a resposta de salvar e de estado nunca contém o token', async () => {
    const { service } = build()
    registerTelegramIpc({ telegram: service })
    const view = (await callHandler('office:telegramSave', { token: TOKEN, chatId: '42', enabled: false })) as TelegramView
    expect(view).toMatchObject({ enabled: false, tokenConfigured: true, chatId: '42', status: 'off' })
    const state = await callHandler('office:telegramState')
    for (const out of [view, state]) {
      expect(JSON.stringify(out)).not.toContain('FAKE-token')
      expect(JSON.stringify(out)).not.toContain('123456789:')
    }
  })

  it('valida os argumentos vindos do renderer', async () => {
    const { service } = build()
    registerTelegramIpc({ telegram: service })
    await expect(Promise.resolve().then(() => callHandler('office:telegramSave', { chatId: 42, enabled: true }))).rejects.toThrow(
      'Dados do Telegram inválidos.',
    )
    await expect(Promise.resolve().then(() => callHandler('office:telegramSave', 'x'))).rejects.toThrow('Dados do Telegram inválidos.')
    await expect(
      Promise.resolve().then(() => callHandler('office:telegramSave', { token: 'a'.repeat(500), chatId: '1', enabled: false })),
    ).rejects.toThrow('Dados do Telegram inválidos.')
  })
})

describe('TelegramService', () => {
  it('ligar inicia a ponte sem reiniciar o app e desligar a para', async () => {
    const { service, net } = build()
    const view = await service.save({ token: TOKEN, chatId: '42', enabled: true })
    await vi.waitFor(() => expect(net.calls).toHaveLength(1))
    expect(net.calls[0]).toContain('/getUpdates')
    expect(['connecting', 'connected']).toContain(view.status)
    const off = await service.save({ chatId: '42', enabled: false })
    expect(off.status).toBe('off')
    expect(net.signals[0]!.aborted).toBe(true)
  })

  it('token vazio ou chat_id inválido dá erro claro e não liga a ponte', async () => {
    const { service, net } = build()
    await expect(service.save({ token: '', chatId: '42', enabled: true })).rejects.toThrow(MSG_TOKEN_REQUIRED)
    await expect(service.save({ token: TOKEN, chatId: 'abc', enabled: true })).rejects.toThrow(MSG_CHAT_INVALID)
    expect(net.fetch).not.toHaveBeenCalled()
    expect(service.view().status).toBe('off')
  })

  it('a configuração persiste: ao reabrir, startFromSettings religa só se estava ligado', async () => {
    const first = build()
    await first.service.save({ token: TOKEN, chatId: '42', enabled: true })
    await first.service.stop()

    const second = build()
    await second.service.startFromSettings()
    await vi.waitFor(() => expect(second.net.calls).toHaveLength(1))
    expect(second.service.view()).toMatchObject({ enabled: true, tokenConfigured: true, chatId: '42' })
    await second.service.stop()

    await build().service.save({ chatId: '42', enabled: false })
    const third = build()
    await third.service.startFromSettings()
    expect(third.net.fetch).not.toHaveBeenCalled()
  })

  it('fechar o app (stop) aborta o polling pendente', async () => {
    const { service, net } = build()
    await service.save({ token: TOKEN, chatId: '42', enabled: true })
    await vi.waitFor(() => expect(net.signals).toHaveLength(1))
    await service.stop()
    expect(net.signals[0]!.aborted).toBe(true)
    expect(service.view().status).toBe('off')
  })

  it('a Luna ligada recebe a mensagem com as regras do canal e a resposta volta ao chat', async () => {
    const sent: { chat_id: number; text: string }[] = []
    let first = true
    const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith('/sendMessage')) {
        sent.push(JSON.parse(String(init?.body)))
        return new Response(JSON.stringify({ ok: true, result: {} }))
      }
      if (first) {
        first = false
        return new Response(JSON.stringify({ ok: true, result: [{ update_id: 1, message: { text: 'oi', chat: { id: 42, type: 'private' } } }] }))
      }
      const signal = init?.signal as AbortSignal
      return new Promise<Response>((_r, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
    })
    const service = new TelegramService({ store: new TelegramSettingsStore(dir, crypto), fetch: fn as unknown as typeof fetch })
    const ask = vi.fn(async (request: { text: string; channelRules: string }) => ({ text: `ok: ${request.text}`, needsAppCard: false }))
    service.attachLuna({ ask: (r) => ask(r) })
    await service.save({ token: TOKEN, chatId: '42', enabled: true })
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toEqual({ chat_id: 42, text: 'ok: oi' })
    expect(ask.mock.calls[0]![0].channelRules).toBe(LUNA_TELEGRAM_RULE)
    await service.stop()
  })
})
