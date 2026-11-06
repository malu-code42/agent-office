import { describe, expect, it, vi } from 'vitest'
import { publishThenStartNext } from '../src/main/squad-ticket-lifecycle'

describe('AO-54: encerramento da conversa publicada', () => {
  it.each(['próximo ticket', 'grupo encerrado', 'squad pausado'])('limpa antes de verificar %s', async () => {
    const order: string[] = []
    const confirmed = await publishThenStartNext({
      publish: async () => {
        order.push('publica')
      },
      finishTicket: () => {
        order.push('limpa')
      },
      startNext: async () => {
        order.push('verifica próximo')
      },
      publicationFailed: vi.fn(),
      nextStartFailed: vi.fn(),
    })
    expect(confirmed).toBe(true)
    expect(order).toEqual(['publica', 'limpa', 'verifica próximo'])
  })

  it('preserva contexto e resultado quando a publicação falha', async () => {
    const finishTicket = vi.fn()
    const startNext = vi.fn()
    expect(
      await publishThenStartNext({
        publish: async () => {
          throw new Error('PR não confirmado')
        },
        finishTicket,
        startNext,
        publicationFailed: vi.fn(),
        nextStartFailed: vi.fn(),
      }),
    ).toBe(false)
    expect(finishTicket).not.toHaveBeenCalled()
    expect(startNext).not.toHaveBeenCalled()
  })
})
