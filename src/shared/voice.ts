// Modo voz: o botão no canto inferior esquerdo grava e o transcritor local (faster-whisper) devolve o texto.

/** O que o botão de voz ouviu. */
export interface Dictation {
  text: string
  /** Idioma que o transcritor detectou ("pt"). */
  lang?: string
  /** Conversão mais transcrição, em ms. */
  ms: number
}

/** Uma gravação para sozinha neste tamanho. */
export const VOICE_MAX_SECONDS = 120
/** O processo principal recusa o que passar disso; dois minutos de opus ficam abaixo de 2 MB. */
export const VOICE_MAX_BYTES = 16 * 1024 * 1024
/** Depois que o jogador falou, este tanto de silêncio encerra uma gravação iniciada por clique. */
export const SILENCE_STOP_MS = 3000
/** Nada dito por este tempo depois do clique: para sem incomodar o transcritor. */
export const NO_SPEECH_MS = 10_000
/** Os primeiros instantes são o clique e o ganho se ajustando, não fala. */
export const SETTLE_MS = 300

/**
 * Se uma gravação iniciada por clique deve parar sozinha: `heardAt` é a última vez que o
 * microfone passou do nível de fala (0 = ainda não), tudo em ms.
 */
export function autoStop(now: number, startedAt: number, heardAt: number): 'silence' | 'nospeech' | null {
  if (heardAt) return now - heardAt >= SILENCE_STOP_MS ? 'silence' : null
  return now - startedAt >= NO_SPEECH_MS ? 'nospeech' : null
}

/**
 * Limites (em bins da FFT) de `bands` faixas espaçadas em escala log entre `lowHz` e `highHz`:
 * cada barra da onda segue uma fatia da voz. Toda faixa tem ao menos um bin.
 */
export function bandEdges(sampleRate: number, fftSize: number, bands: number, lowHz = 90, highHz = 3200): number[] {
  const hz = sampleRate / fftSize
  const edges: number[] = []
  for (let k = 0; k <= bands; k++) {
    const bin = Math.round((lowHz * (highHz / lowHz) ** (k / bands)) / hz)
    edges.push(k ? Math.max(bin, edges[k - 1] + 1) : bin)
  }
  return edges
}
