import { join } from 'node:path'
import { focusKey, type Step } from '@shared/planning'
import { backupCopies, shapeOf } from './backups'
import { loadJson, reportLoad, writeJsonAtomic } from './fs-safe'

/**
 * planning.json in userData: the focus set ("Tarefas em foco"), a list of task ids, and the
 * "Passo de hoje" of each task (one per task: the last one saved, with its day). Nothing
 * here clears the focus by itself: it carries over from day to day until the user takes a
 * task out. A step of another day stays in the file as history. Other fields of the file
 * (timer, review) come with their own tickets.
 */

interface Planning {
  focus: string[]
  steps: Record<string, Step>
}

const isStep = (v: unknown): v is Step =>
  !!v && typeof v === 'object' && typeof (v as Step).date === 'string' && typeof (v as Step).text === 'string'

export class PlanningStore {
  private file: string
  private focusIds: string[]
  private steps: Map<string, Step>

  constructor(dir: string) {
    this.file = join(dir, 'planning.json')
    const r = loadJson<Partial<Planning>>(this.file, { valid: shapeOf('planning.json'), fallbacks: backupCopies(dir, 'planning.json') })
    reportLoad(this.file, r)
    const raw: Partial<Planning> = r.status === 'ok' || r.status === 'restored' ? r.data : {}
    this.focusIds = [...new Set((raw.focus ?? []).map(focusKey))]
    this.steps = new Map(
      Object.entries(raw.steps ?? {})
        .filter(([, s]) => isStep(s))
        .map(([id, s]) => [focusKey(id), s]),
    )
  }

  focus(): string[] {
    return [...this.focusIds]
  }

  /** Today's step text of each task, by id. A step of another day is not here. */
  todaySteps(today: string): Map<string, string> {
    const out = new Map<string, string>()
    for (const [id, s] of this.steps) if (s.date === today) out.set(id, s.text)
    return out
  }

  /** Saves today's step of a focused task, in place of the one it had. Only planning.json changes. */
  saveStep(id: string, text: string, today: string): void {
    const key = this.focusedKey(id)
    this.steps.set(key, { date: today, text })
    this.save()
  }

  /** Removes today's step of a focused task. A step of another day is history and stays. */
  clearStep(id: string, today: string): void {
    const key = this.focusedKey(id)
    if (this.steps.get(key)?.date !== today) return
    this.steps.delete(key)
    this.save()
  }

  private focusedKey(id: string): string {
    const key = focusKey(id)
    if (!this.focusIds.includes(key)) throw new Error('Só tarefas em foco podem ter passo de hoje.')
    return key
  }

  add(id: string): void {
    const key = focusKey(id)
    if (this.focusIds.includes(key)) return
    this.focusIds.push(key)
    this.save()
  }

  remove(id: string): void {
    const key = focusKey(id)
    if (!this.focusIds.includes(key)) return
    this.focusIds = this.focusIds.filter((f) => f !== key)
    this.save()
  }

  private save(): void {
    writeJsonAtomic(this.file, { focus: this.focusIds, steps: Object.fromEntries(this.steps) } satisfies Planning, {
      space: 2,
      newline: true,
    })
  }
}
