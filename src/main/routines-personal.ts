import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { routineCandidates, type RoutineCandidate } from '@shared/routine-personal'

/**
 * Personal routines (AO-42), the part that touches the vault: read rotinas-pessoais.md and turn it into
 * the candidates of the day. This is read-only on purpose: the file belongs to the user's notes, and no
 * write of the app ever lands in it. A missing file means no candidates and no error — without a note of
 * personal routines there is simply nothing to raise in the daily review.
 */

export const PERSONAL_ROUTINES_FILE = 'rotinas-pessoais.md'

/** The exact text of the file, or null when the vault has no rotinas-pessoais.md. */
export function readPersonalRoutines(vault: string): string | null {
  try {
    return readFileSync(join(vault, PERSONAL_ROUTINES_FILE), 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

/** The candidates the Luna raises today, from the file. Missing file: no candidates, not an error. */
export function personalRoutineCandidates(vault: string, today: string): RoutineCandidate[] {
  const text = readPersonalRoutines(vault)
  if (text === null) return []
  return routineCandidates(text, today)
}
