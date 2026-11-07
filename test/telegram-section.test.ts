import { describe, expect, it } from 'vitest'
import { telegramStatusText } from '../src/renderer/src/ui/telegram-section'

describe('indicador de estado do Telegram (AO-84)', () => {
  it('mostra os quatro estados, com o motivo curto no erro', () => {
    expect(telegramStatusText({ status: 'off' })).toBe('Desligado')
    expect(telegramStatusText({ status: 'connecting' })).toBe('Conectando…')
    expect(telegramStatusText({ status: 'connected' })).toBe('Conectado')
    expect(telegramStatusText({ status: 'error', reason: 'Token recusado pelo Telegram' })).toBe('Erro: Token recusado pelo Telegram')
    expect(telegramStatusText({ status: 'error' })).toBe('Erro')
  })
})
