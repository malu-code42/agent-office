import { join } from 'node:path'
import { emptyStudyCycleState, type StudyCycleState } from '@shared/study-cycle'
import { loadJson, reportLoad, writeJsonAtomic } from './fs-safe'
import { backupCopies } from './backups'
import { isStudyCycleState, normalizeStudyCycleState, studyCycleStateSchema } from './study-cycle-schema'

export const STUDY_CYCLE_FILE = 'study-cycle.json'

/** A separate, validated userData file; never shares planning, tickets, or agent persistence. */
export class StudyCycleStore {
  private readonly file: string

  constructor(private readonly dataDir: string) {
    this.file = join(dataDir, STUDY_CYCLE_FILE)
  }

  read(): StudyCycleState {
    const result = loadJson<StudyCycleState>(this.file, {
      valid: isStudyCycleState,
      fallbacks: backupCopies(this.dataDir, STUDY_CYCLE_FILE),
    })
    reportLoad(this.file, result)
    return result.status === 'ok' || result.status === 'restored' ? normalizeStudyCycleState(result.data) : emptyStudyCycleState()
  }

  write(state: StudyCycleState): void {
    const parsed = studyCycleStateSchema.safeParse(state)
    if (!parsed.success) throw new Error('O ciclo de estudos está num formato inválido.')
    writeJsonAtomic(this.file, parsed.data, { mode: 0o600 })
  }
}
