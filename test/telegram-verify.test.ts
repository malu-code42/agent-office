import { describe, expect, it, vi } from 'vitest'

// AO-112: a geração do código passa por crypto.randomInt (nunca Math.random).
const randomIntSpy = vi.hoisted(() => vi.fn())
vi.mock('node:crypto', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:crypto')>()
  randomIntSpy.mockImplementation(real.randomInt as never)
  return { ...real, randomInt: randomIntSpy }
})

import {
  CODE_COOLDOWN_MS,
  CODE_MAX_ATTEMPTS,
  CODE_TTL_MS,
  ChatVerification,
  botSender,
  randomCode,
} from '../src/main/telegram-verify'
import {
  MSG_CODE_COOLDOWN,
  MSG_CODE_EXHAUSTED,
  MSG_CODE_EXPIRED,
  MSG_CODE_NONE,
  MSG_CODE_SEND_FAILED,
  msgCodeWrong,
} from '../src/shared/telegram'

// Nenhuma chamada real ao Telegram: o envio é simulado.
function build(code = '123456') {
  let clock = 1_000_000
  const sent: { chatId: number; text: string }[] = []
  const v = new ChatVerification({
    send: async (chatId, text) => {
      sent.push({ chatId, text })
    },
    now: () => clock,
    newCode: () => code,
  })
  return { v, sent, advance: (ms: number) => (clock += ms) }
}

describe('verificação de posse do chat_id (AO-112)', () => {
  it('o código vem de crypto.randomInt, com 6 dígitos', () => {
    randomIntSpy.mockClear()
    const code = randomCode()
    expect(code).toMatch(/^\d{6}$/)
    expect(randomIntSpy).toHaveBeenCalledWith(0, 1_000_000)
  })

  it('código certo confirma e devolve o chat_id', async () => {
    const { v, sent } = build()
    await v.request('42')
    expect(sent).toHaveLength(1)
    expect(sent[0]!.chatId).toBe(42)
    expect(sent[0]!.text).toContain('123456')
    expect(v.check('123456', '42')).toBe('42')
  })

  it('código errado erra com tentativas restantes e o certo ainda vale', async () => {
    const { v } = build()
    await v.request('42')
    expect(() => v.check('000000', '42')).toThrow(msgCodeWrong(CODE_MAX_ATTEMPTS - 1))
    expect(v.check('123456', '42')).toBe('42')
  })

  it('é de uso único: o mesmo código não vale duas vezes', async () => {
    const { v } = build()
    await v.request('42')
    v.check('123456', '42')
    expect(() => v.check('123456', '42')).toThrow(MSG_CODE_NONE)
  })

  it('código expirado é recusado, mesmo certo', async () => {
    const { v, advance } = build()
    await v.request('42')
    advance(CODE_TTL_MS + 1)
    expect(v.hasPending()).toBe(false)
    expect(() => v.check('123456', '42')).toThrow(MSG_CODE_NONE)
  })

  it('expirado sem consultar antes: check recusa', async () => {
    const { v, advance } = build()
    await v.request('42')
    advance(CODE_TTL_MS + 1)
    expect(() => v.check('123456', '42')).toThrow(MSG_CODE_EXPIRED)
  })

  it('no limite do prazo ainda vale', async () => {
    const { v, advance } = build()
    await v.request('42')
    advance(CODE_TTL_MS)
    expect(v.check('123456', '42')).toBe('42')
  })

  it('tentativas esgotadas: a terceira errada invalida o código, e o certo depois também é recusado', async () => {
    const { v } = build()
    await v.request('42')
    expect(() => v.check('111111', '42')).toThrow(msgCodeWrong(2))
    expect(() => v.check('222222', '42')).toThrow(msgCodeWrong(1))
    expect(() => v.check('333333', '42')).toThrow(MSG_CODE_EXHAUSTED)
    expect(() => v.check('123456', '42')).toThrow(MSG_CODE_NONE)
  })

  it('se o chat_id mudou desde o envio, o código não vale', async () => {
    const { v } = build()
    await v.request('42')
    expect(() => v.check('123456', '43')).toThrow(MSG_CODE_EXPIRED)
  })

  it('um código novo invalida o anterior; há intervalo mínimo entre envios', async () => {
    let n = 0
    let clock = 0
    const v = new ChatVerification({ send: async () => undefined, now: () => clock, newCode: () => String(100000 + n++) })
    await v.request('42')
    await expect(v.request('42')).rejects.toThrow(MSG_CODE_COOLDOWN)
    clock += CODE_COOLDOWN_MS
    await v.request('42')
    expect(() => v.check('100000', '42')).toThrow(msgCodeWrong(2))
    expect(v.check('100001', '42')).toBe('42')
  })

  it('falha no envio: mensagem fixa, nada fica pendente, sem vazar o erro original', async () => {
    const v = new ChatVerification({
      send: async () => {
        throw new Error('https://api.telegram.org/bot123456789:SEGREDO/sendMessage')
      },
    })
    const err = await v.request('42').catch((e: Error) => e)
    expect((err as Error).message).toBe(MSG_CODE_SEND_FAILED)
    expect(v.hasPending()).toBe(false)
  })

  it('clear() descarta o código pendente', async () => {
    const { v } = build()
    await v.request('42')
    v.clear()
    expect(() => v.check('123456', '42')).toThrow(MSG_CODE_NONE)
  })

  it('botSender usa a Bot API simulada e não deixa a URL (com o token) nos erros', async () => {
    const calls: string[] = []
    const okFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push(`${String(url)} ${String(init?.body)}`)
      return new Response(JSON.stringify({ ok: true, result: {} }))
    }) as unknown as typeof fetch
    await botSender('123456789:TOKEN', okFetch)(42, 'oi')
    expect(calls[0]).toBe('https://api.telegram.org/bot123456789:TOKEN/sendMessage {"chat_id":42,"text":"oi"}')
    const failing = vi.fn(async () => {
      throw new Error('https://api.telegram.org/bot123456789:TOKEN/sendMessage')
    }) as unknown as typeof fetch
    const err = await botSender('123456789:TOKEN', failing)(42, 'oi').catch((e: Error) => e)
    expect((err as Error).message).not.toContain('TOKEN')
    const notOk = vi.fn(async () => new Response('{}', { status: 400 })) as unknown as typeof fetch
    await expect(botSender('123456789:TOKEN', notOk)(42, 'oi')).rejects.toThrow()
  })
})
