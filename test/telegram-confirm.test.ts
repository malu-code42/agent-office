// AO-109, parte 3: confirmação por código do Telegram, tratada em código. Telegram e Luna simulados; nada real.
import { describe, expect, it, vi } from 'vitest'
import {
  CONFIRM_MAX_ATTEMPTS,
  CONFIRM_TTL_MS,
  MSG_CANCELLED,
  MSG_EXPIRED,
  MSG_WRONG_CODE,
  createTelegramConfirmation,
  isDestructiveRequest,
} from '../src/main/telegram-confirm'
import { MSG_HOURLY_LIMIT, MSG_STALE, TELEGRAM_HOURLY_LIMIT, TELEGRAM_MAX_AGE_MS, TelegramBridge } from '../src/main/telegram-bridge'

describe('o que conta como destrutivo', () => {
  it.each([
    'apague a tarefa X',
    'Exclua o compromisso',
    'delete tudo',
    'remova a reunião',
    'descarte a tarefa',
    'cancele o foco',
    'limpe a lista',
    'sobrescreva o arquivo',
    'faça commit',
    'dê push',
    'abra um PR',
    'faça o merge',
    'mescle o PR 7',
    'publique',
    'zera a agenda',
    'discard it',
    'DESCARTE',
  ])('%s é destrutivo', (t) => expect(isDestructiveRequest(t)).toBe(true))
  it.each(['o que tenho amanhã?', 'reserve 15h para estudar', 'mova a reunião para sexta', 'oi Luna', 'quais tarefas estão abertas'])(
    '%s não é',
    (t) => expect(isDestructiveRequest(t)).toBe(false),
  )
})

describe('gancho de confirmação', () => {
  const setup = () => {
    let t = 1_000_000
    const c = createTelegramConfirmation({ now: () => t, newCode: () => 'K7M2Q' })
    return { c, advance: (ms: number) => (t += ms), ask: (text: string, chatId = 1) => c.hook({ chatId, text }) }
  }

  it('pedido comum passa direto', async () => {
    const { ask } = setup()
    expect(await ask('o que tenho amanhã?')).toEqual({ handled: false })
  })

  it('destrutivo fica retido com código; só "SIM código" no mesmo chat o libera, com o texto original', async () => {
    const { ask, c } = setup()
    const first = await ask('descarte a tarefa X')
    expect(first.handled).toBe(true)
    expect(first.reply).toContain('SIM K7M2Q')
    expect(c.pending()).toBe(1)
    expect(await ask('sim k7m2q')).toMatchObject({ handled: false, text: 'descarte a tarefa X' })
    expect(c.pending()).toBe(0)
    expect((await ask('SIM K7M2Q')).handled).toBe(true) // uso único
  })

  it('outro chat não confirma o pedido de um chat', async () => {
    const { ask } = setup()
    await ask('apague tudo', 1)
    expect(await ask('SIM K7M2Q', 2)).toEqual({ handled: true, reply: MSG_EXPIRED })
  })

  it('código errado três vezes cancela; mensagem qualquer cancela; "não" cancela', async () => {
    const a = setup()
    await a.ask('apague tudo')
    expect((await a.ask('SIM AAAAA')).reply).toBe(MSG_WRONG_CODE)
    for (let i = 1; i < CONFIRM_MAX_ATTEMPTS; i++) await a.ask('SIM BBBBB')
    expect((await a.ask('SIM K7M2Q')).reply).toBe(MSG_EXPIRED)

    const b = setup()
    await b.ask('apague tudo')
    expect(await b.ask('e a agenda de amanhã?')).toEqual({ handled: false })
    expect((await b.ask('SIM K7M2Q')).reply).toBe(MSG_EXPIRED)

    const d = setup()
    await d.ask('apague tudo')
    expect((await d.ask('não')).reply).toBe(MSG_CANCELLED)
    expect((await d.ask('SIM K7M2Q')).reply).toBe(MSG_EXPIRED)
  })

  it('expira em 5 minutos', async () => {
    const { ask, advance } = setup()
    await ask('apague tudo')
    advance(CONFIRM_TTL_MS + 1)
    expect((await ask('SIM K7M2Q')).reply).toBe(MSG_EXPIRED)
  })

  it('um novo destrutivo troca o código pendente; o antigo deixa de valer', async () => {
    let n = 0
    const c = createTelegramConfirmation({ newCode: () => (n++ ? 'NOVO22' : 'VELHO2') })
    await c.hook({ chatId: 1, text: 'apague A' })
    await c.hook({ chatId: 1, text: 'apague B' })
    expect((await c.hook({ chatId: 1, text: 'SIM VELHO2' })).handled).toBe(true)
  })
})

