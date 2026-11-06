import { afterEach, describe, expect, it, vi } from 'vitest'
import { barPause, barResume, barStart } from '../src/shared/barTimer'
import type { BarTimerView } from '../src/shared/barTimer'
import { barView } from '../src/shared/barTimer'
import { BarTimerSound } from '../src/main/bar-timer-sound'
import { barEndKey, barEndSoundDue, barStartSoundDue, END_GRACE_MS, type BarSoundCue } from '../src/shared/barTimerSound'

const MIN = 60_000
const T0 = 1_800_000_000_000

const running = (at = T0, mode: 25 | 5 | 15 = 25) => barView(barStart(mode, undefined, at), at)!
const paused = () => barView(barPause(barStart(25, undefined, T0), T0 + 5 * MIN), T0 + 5 * MIN)!
const interrupted = (): BarTimerView => ({ state: 'interrompida', mode: 25, remainingMs: 3 * MIN })

afterEach(() => vi.useRealTimers())

describe('barStartSoundDue', () => {
  it('toca ao iniciar a partir de um timer parado', () => {
    expect(barStartSoundDue(null, running())).toBe(true)
  })
  it('não toca ao retomar de uma pausa', () => {
    const p = paused()
    const resumed = barView(barResume(barPause(barStart(25, undefined, T0), T0 + 5 * MIN), T0 + 6 * MIN), T0 + 6 * MIN)!
    expect(barStartSoundDue(p, resumed)).toBe(false)
  })
  it('não toca ao pausar, zerar nem sem mudança de estado', () => {
    expect(barStartSoundDue(running(), paused())).toBe(false)
    expect(barStartSoundDue(running(), null)).toBe(false)
    expect(barStartSoundDue(running(), running())).toBe(false)
  })
  it('não toca para um timer que já nasce interrompido', () => {
    expect(barStartSoundDue(null, interrupted())).toBe(false)
  })
})

describe('barEndSoundDue', () => {
  it('toca quando o prazo chega a zero', () => {
    const v = running()
    expect(barEndSoundDue(v, T0 + 25 * MIN, undefined)).toBe(true)
  })
  it('não toca antes do prazo', () => {
    expect(barEndSoundDue(running(), T0 + 25 * MIN - 1, undefined)).toBe(false)
  })
  it('pausa e cancelamento não tocam o alarme', () => {
    expect(barEndSoundDue(paused(), T0 + 99 * MIN, undefined)).toBe(false)
    expect(barEndSoundDue(null, T0 + 99 * MIN, undefined)).toBe(false)
    expect(barEndSoundDue(interrupted(), T0 + 99 * MIN, undefined)).toBe(false)
  })
  it('não toca duas vezes o mesmo fim', () => {
    const v = running()
    const key = barEndKey(v)
    expect(barEndSoundDue(v, T0 + 25 * MIN, key)).toBe(false)
  })
  it('um novo intervalo tem outra chave e toca de novo', () => {
    const second = running(T0 + 40 * MIN)
    expect(barEndKey(second)).not.toBe(barEndKey(running()))
    expect(barEndSoundDue(second, T0 + 65 * MIN, barEndKey(running()))).toBe(true)
  })
  it('retomada depois de pausar usa o novo prazo e toca só nele', () => {
    const resumed = barView(barResume(barPause(barStart(25, undefined, T0), T0 + 5 * MIN), T0 + 10 * MIN), T0 + 10 * MIN)!
    expect(barEndSoundDue(resumed, T0 + 25 * MIN, undefined)).toBe(false)
    expect(barEndSoundDue(resumed, T0 + 30 * MIN, undefined)).toBe(true)
  })
  it('prazo velho (app aberto ou máquina acordada muito depois) não toca alarme atrasado', () => {
    expect(barEndSoundDue(running(), T0 + 25 * MIN + END_GRACE_MS + 1, undefined)).toBe(false)
    expect(barEndSoundDue(running(), T0 + 25 * MIN + END_GRACE_MS, undefined)).toBe(true)
  })
})

describe('BarTimerSound (agendador do processo principal)', () => {
  function setup(initial: BarTimerView | null) {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    let view = initial
    const cues: BarSoundCue[] = []
    const sound = new BarTimerSound(
      () => view,
      Date.now,
      (c) => cues.push(c),
    )
    return {
      cues,
      sound,
      set: (v: BarTimerView | null) => {
        view = v
        sound.onChange()
      },
    }
  }

  it('toca início ao iniciar e fim ao chegar a zero, mesmo sem ninguém olhando', () => {
    const s = setup(null)
    s.set(running())
    expect(s.cues).toEqual(['start'])
    vi.advanceTimersByTime(25 * MIN - 1)
    expect(s.cues).toEqual(['start'])
    vi.advanceTimersByTime(1)
    expect(s.cues).toEqual(['start', 'end'])
  })

  it('pausar cancela o alarme agendado', () => {
    const s = setup(null)
    s.set(running())
    vi.advanceTimersByTime(5 * MIN)
    s.set(paused())
    vi.advanceTimersByTime(60 * MIN)
    expect(s.cues).toEqual(['start'])
  })

  it('zerar cancela o alarme agendado', () => {
    const s = setup(null)
    s.set(running())
    s.set(null)
    vi.advanceTimersByTime(60 * MIN)
    expect(s.cues).toEqual(['start'])
  })

  it('retomar reagenda para o novo prazo e o alarme toca uma vez só', () => {
    const s = setup(null)
    s.set(running())
    vi.advanceTimersByTime(5 * MIN)
    s.set(paused())
    vi.advanceTimersByTime(10 * MIN)
    const at = Date.now()
    s.set(barView(barResume(barPause(barStart(25, undefined, T0), T0 + 5 * MIN), at), at)!)
    vi.advanceTimersByTime(20 * MIN)
    expect(s.cues).toEqual(['start', 'end'])
    // O popup zera o timer depois do aviso: a transição não toca de novo.
    s.set(null)
    s.set(null)
    vi.advanceTimersByTime(60 * MIN)
    expect(s.cues).toEqual(['start', 'end'])
  })

  it('timer já em andamento ao abrir o app agenda o fim sem tocar início', () => {
    const s = setup(running(T0 - 10 * MIN))
    s.sound.arm()
    expect(s.cues).toEqual([])
    vi.advanceTimersByTime(15 * MIN)
    expect(s.cues).toEqual(['end'])
  })

  it('timer expirado ao abrir o app não toca alarme velho', () => {
    const s = setup(running(T0 - 40 * MIN))
    s.sound.arm()
    vi.advanceTimersByTime(60 * MIN)
    expect(s.cues).toEqual([])
  })
})
