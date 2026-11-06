import type { BarTimerView } from './barTimer'

/**
 * Quando o Timer da barra faz som (AO-91). Funções puras, sem relógio nem áudio: o processo
 * principal decide e manda o aviso; o renderer só sintetiza. Pausar, retomar, zerar e um prazo
 * velho nunca geram o alarme de fim.
 */

/** Os dois avisos sonoros: curto ao iniciar, alarme ao zerar. */
export type BarSoundCue = 'start' | 'end'

/**
 * Prazo vencido há mais que isto não toca: o alarme de um intervalo que acabou enquanto o
 * computador dormia ou o app estava fechado seria ruído velho, não aviso.
 */
export const END_GRACE_MS = 60_000

/** Início: o Timer saiu de parado (ou zerado) para em andamento. Retomar de uma pausa fica em silêncio. */
export function barStartSoundDue(prev: BarTimerView | null, next: BarTimerView | null): boolean {
  if (!next || next.state !== 'em andamento') return false
  return !prev || prev.state === 'parada' || prev.state === 'interrompida'
}

/** Identifica um fim específico (modo + prazo absoluto); outro intervalo ou outra retomada tem outra chave. */
export function barEndKey(v: BarTimerView): string | undefined {
  return v.state === 'em andamento' && v.endsAt !== undefined ? `${v.mode}@${v.endsAt}` : undefined
}

/**
 * Fim: só um Timer em andamento cujo prazo chegou (e não está velho demais) toca, e só uma vez
 * por `barEndKey`. Pausado, interrompido ou zerado não tocam.
 */
export function barEndSoundDue(v: BarTimerView | null, now: number, alreadyPlayedKey: string | undefined): boolean {
  if (!v || v.state !== 'em andamento' || v.endsAt === undefined) return false
  if (now < v.endsAt || now - v.endsAt > END_GRACE_MS) return false
  return barEndKey(v) !== alreadyPlayedKey
}