describe('ponte com confirmação, mensagens antigas e limite por hora', () => {
  const NOW = 1_800_000_000_000
  type M = { id: number; text: string; ageMs?: number }
  function run(messages: M[], getNow: () => number = () => NOW) {
    const sent: string[] = []
    let first = true
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith('/sendMessage')) {
        sent.push(JSON.parse(String(init?.body)).text)
        return new Response(JSON.stringify({ ok: true, result: {} }))
      }
      if (first) {
        first = false
        const result = messages.map((m) => ({
          update_id: m.id,
          message: {
            text: m.text,
            chat: { id: 111, type: 'private' },
            ...(m.ageMs === undefined ? {} : { date: Math.floor((NOW - m.ageMs) / 1000) }),
          },
        }))
        return new Response(JSON.stringify({ ok: true, result }))
      }
      return new Promise<Response>((_r, rej) => init!.signal!.addEventListener('abort', () => rej(new DOMException('a', 'AbortError'))))
    }) as unknown as typeof fetch
    const ask = vi.fn(async (r: { text: string }) => ({ text: `ok: ${r.text}` }))
    const bridge = new TelegramBridge({
      config: () => ({ enabled: true, token: '123456:FAKE-token', chatIds: [111] }),
      luna: { ask },
      confirmation: createTelegramConfirmation({ newCode: () => 'K7M2Q', now: getNow }).hook,
      fetch: fetchFn,
      now: getNow,
      sleep: async () => undefined,
    })
    return { bridge, sent, ask }
  }

  it('destrutivo só chega à Luna depois do código, e com o texto original', async () => {
    const { bridge, sent, ask } = run([
      { id: 1, text: 'descarte a tarefa X', ageMs: 0 },
      { id: 2, text: 'SIM K7M2Q', ageMs: 0 },
    ])
    await bridge.start()
    await vi.waitFor(() => expect(sent.length).toBeGreaterThanOrEqual(3))
    expect(sent[0]).toContain('SIM K7M2Q')
    expect(ask).toHaveBeenCalledTimes(1)
    expect(ask.mock.calls[0]![0].text).toBe('descarte a tarefa X')
    await bridge.stop()
  })

  it('destrutivo sem confirmação nunca chega à Luna', async () => {
    const { bridge, sent, ask } = run([{ id: 1, text: 'apague tudo', ageMs: 0 }])
    await bridge.start()
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(ask).not.toHaveBeenCalled()
    await bridge.stop()
  })

  it('mensagem antiga ou sem data não é executada; um aviso por lote', async () => {
    const { bridge, sent, ask } = run([
      { id: 1, text: 'oi', ageMs: TELEGRAM_MAX_AGE_MS + 60_000 },
      { id: 2, text: 'oi de novo' },
      { id: 3, text: 'oi agora', ageMs: 1000 },
    ])
    await bridge.start()
    await vi.waitFor(() => expect(sent).toContain(MSG_STALE))
    expect(ask).toHaveBeenCalledTimes(1)
    expect(ask.mock.calls[0]![0].text).toBe('oi agora')
    expect(sent.filter((t) => t === MSG_STALE)).toHaveLength(1)
    await bridge.stop()
  })

  it('o limite por hora corta o excesso com um aviso', async () => {
    let t = NOW
    const batch = Array.from({ length: TELEGRAM_HOURLY_LIMIT.max + 5 }, (_, i) => ({ id: i + 1, text: `oi ${i}`, ageMs: -3_600_000 }))
    const { bridge, sent, ask } = run(batch, () => t)
    const orig = ask.getMockImplementation()!
    ask.mockImplementation(async (r) => {
      t += 7000 // espaça o relógio para não bater o limite por minuto
      return orig(r)
    })
    await bridge.start()
    await vi.waitFor(() => expect(sent).toContain(MSG_HOURLY_LIMIT), { timeout: 5000 })
    expect(ask).toHaveBeenCalledTimes(TELEGRAM_HOURLY_LIMIT.max)
    await bridge.stop()
  })
})
