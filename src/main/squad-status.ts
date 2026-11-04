import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SquadInfo } from '@shared/types'
import { writeJsonAtomic } from './fs-safe'

/** Paused squads start no new cycle until resumed; disabled ones stay off the floor's runnable list. */
export type SquadState = 'paused' | 'disabled'

/**
 * Pause and disable live in the app's data, never in squads/: the office does not write into a squad folder.
 * An unreadable file fails closed: every squad of that floor reads as disabled, and nothing can change it.
 */
export class SquadStatusStore {
  private readonly file: string
  private data: Record<string, Record<string, SquadState>> = {}
  private broken = false

  constructor(dir: string) {
    this.file = join(dir, 'squad-status.json')
    this.load()
  }

  private load(): void {
    if (!existsSync(this.file)) return
    try {
      const raw: unknown = JSON.parse(readFileSync(this.file, 'utf8'))
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('formato inesperado')
      for (const squads of Object.values(raw as Record<string, unknown>)) {
        if (!squads || typeof squads !== 'object') throw new Error('formato inesperado')
        for (const state of Object.values(squads)) if (state !== 'paused' && state !== 'disabled') throw new Error('estado desconhecido')
      }
      this.data = raw as Record<string, Record<string, SquadState>>
    } catch {
      this.broken = true
    }
  }

  /** The state of a squad of the floor at `cwd`; an unreadable file reads as disabled. */
  get(cwd: string, code: string): SquadState | undefined {
    if (this.broken) return 'disabled'
    return this.data[cwd]?.[code]
  }

  set(cwd: string, code: string, state: SquadState | null): void {
    if (this.broken) throw new Error('O estado dos squads não pôde ser lido; corrija ou apague squad-status.json e reabra o Agent Office.')
    const floor = { ...(this.data[cwd] ?? {}) }
    if (state) floor[code] = state
    else delete floor[code]
    const next = { ...this.data, [cwd]: floor }
    if (!Object.keys(floor).length) delete next[cwd]
    writeJsonAtomic(this.file, next)
    this.data = next
  }

  /** Marks the catalogue entries that are paused or disabled as unavailable, with the reason. */
  apply(cwd: string, squads: SquadInfo[]): SquadInfo[] {
    return squads.map((s) => {
      const state = this.get(cwd, s.code)
      if (!state) return s
      const unavailableReason = this.broken
        ? 'O estado dos squads não pôde ser lido; o squad fica fora até corrigir squad-status.json.'
        : state === 'paused'
          ? 'Pausado: retome o squad para ele voltar a rodar.'
          : 'Desativado: reative o squad para ele voltar a rodar.'
      return { ...s, availability: 'unavailable', unavailableReason }
    })
  }
}
