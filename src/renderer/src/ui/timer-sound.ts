/**
 * Sons do Timer da barra (AO-91), sintetizados com Web Audio: sem arquivos de áudio, sem licença.
 * Quem decide quando tocar é o processo principal (ver bar-timer-sound.ts); aqui só se toca o aviso
 * recebido. Tudo é agendado no relógio do próprio áudio (`start(t + offset)`), nunca com setTimeout,
 * porque os timers de uma janela minimizada são estrangulados e o relógio de áudio não é.
 */
import type { BarSoundCue } from '@shared/barTimerSound'

/** Volume de pico: moderado, para não assustar. */
const VOLUME = 0.12

let ctx: AudioContext | null = null

/** Uma nota curta com ataque/decaimento suaves, começando `at` segundos depois de agora. */
function beep(c: AudioContext, freq: number, at: number, dur: number, type: OscillatorType = 'sine'): void {
  const t = c.currentTime + at
  const osc = c.createOscillator()
  const gain = c.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t)
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.exponentialRampToValueAtTime(VOLUME, t + 0.015)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  osc.connect(gain).connect(c.destination)
  osc.start(t)
  osc.stop(t + dur + 0.02)
}

/** Início: dois toques curtos, subindo. Fim: três pares de notas, mais longo e inconfundível. */
function play(c: AudioContext, cue: BarSoundCue): void {
  if (cue === 'start') {
    beep(c, 660, 0, 0.12)
    beep(c, 880, 0.13, 0.18)
    return
  }
  for (let i = 0; i < 3; i++) {
    const base = i * 0.9
    beep(c, 880, base, 0.22, 'triangle')
    beep(c, 1175, base + 0.28, 0.22, 'triangle')
    beep(c, 880, base + 0.56, 0.22, 'triangle')
  }
}

/** Toca o aviso; silencioso se o áudio não estiver disponível. */
export function playBarTimerSound(cue: BarSoundCue): void {
  try {
    ctx ??= new AudioContext()
    const c = ctx
    // Após um gesto (ou com autoplayPolicy liberada na janela) o contexto pode ter ficado suspenso.
    if (c.state === 'suspended') {
      void c
        .resume()
        .then(() => play(c, cue))
        .catch(() => undefined)
      return
    }
    play(c, cue)
  } catch {
    // sem áudio (contexto indisponível): fica em silêncio
  }
}

/** Libera o contexto no primeiro gesto da usuária, para o alarme poder tocar depois sem gesto. */
export function unlockBarTimerSound(): void {
  const unlock = (): void => {
    try {
      ctx ??= new AudioContext()
      if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined)
    } catch {
      // sem áudio: nada a liberar
    }
  }
  window.addEventListener('pointerdown', unlock, { once: true, capture: true })
  window.addEventListener('keydown', unlock, { once: true, capture: true })
}
