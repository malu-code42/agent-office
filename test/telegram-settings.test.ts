import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TELEGRAM_FILE, TelegramSettingsStore, type TokenCrypto } from '../src/main/telegram-settings'
import { isCredentialPath } from '../src/main/permissions/floor'
import { redact } from '../src/main/log'
import {
  MSG_CHAT_INVALID,
  MSG_CHAT_REQUIRED,
  MSG_STORAGE_UNAVAILABLE,
  MSG_TOKEN_INVALID,
  MSG_TOKEN_REQUIRED,
  isValidTelegramChatId,
  isValidTelegramToken,
} from '../src/shared/telegram'

// Token fictício: nenhum teste fala com o Telegram.
const TOKEN = '123456789:FAKE-token-for-tests_ABCdefGHIjkl'

/** "Criptografia" de teste: inverte os bytes. Basta para provar que o disco não recebe o texto puro. */
function fakeCrypto(available = true): TokenCrypto {
  return {
    isAvailable: () => available,
    encrypt: (plain) => Buffer.from(plain, 'utf8').reverse(),
    decrypt: (data) => Buffer.from(data).reverse().toString('utf8'),
  }
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ao-telegram-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('validação', () => {
  it('aceita token no formato do BotFather e chat_id inteiro positivo', () => {
    expect(isValidTelegramToken(TOKEN)).toBe(true)
    expect(isValidTelegramChatId('123456789')).toBe(true)
  })
  it('recusa token malformado e chat_id inválido (letras, negativo, zero, decimal, espaço)', () => {
    for (const t of ['', 'abc', '123:curto', 'sem-dois-pontos-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', `${TOKEN} x`]) {
      expect(isValidTelegramToken(t), t).toBe(false)
    }
    for (const c of ['', 'abc', '-100123', '0', '12.5', '12 3', '1e5', '1234567890123456']) {
      expect(isValidTelegramChatId(c), c).toBe(false)
    }
  })
})

describe('TelegramSettingsStore', () => {
  it('guarda o token criptografado: o arquivo não contém o texto puro', () => {
    const store = new TelegramSettingsStore(dir, fakeCrypto())
    store.save({ token: TOKEN, chatId: '42', enabled: true })
    const onDisk = readFileSync(join(dir, TELEGRAM_FILE), 'utf8')
    expect(onDisk).not.toContain(TOKEN)
    expect(onDisk).not.toContain('FAKE-token')
    expect(store.config()).toEqual({ enabled: true, token: TOKEN, chatIds: [42] })
  })

  it('o resumo para a tela não traz o token, só "configurado"', () => {
    const store = new TelegramSettingsStore(dir, fakeCrypto())
    store.save({ token: TOKEN, chatId: '42', enabled: false })
    const summary = store.summary()
    expect(summary).toEqual({ enabled: false, tokenConfigured: true, chatId: '42' })
    expect(JSON.stringify(summary)).not.toContain('FAKE-token')
  })

  it('persiste ao reabrir (outra instância lê o mesmo arquivo)', () => {
    new TelegramSettingsStore(dir, fakeCrypto()).save({ token: TOKEN, chatId: '42', enabled: true })
    const again = new TelegramSettingsStore(dir, fakeCrypto())
    expect(again.summary()).toEqual({ enabled: true, tokenConfigured: true, chatId: '42' })
    expect(again.config().token).toBe(TOKEN)
  })

  it('token em branco mantém o que já estava guardado', () => {
    const store = new TelegramSettingsStore(dir, fakeCrypto())
    store.save({ token: TOKEN, chatId: '42', enabled: false })
    store.save({ token: '', chatId: '43', enabled: true })
    expect(store.config()).toEqual({ enabled: true, token: TOKEN, chatIds: [43] })
  })

  it('ligar sem token ou sem chat_id dá erro claro e não grava nada', () => {
    const store = new TelegramSettingsStore(dir, fakeCrypto())
    expect(() => store.save({ token: '', chatId: '42', enabled: true })).toThrow(MSG_TOKEN_REQUIRED)
    expect(() => store.save({ token: TOKEN, chatId: '', enabled: true })).toThrow(MSG_CHAT_REQUIRED)
    expect(() => store.save({ token: TOKEN, chatId: '-5', enabled: true })).toThrow(MSG_CHAT_INVALID)
    expect(() => store.save({ token: 'lixo', chatId: '42', enabled: true })).toThrow(MSG_TOKEN_INVALID)
    expect(store.summary()).toEqual({ enabled: false, tokenConfigured: false, chatId: '' })
    expect(() => readFileSync(join(dir, TELEGRAM_FILE))).toThrow()
  })

  it('a mensagem de erro nunca repete o token digitado', () => {
    const store = new TelegramSettingsStore(dir, fakeCrypto())
    const bad = '999999:token-quase-valido'
    expect(() => store.save({ token: bad, chatId: '42', enabled: true })).toThrow(MSG_TOKEN_INVALID)
    expect(MSG_TOKEN_INVALID).not.toContain('quase')
  })

  it('sem safeStorage disponível o token novo é recusado, nunca guardado em texto puro', () => {
    const store = new TelegramSettingsStore(dir, fakeCrypto(false))
    expect(() => store.save({ token: TOKEN, chatId: '42', enabled: true })).toThrow(MSG_STORAGE_UNAVAILABLE)
    expect(() => readFileSync(join(dir, TELEGRAM_FILE))).toThrow()
  })

  it('token guardado que não decifra mais deixa a ponte sem token (não liga)', () => {
    new TelegramSettingsStore(dir, fakeCrypto()).save({ token: TOKEN, chatId: '42', enabled: true })
    const broken = new TelegramSettingsStore(dir, {
      isAvailable: () => true,
      encrypt: () => new Uint8Array(),
      decrypt: () => {
        throw new Error('chave mudou')
      },
    })
    expect(broken.config().token).toBe('')
  })

  it('o piso de permissões trata o arquivo como credencial', () => {
    expect(isCredentialPath(join(dir, TELEGRAM_FILE))).toBe(true)
  })

  it('o log redige o token do bot, puro ou dentro da URL da API', () => {
    const out = redact(`falhou https://api.telegram.org/bot${TOKEN}/getUpdates e ${TOKEN}`)
    expect(out).not.toContain('FAKE-token')
    expect(out).not.toContain('123456789:')
  })
})
