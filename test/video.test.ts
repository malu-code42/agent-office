import { describe, expect, it } from 'vitest'
import { BLUR_FPS, DEFAULT_VIDEO, effectiveVideo, frameInterval, IDLE_FPS } from '../src/shared/video'

describe('effectiveVideo', () => {
  it('na bateria com a opção marcada entra em Economia: 30 fps', () => {
    expect(effectiveVideo({ fpsLimit: 0, batterySaver: true }, true)).toEqual({ fpsLimit: 30, batterySaver: true, saving: true })
  })
  it('na tomada, ou com a opção desmarcada, fica o que o jogador escolheu', () => {
    expect(effectiveVideo(DEFAULT_VIDEO, false)).toEqual({ ...DEFAULT_VIDEO, saving: false })
    expect(effectiveVideo({ fpsLimit: 0, batterySaver: false }, true)).toEqual({ fpsLimit: 0, batterySaver: false, saving: false })
  })
})

describe('frameInterval', () => {
  const base = { fpsLimit: 60 as const, busy: true, focused: true, fullSpeed: false }
  it('em movimento respeita o limite de fps', () => {
    expect(frameInterval(base)).toBeCloseTo(1000 / 60)
    expect(frameInterval({ ...base, fpsLimit: 30 })).toBeCloseTo(1000 / 30)
    expect(frameInterval({ ...base, fpsLimit: 0 })).toBe(0)
  })
  it('cena parada cai para o passo lento; sem foco, para o de fundo', () => {
    expect(frameInterval({ ...base, busy: false })).toBeCloseTo(1000 / IDLE_FPS)
    expect(frameInterval({ ...base, focused: false })).toBeCloseTo(1000 / BLUR_FPS)
    expect(frameInterval({ ...base, busy: false, focused: false })).toBeCloseTo(1000 / Math.min(IDLE_FPS, BLUR_FPS))
  })
  it('o bench sem ritmo desenha todo frame', () => {
    expect(frameInterval({ ...base, fpsLimit: 30, busy: false, focused: false, fullSpeed: true })).toBe(0)
  })
})
