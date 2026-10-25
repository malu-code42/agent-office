import type { PersonalRoutineOverview } from '@shared/routine-personal'

/** Narrow read-only boundary used when opening the personal-routines panel. */
export interface PersonalRoutineOverviewReader {
  personalRoutineOverview(): Promise<PersonalRoutineOverview>
}

/** Loading the panel reads only its own overview and cannot touch daily-review IPC or drafts. */
export function loadPersonalRoutineOverview(reader: PersonalRoutineOverviewReader): Promise<PersonalRoutineOverview> {
  return reader.personalRoutineOverview()
}
