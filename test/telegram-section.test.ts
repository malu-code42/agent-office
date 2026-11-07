import { describe, expect, it } from 'vitest'
import { telegramStatusText, telegramVerifyText } from '../src/renderer/src/ui/telegram-section'

describe('indicador de estado do Telegram (AO-84)', () => {
  it('mostra os quatro estados, com o motivo curto no erro', () => {
    expect(telegramStatusText({ status: 'off' })).toBe('Desligado')
    expect(telegramStatusText({ status: 'connecting' })).toBe('Conectando…')
    expect(telegramStatusText({ status: 'connected' })).toBe('Conectado')
    expect(telegramStatusText({ status: 'error', reason: 'Token recusado pelo Telegram' })).toBe('Erro: Token recusado pelo Telegram')
    expect(telegramStatusText({ status: 'error' })).toBe('Erro')
  })
})

describe('passo de verificação do chat_id (AO-112)', () => {
  const base = { verified: false, codePending: false, tokenConfigured: true, chatId: '42' }
  it('descreve cada situação sem mostrar código', () => {
    expect(telegramVerifyText({ ...base, verified: true })).toBe('Chat verificado: sim.')
    expect(telegramVerifyText({ ...base, tokenConfigured: false })).toContain('Salve o token e o chat_id')
    expect(telegramVerifyText({ ...base, codePending: true })).toContain('digite os 6 números')
    expect(telegramVerifyText(base)).toContain('Peça um código')
  })
})
