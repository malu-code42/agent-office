import type { BarTimerView } from '@shared/barTimer'
import {
  addSegments,
  closeSpan,
  dayKeyOf,
  heartbeatSpan,
  markDone,
  parseFocusLog,
  recoverSpan,
  splitByDay,
  syncSpan,
  type FocusLog,
  type FocusRangeView,
  type FocusSegment,
} from '@shared/focusLog'
import { join } from 'node:path'
import { backupCopies, shapeOf } from './backups'
import { loadJson, reportLoad, writeJsonAtomic } from './fs-safe'

/**
 * focus-log.json em userData (AO-92): o tempo de Timer em andamento de cada tarefa, por dia, mais o trecho
 * que está correndo. Segue o cuidado dos outros arquivos de dados: entra nos backups diários, escrita
 * atômica, arquivo ausente começa vazio e arquivo corrompido é posto de lado por loadJson (nunca
 * sobrescrito). A conta em si é pura e está em shared/focusLog.ts.
 */
export class FocusLogStore {
  private readonly file: string
  private log: FocusLog

  constructor(
    dir: string,
    private readonly now: () => number = Date.now,
    private readonly onChange?: () => void,
  ) {
    this.file = join(dir, 'focus-log.json')
    const r = loadJson<unknown>(this.file, { valid: shapeOf('focus-log.json'), fallbacks: backupCopies(dir, 'focus-log.json') })
    reportLoad(this.file, r)
    this.log = parseFocusLog(r.status === 'ok' || r.status === 'restored' ? r.data : {})
    // Um trecho que ficou aberto com o app fechado vale só até a última vez em que foi visto correndo:
    // o resto do prazo não é foco confirmado.
    if (this.log.open) {
      const seg = recoverSpan(this.log.open)
      this.log = { days: seg ? addSegments(this.log.days, [seg]) : this.log.days }
      this.persist()
    }
  }

  /** Concilia o registro com o Timer; chamar a cada mudança gravada do Timer e uma vez ao abrir o app. */
  sync(view: BarTimerView | null | undefined): void {
    const before = this.log
    const { open, closed } = syncSpan(this.log.open, view, this.now())
    this.log = { days: closed.length ? addSegments(this.log.days, closed) : this.log.days, ...(open ? { open } : {}) }
    if (this.log.open === before.open && this.log.days === before.days) return
    this.save()
  }

  /** Avisa que o timer segue correndo, para um fechamento do app não perder o que já rodou. */
  heartbeat(): void {
    if (!this.log.open) return
    this.log = { ...this.log, open: heartbeatSpan(this.log.open, this.now()) }
    this.persist()
  }

  /** A tarefa foi concluída: o último segmento dela leva a marca. */
  markDone(taskId: string): void {
    // Se o trecho que corre agora é desta tarefa, ele fecha e entra no arquivo antes, para a marca cair nele.
    const open = this.log.open
    const closing = open && open.taskId === taskId
    const live = closing ? closeSpan(open, this.now()) : undefined
    const days = live ? addSegments(this.log.days, [live]) : this.log.days
    const next = markDone(days, taskId)
    const keepOpen = open && !closing ? { open } : {}
    if (next === this.log.days && !closing) return
    this.log = { days: next, ...keepOpen }
    this.save()
  }

  /** Só leitura: os segmentos dos dias pedidos (AAAA-MM-DD), com o trecho em andamento até agora. */
  range(keys: string[]): FocusRangeView {
    const now = this.now()
    const out: Record<string, FocusSegment[]> = {}
    for (const k of keys) if (this.log.days[k]) out[k] = this.log.days[k]
    const live = this.log.open ? closeSpan(this.log.open, now) : undefined
    if (live && this.log.open) {
      const running = now < this.log.open.endsAt
      for (const { day, seg } of splitByDay(live)) {
        if (!keys.includes(day)) continue
        out[day] = [...(out[day] ?? []), running ? { ...seg, running: true as const } : seg]
      }
    }
    return { days: out, now }
  }

  today(): string {
    return dayKeyOf(this.now())
  }

  private persist(): void {
    writeJsonAtomic(this.file, this.log, { space: 2, newline: true })
  }

  private save(): void {
    this.persist()
    this.onChange?.()
  }
}
