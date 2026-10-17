import { join } from 'node:path'
import { focusKey } from '@shared/planning'
import { backupCopies, shapeOf } from './backups'
import { loadJson, reportLoad, writeJsonAtomic } from './fs-safe'

/**
 * planning.json in userData: the focus set ("Tarefas em foco"), a list of task ids. Nothing
 * here clears it by itself: it carries over from day to day until the user takes a task out.
 * Other fields of the file (passo de hoje, timer, review) come with their own tickets.
 */

interface Planning {
  focus: string[]
}

export class PlanningStore {
  private file: string
  private focusIds: string[]

  constructor(dir: string) {
    this.file = join(dir, 'planning.json')
    const r = loadJson<Partial<Planning>>(this.file, { valid: shapeOf('planning.json'), fallbacks: backupCopies(dir, 'planning.json') })
    reportLoad(this.file, r)
    const raw: Partial<Planning> = r.status === 'ok' || r.status === 'restored' ? r.data : {}
    this.focusIds = [...new Set((raw.focus ?? []).map(focusKey))]
  }

  focus(): string[] {
    return [...this.focusIds]
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
    writeJsonAtomic(this.file, { focus: this.focusIds } satisfies Planning, { space: 2, newline: true })
  }
}
