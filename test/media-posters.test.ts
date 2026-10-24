import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMediaPosters } from '../src/main/media-posters'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d])
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46])
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0x00, 0x00, 0x00]), Buffer.from('WEBPVP8 ')])
const MIB = 1024 * 1024

afterEach(() => vi.restoreAllMocks())

describe('seleção temporária de pôsteres', () => {
  it('guarda bytes e devolve token, prévia, extensão e tamanho sem origem', () => {
    const posters = createMediaPosters({ newToken: () => 'token-1' })
    const selection = posters.add(PNG, 'png')

    expect(selection).toEqual({
      token: 'token-1',
      previewDataUrl: `data:image/png;base64,${PNG.toString('base64')}`,
      extension: 'png',
      sizeBytes: PNG.length,
    })
    expect(posters.take(selection.token)).toEqual({ bytes: PNG, extension: 'png' })
    expect('filePath' in selection).toBe(false)
  })

  it('take consome o token uma única vez', () => {
    const posters = createMediaPosters({ newToken: () => 'token-1' })
    posters.add(PNG, 'png')
    expect(posters.take('token-1')).toEqual({ bytes: PNG, extension: 'png' })
    expect(posters.take('token-1')).toBeUndefined()
  })

  it('discard remove o buffer de forma idempotente', () => {
    const posters = createMediaPosters({ newToken: () => 'token-1' })
    posters.add(PNG, 'png')
    posters.discard('token-1')
    posters.discard('token-1')
    expect(posters.take('token-1')).toBeUndefined()
  })

  it('remove tokens expirados antes de adicionar e consumir', () => {
    let now = 100
    const posters = createMediaPosters({ now: () => now, ttlMs: 50, newToken: () => 'token-1' })
    posters.add(PNG, 'png')
    now = 150
    expect(posters.take('token-1')).toBeUndefined()
    expect(() => posters.add(PNG, 'png')).not.toThrow()
  })

  it('expira e limpa o buffer pelo TTL sem outra chamada ao store', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(100))
    const posters = createMediaPosters({ ttlMs: 50, newToken: () => 'token-ttl' })
    posters.add(PNG, 'png')

    expect(posters.pendingCount).toBe(1)
    vi.advanceTimersByTime(50)

    expect(posters.pendingCount).toBe(0)
    expect(posters.take('token-ttl')).toBeUndefined()
    vi.useRealTimers()
  })

  it('cancela timers quando consome, descarta ou limpa o store', () => {
    vi.useFakeTimers()
    const posters = createMediaPosters({
      ttlMs: 50,
      newToken: (() => {
        let i = 0
        return () => `token-${++i}`
      })(),
    })
    posters.add(PNG, 'png')
    posters.add(PNG, 'png')
    posters.take('token-1')
    posters.discard('token-2')
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
  })

  it('limita seleções pendentes após limpar expirados', () => {
    const posters = createMediaPosters({
      maxPending: 1,
      newToken: (() => {
        let i = 0
        return () => `token-${++i}`
      })(),
    })
    posters.add(PNG, 'png')
    expect(() => posters.add(PNG, 'png')).toThrow('Já há seleções de pôster demais aguardando confirmação.')
    posters.discard('token-1')
    expect(() => posters.add(PNG, 'png')).not.toThrow()
  })

  it.each([
    ['png', PNG, 'png'],
    ['jpg', JPEG, 'jpeg'],
    ['jpeg', JPEG, 'jpeg'],
    ['webp', WEBP, 'webp'],
  ])('valida %s e retorna extensão canônica', (extension, bytes, canonical) => {
    const posters = createMediaPosters({ newToken: () => 'token' })
    expect(posters.add(bytes, extension).extension).toBe(canonical)
  })

  it('recusa extensão, assinatura, tamanho acima do limite e arquivo vazio', () => {
    const posters = createMediaPosters()
    expect(() => posters.add(PNG, 'gif')).toThrow('Escolha um pôster PNG, JPEG ou WebP.')
    expect(() => posters.add(JPEG, 'png')).toThrow('O arquivo não é um PNG válido.')
    expect(() => posters.add(Buffer.alloc(MIB * 10 + 1), 'png')).toThrow('O pôster passa de 10 MiB.')
    expect(() => posters.add(Buffer.alloc(0), 'png')).toThrow('O arquivo escolhido está vazio.')
  })

  it('aceita exatamente 10 MiB', () => {
    const bytes = Buffer.alloc(MIB * 10)
    PNG.copy(bytes)
    const posters = createMediaPosters({ newToken: () => 'token' })
    expect(posters.add(bytes, 'png').sizeBytes).toBe(MIB * 10)
  })
})
