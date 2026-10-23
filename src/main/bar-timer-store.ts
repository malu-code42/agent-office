import type { BarMode, BarTimer, BarTimerView } from '@shared/barTimer'
import { BAR_MODES, barPause, barResume, barSettle, barStart, barView, parseBarTimer, type TimerFile } from '@shared/barTimer'
import { join } from 'node:path'
import { backupCopies, shapeOf } from './backups'
import { loadJson, reportLoad, writeJsonAtomic } from './fs-safe'

/**
 * timer.json in userData: the session of the bar Timer — the only one, and only the user's,
 * of no task. Persistence follows the same care as planning.json: a file in the daily backups,
 * written atomically; an unreadable file does not get written over. A session running survives
 * a restart by the absolute deadline (`endsAt`): if it passed while the app was closed, the
 * session reads as interrupted, with the time unconfirmed. Nowhere does a state finish a task.
 */

export class BarTimerStore {
  private file: string
  private session: BarTimer | undefined
  private readonly now: () => number

  /**
   * `now` is the clock: the app uses the system's, tests pass one they control.
   * `onChange` is called after every written change, with nothing: the view is what is read.
   */
  constructor(dir: string, now: () => number = Date.now, private onChange?: () => void) {
    this.now = now
    this.file = join(dir, 'timer.json')
    const r = loadJson<Partial<TimerFile>>(this.file, { valid: shapeOf('timer.json'), fallbacks: backupCopies(dir, 'timer.json') })
    reportLoad(this.file, r)
    const raw: Partial<TimerFile> = r.status === 'ok' || r.status === 'restored' ? r.data : {}
    const loaded = parseBarTimer(raw.timer)
    if (!loaded) return
    // A session whose deadline passed while the app was closed is interrupted, never completed.
    const settled = barSettle(loaded, this.now())
    this.session = settled
    if (settled !== loaded) this.save()
  }

  /** The session as it reads, in the views the bar and the popup show. */
  view(): BarTimerView | undefined {
    return barView(this.session, this.now())
  }

  /** Starts an interval (25, 5 or 15); `task` is the optional label of a focused task. */
  start(mode: number, task: { id?: string; text?: string } | undefined): BarTimerView {
    const interval = mode as BarMode
    if (!(BAR_MODES as readonly number[]).includes(interval)) throw new Error('Escolha Foco · 25, Pausa curta · 5 ou Pausa longa · 15.')
    if (this.session) throw new Error('Há um intervalo em andamento ou por zerar. Zere o Timer antes de começar outro.')
    this.session = barStart(interval, task, this.now())
    this.save()
    return this.view()!
  }

  pause(): BarTimerView {
    if (!this.session || this.session.state !== 'em andamento') throw new Error('Só um Timer em andamento pode ser pausado.')
    this.session = barPause(this.session, this.now())
    this.save()
    return this.view()!
  }

  /** Resumes: the deadline restarts from what was left, as if the pause never happened. */
  resume(): BarTimerView {
    if (!this.session || this.session.state !== 'pausada') throw new Error('Só um Timer pausado pode ser retomado.')
    this.session = barResume(this.session, this.now())
    this.save()
    return this.view()!
  }

  /** Zera: nada é mantido, nem o rótulo da tarefa. */
  reset(): undefined {
    if (!this.session) return
    this.session = undefined
    this.save()
  }

  /** Changes the optional task label; with no task, it clears the link. A stopped Timer keeps nothing here. */
  setTask(task: { id?: string; text?: string } | undefined): BarTimerView | undefined {
    if (!this.session) return undefined
    const has = typeof task?.id === 'string' && typeof task?.text === 'string'
    if (has) this.session = { ...this.session, taskId: task!.id as string, taskText: task!.text as string }
    else {
      const { taskId: _out, taskText: _out2, ...rest } = this.session
      this.session = rest
    }
    this.save()
    return this.view()
  }

  private save(): void {
    writeJsonAtomic(this.file, { timer: this.session } satisfies TimerFile, { space: 2, newline: true })
    this.onChange?.()
  }
}
