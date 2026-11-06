import type { BarTimerView } from '@shared/barTimer'
import { barEndKey, barEndSoundDue, barStartSoundDue, type BarSoundCue } from '@shared/barTimerSound'

/**
 * O som do Timer da barra (AO-91), decidido no processo principal. Aqui, e não no renderer, porque
 * o renderer de uma janela minimizada tem os timers (setInterval/setTimeout) estrangulados e o
 * fim do intervalo só era notado pelo popup aberto. O setTimeout do processo principal não sofre
 * isso: no prazo ele manda o aviso por IPC e o renderer só toca o que recebeu.
 */
export class BarTimerSound {
  private prev: BarTimerView | null
  private timer: ReturnType<typeof setTimeout> | undefined
  private playedEnd: string | undefined

  constructor(
    private readonly view: () => BarTimerView | null,
    private readonly now: () => number,
    private readonly emit: (cue: BarSoundCue) => void,
  ) {
    this.prev = view()
  }

  /** Agenda o fim do que já está em andamento ao abrir o app (sem tocar o início). */
  arm(): void {
    this.schedule(this.view())
  }

  /** Chamar a cada mudança gravada do Timer. */
  onChange(): void {
    const next = this.view()
    if (barStartSoundDue(this.prev, next)) this.emit('start')
    this.prev = next
    this.schedule(next)
  }

  private schedule(v: BarTimerView | null): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    if (!v || v.state !== 'em andamento' || v.endsAt === undefined) return
    this.timer = setTimeout(
      () => {
        this.timer = undefined
        // Relê o estado de agora: se pausou ou zerou no meio do caminho, nada toca.
        const cur = this.view()
        if (!barEndSoundDue(cur, this.now(), this.playedEnd)) return
        this.playedEnd = cur ? barEndKey(cur) : undefined
        this.emit('end')
      },
      Math.max(0, v.endsAt - this.now()),
    )
  }

  dispose(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
  }
}
