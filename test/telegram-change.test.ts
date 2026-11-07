import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callHandler, dialog } from './mocks/electron'
import { TelegramService } from '../src/main/telegram-service'
import { TELEGRAM_FILE, TelegramSettingsStore, type TelegramChange, type TokenCrypto } from '../src/main/telegram-settings'
import { confirmTelegramChange } from '../src/main/telegram-change-dialog'
import { registerTelegramIpc } from '../src/main/ipc/telegram'
import { log } from '../src/main/log'
import { MSG_CHANGE_DECLINED, MSG_CODE_EXHAUSTED, MSG_CODE_EXPIRED, MSG_CODE_NONE, MSG_NEEDS_VERIFICATION, msgCodeWrong, type TelegramView } from '../src/shared/telegram'

// Nenhuma chamada real ao Telegram: getUpdates fica pendente até abortar e o envio do código é simulado.
const TOKEN = '123456789:FAKE-token-for-tests_ABCdefGHIjkl'
const TOKEN2 = '987654321:OTHER-fake-token-for-tests_ABCdefG'
const CODE = '482916'
const crypto: TokenCrypto = {
  isAvailable: () => true,
  encrypt: (plain) => Buffer.from(plain, 'utf8').reverse(),
  decrypt: (data) => Buffer.from(data).reverse().toString('utf8'),
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ao-telegram-chg-'))
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

function build(confirm: (change: TelegramChange) => Promise<boolean> = async () => true) {
  const polls: string[] = []
  const fetchFake = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    polls.push(String(url))
    const signal = init?.signal as AbortSignal
    return new Promise<Response>((_r, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
  }) as unknown as typeof fetch
  const sent: { token: string; chatId: number; text: string }[] = []
  let clock = 5_000_000
  const confirmChange = vi.fn(confirm)
  const store = new TelegramSettingsStore(dir, crypto)
  const service = new TelegramService({
    store,
    fetch: fetchFake,
    confirmChange,
    sendCode: (token) => async (chatId, text) => {
      sent.push({ token, chatId, text })
    },
    now: () => clock,
    newCode: () => CODE,
  })
  return { service, store, polls, sent, confirmChange, advance: (ms: number) => (clock += ms) }
}

describe('diálogo de confirmação no processo principal (AO-111)', () => {
  it('confirmar: o diálogo é o nativo (showMessageBox), devolve true e nunca traz o token', async () => {
    const spy = vi.spyOn(dialog, 'showMessageBox').mockResolvedValue({ response: 0 } as never)
    const ok = await confirmTelegramChange({} as never, { chat: { from: '42', to: '43' }, token: true })
    expect(ok).toBe(true)
    expect(spy).toHaveBeenCalledTimes(1)
    const options = JSON.stringify((spy.mock.calls[0] as unknown[])[1])
    expect(options).toContain('42')
    expect(options).toContain('43')
    expect(options).not.toContain('FAKE-token')
    expect(options).not.toContain('123456789')
  })

  it('negar (Cancelar) devolve false', async () => {
    vi.spyOn(dialog, 'showMessageBox').mockResolvedValue({ response: 1 } as never)
    expect(await confirmTelegramChange({} as never, { token: true })).toBe(false)
  })

  it('fechar o diálogo (Esc/X devolve o cancelId), falha do diálogo ou sem janela não confirma', async () => {
    const spy = vi.spyOn(dialog, 'showMessageBox').mockResolvedValue({ response: 1 } as never)
    expect(await confirmTelegramChange({} as never, { token: true })).toBe(false)
    expect((spy.mock.calls[0] as unknown[])[1]).toMatchObject({ cancelId: 1, defaultId: 1 })
    spy.mockRejectedValue(new Error('janela destruída'))
    expect(await confirmTelegramChange({} as never, { token: true })).toBe(false)
    expect(await confirmTelegramChange(null, { token: true })).toBe(false)
  })

  it('mudar chat_id ou token pergunta; sem mudança (só o interruptor ou o mesmo token) não pergunta', async () => {
    const b = build()
    await b.service.save({ token: TOKEN, chatId: '42', enabled: false })
    expect(b.confirmChange).toHaveBeenCalledTimes(1)
    expect(b.confirmChange.mock.calls[0]![0]).toEqual({ chat: { from: '', to: '42' }, token: true })
    await b.service.save({ chatId: '42', enabled: false })
    await b.service.save({ token: TOKEN, chatId: '42', enabled: false })
    expect(b.confirmChange).toHaveBeenCalledTimes(1)
    await b.service.save({ chatId: '43', enabled: false })
    await b.service.save({ token: TOKEN2, chatId: '43', enabled: false })
    expect(b.confirmChange).toHaveBeenCalledTimes(3)
  })

  it('negado: nada é salvo (arquivo intacto) e a ponte segue como estava', async () => {
    const b = build()
    await b.service.save({ token: TOKEN, chatId: '42', enabled: false })
    b.store.markVerified()
    await b.service.save({ chatId: '42', enabled: true })
    await vi.waitFor(() => expect(b.polls).toHaveLength(1))
    const before = readFileSync(join(dir, TELEGRAM_FILE), 'utf8')
    b.confirmChange.mockResolvedValue(false)
    await expect(b.service.save({ token: TOKEN2, chatId: '99', enabled: true })).rejects.toThrow(MSG_CHANGE_DECLINED)
    expect(readFileSync(join(dir, TELEGRAM_FILE), 'utf8')).toBe(before)
    expect(b.service.view()).toMatchObject({ enabled: true, chatId: '42', verified: true })
    expect(['connecting', 'connected']).toContain(b.service.view().status)
    expect(b.polls).toHaveLength(1)
    await b.service.stop()
  })

  it('validação vem antes do diálogo: entrada inválida não abre diálogo', async () => {
    const b = build()
    await expect(b.service.save({ token: 'lixo', chatId: '42', enabled: false })).rejects.toThrow()
    expect(b.confirmChange).not.toHaveBeenCalled()
  })

  it('confirmado: grava, e o chat_id novo exige nova verificação (a ponte desliga)', async () => {
    const b = build()
    await b.service.save({ token: TOKEN, chatId: '42', enabled: false })
    b.store.markVerified()
    await b.service.save({ chatId: '42', enabled: true })
    await vi.waitFor(() => expect(b.polls).toHaveLength(1))
    const view = await b.service.save({ chatId: '43', enabled: true })
    expect(view).toMatchObject({ chatId: '43', verified: false })
    expect(view.status).toBe('error')
    expect(view.reason).toBe(MSG_NEEDS_VERIFICATION)
    expect(b.polls).toHaveLength(1)
  })
})

describe('verificação de posse antes de ligar (AO-112)', () => {
  it('sem verificação a ponte não liga, mesmo ligada nos ajustes', async () => {
    const b = build()
    const view = await b.service.save({ token: TOKEN, chatId: '42', enabled: true })
    expect(view).toMatchObject({ enabled: true, verified: false, status: 'error', reason: MSG_NEEDS_VERIFICATION })
    await b.service.startFromSettings()
    expect(b.polls).toHaveLength(0)
  })

  it('ao reabrir o app, ligada mas nunca verificada continua desligada', async () => {
    const a = build()
    await a.service.save({ token: TOKEN, chatId: '42', enabled: true })
    const again = build()
    await again.service.startFromSettings()
    expect(again.polls).toHaveLength(0)
    expect(again.store.isVerified()).toBe(false)
  })

  it('fluxo completo: pedir código, digitar o certo, a ponte liga; o código vai só ao chat, nunca à tela', async () => {
    const b = build()
    registerTelegramIpc({ telegram: b.service })
    await b.service.save({ token: TOKEN, chatId: '42', enabled: true })
    const asked = (await callHandler('office:telegramRequestCode')) as TelegramView
    expect(b.sent).toHaveLength(1)
    expect(b.sent[0]).toMatchObject({ token: TOKEN, chatId: 42 })
    expect(b.sent[0]!.text).toContain(CODE)
    expect(asked).toMatchObject({ codePending: true, verified: false })
    const views = [asked, await callHandler('office:telegramState'), b.service.view()]
    for (const v of views) {
      expect(JSON.stringify(v)).not.toContain(CODE)
      expect(JSON.stringify(v)).not.toContain('FAKE-token')
    }
    const done = (await callHandler('office:telegramSubmitCode', CODE)) as TelegramView
    expect(done).toMatchObject({ verified: true, codePending: false })
    await vi.waitFor(() => expect(b.polls).toHaveLength(1))
    expect(b.polls[0]).toContain('/getUpdates')
    await b.service.stop()
  })

  it('o código não é registrado em log', async () => {
    const spies = [vi.spyOn(log, 'info'), vi.spyOn(log, 'warn'), vi.spyOn(log, 'error')]
    const b = build()
    await b.service.save({ token: TOKEN, chatId: '42', enabled: true })
    await b.service.requestCode()
    await b.service.submitCode(CODE)
    for (const spy of spies) expect(JSON.stringify(spy.mock.calls)).not.toContain(CODE)
    await b.service.stop()
  })

  it('código errado: recusa, não verifica e não liga', async () => {
    const b = build()
    await b.service.save({ token: TOKEN, chatId: '42', enabled: true })
    await b.service.requestCode()
    await expect(b.service.submitCode('000000')).rejects.toThrow(msgCodeWrong(2))
    expect(b.service.view()).toMatchObject({ verified: false, codePending: true })
    expect(b.polls).toHaveLength(0)
  })

  it('código expirado (5 min): recusa mesmo digitando o certo', async () => {
    const b = build()
    await b.service.save({ token: TOKEN, chatId: '42', enabled: true })
    await b.service.requestCode()
    b.advance(5 * 60_000 + 1)
    await expect(b.service.submitCode(CODE)).rejects.toThrow(MSG_CODE_EXPIRED)
    expect(b.service.view().verified).toBe(false)
    expect(b.polls).toHaveLength(0)
  })

  it('tentativas esgotadas (3): depois disso nem o certo vale', async () => {
    const b = build()
    await b.service.save({ token: TOKEN, chatId: '42', enabled: true })
    await b.service.requestCode()
    await expect(b.service.submitCode('111111')).rejects.toThrow()
    await expect(b.service.submitCode('222222')).rejects.toThrow()
    await expect(b.service.submitCode('333333')).rejects.toThrow(MSG_CODE_EXHAUSTED)
    await expect(b.service.submitCode(CODE)).rejects.toThrow(MSG_CODE_NONE)
    expect(b.service.view().verified).toBe(false)
    expect(b.polls).toHaveLength(0)
  })

  it('uso único: depois de verificar, o código não vale de novo', async () => {
    const b = build()
    await b.service.save({ token: TOKEN, chatId: '42', enabled: false })
    await b.service.requestCode()
    await b.service.submitCode(CODE)
    await expect(b.service.submitCode(CODE)).rejects.toThrow(MSG_CODE_NONE)
  })

  it('trocar o chat_id descarta o código pendente', async () => {
    const b = build()
    await b.service.save({ token: TOKEN, chatId: '42', enabled: false })
    await b.service.requestCode()
    await b.service.save({ chatId: '43', enabled: false })
    expect(b.service.view().codePending).toBe(false)
    await expect(b.service.submitCode(CODE)).rejects.toThrow(MSG_CODE_NONE)
  })

  it('formato inválido, sem configuração e já verificado são recusados', async () => {
    const b = build()
    await expect(b.service.requestCode()).rejects.toThrow()
    await b.service.save({ token: TOKEN, chatId: '42', enabled: false })
    await expect(b.service.submitCode('abc')).rejects.toThrow()
    await b.service.requestCode()
    await b.service.submitCode(CODE)
    await expect(b.service.requestCode()).rejects.toThrow()
  })

  it('o IPC valida o argumento do código', async () => {
    const b = build()
    registerTelegramIpc({ telegram: b.service })
    await expect(Promise.resolve().then(() => callHandler('office:telegramSubmitCode', 123456))).rejects.toThrow('Código inválido.')
  })
})
