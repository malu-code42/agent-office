import { describe, expect, it } from 'vitest'
import { autoStop, bandEdges, NO_SPEECH_MS, SILENCE_STOP_MS } from '../src/shared/voice'

describe('autoStop', () => {
  it('depois de falar, para no silêncio longo', () => {
    expect(autoStop(10_000 + SILENCE_STOP_MS - 1, 0, 10_000)).toBeNull()
    expect(autoStop(10_000 + SILENCE_STOP_MS, 0, 10_000)).toBe('silence')
  })
  it('o silêncio que encerra o clique é de 3 s', () => {
    expect(SILENCE_STOP_MS).toBe(3000)
  })
  it('sem fala nenhuma, desiste no prazo e não chama o transcritor', () => {
    expect(autoStop(NO_SPEECH_MS - 1, 0, 0)).toBeNull()
    expect(autoStop(5_000 + NO_SPEECH_MS, 5_000, 0)).toBe('nospeech')
  })
  it('quem acabou de falar não para', () => {
    expect(autoStop(60_000, 0, 59_900)).toBeNull()
  })
})

describe('bandEdges', () => {
  it('divide a voz em faixas crescentes, cada uma com pelo menos um bin', () => {
    const e = bandEdges(48_000, 2048, 12)
    expect(e).toHaveLength(13)
    for (let k = 1; k < e.length; k++) expect(e[k]).toBeGreaterThan(e[k - 1])
    expect(e[0]).toBe(4)
    expect(e[12]).toBe(137)
  })
  it('com bins largos, as faixas graves não se sobrepõem', () => {
    const e = bandEdges(48_000, 256, 12)
    expect(new Set(e).size).toBe(e.length)
  })
})
