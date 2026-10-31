// Tiny synthesized sound effects of the skull strike.

let audio: AudioContext | null = null

function tone(type: OscillatorType, from: number, to: number, dur: number, vol: number): void {
  try {
    audio ??= new AudioContext()
    const t = audio.currentTime
    const osc = audio.createOscillator()
    const gain = audio.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(from, t)
    osc.frequency.exponentialRampToValueAtTime(to, t + dur)
    gain.gain.setValueAtTime(vol, t)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    osc.connect(gain).connect(audio.destination)
    osc.start(t)
    osc.stop(t + dur)
  } catch {
    // audio unavailable: play silently
  }
}

export const sfx = {
  whoosh: () => tone('sine', 180, 720, 0.6, 0.03),
  /** "Ha-ha-ha", falling. */
  cackle: () => {
    for (let i = 0; i < 3; i++) setTimeout(() => tone('square', 560 - i * 70, 380 - i * 60, 0.09, 0.03), i * 130)
  },
  ko: () => {
    tone('triangle', 620, 70, 0.55, 0.07)
    setTimeout(() => tone('sine', 300, 900, 0.5, 0.03), 500)
  },
}
