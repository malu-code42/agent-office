import { describe, expect, it } from 'vitest'
import { allowMicrophone } from '../src/main/mic-permission'

const PAGE = 'file:///C:/app/resources/app.asar/out/renderer/index.html'

describe('permissão do microfone', () => {
  it('libera só áudio, para a página do próprio app', () => {
    expect(allowMicrophone({ permission: 'media', url: PAGE, mediaTypes: ['audio'] }, undefined)).toBe(true)
  })
  it('nega vídeo, câmera junto com microfone e pedidos sem tipo', () => {
    expect(allowMicrophone({ permission: 'media', url: PAGE, mediaTypes: ['video'] }, undefined)).toBe(false)
    expect(allowMicrophone({ permission: 'media', url: PAGE, mediaTypes: ['audio', 'video'] }, undefined)).toBe(false)
    expect(allowMicrophone({ permission: 'media', url: PAGE, mediaTypes: [] }, undefined)).toBe(false)
  })
  it('nega qualquer outra permissão', () => {
    for (const p of ['geolocation', 'notifications', 'clipboard-read', 'display-capture', 'fullscreen'])
      expect(allowMicrophone({ permission: p, url: PAGE, mediaTypes: ['audio'] }, undefined)).toBe(false)
  })
  it('nega outras origens, como o iframe do rádio', () => {
    expect(allowMicrophone({ permission: 'media', url: 'https://www.youtube-nocookie.com/embed/x', mediaTypes: ['audio'] }, undefined)).toBe(false)
    expect(allowMicrophone({ permission: 'media', url: 'não é url', mediaTypes: ['audio'] }, undefined)).toBe(false)
  })
  it('em desenvolvimento, só a origem do servidor da página', () => {
    const dev = 'http://localhost:5173'
    expect(allowMicrophone({ permission: 'media', url: 'http://localhost:5173/', mediaTypes: ['audio'] }, dev)).toBe(true)
    expect(allowMicrophone({ permission: 'media', url: 'http://localhost:9999/', mediaTypes: ['audio'] }, dev)).toBe(false)
    expect(allowMicrophone({ permission: 'media', url: PAGE, mediaTypes: ['audio'] }, dev)).toBe(false)
  })
})
