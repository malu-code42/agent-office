import { randomInt } from 'node:crypto'
import { join } from 'node:path'
import { loadJson, reportLoad, writeJsonAtomic } from './fs-safe'

export interface PersonalRoutineOccurrence {
  id: string
  routineId: string
  day: string
  taskId?: string
  taskFingerprint?: string
  /** reserved survives a crash before task creation; linked means the task was confirmed in tarefas.md. */
  taskLinkState?: 'reserved' | 'linked'
  /** IDs whose task association was explicitly released; prevents reuse and permits safe later reopen. */
  retiredTaskIds?: string[]
  status: 'pending' | 'completed'
  completedAt?: string
}

interface PersonalRoutineData {
  distributions: Record<string, number[]>
  occurrences: Record<string, PersonalRoutineOccurrence>
}

const empty = (): PersonalRoutineData => ({ distributions: {}, occurrences: {} })
const dayPattern = /^\d{4}-\d{2}-\d{2}$/
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

export function isPersonalRoutineData(v: unknown): v is PersonalRoutineData {
  if (!isObj(v) || !isObj(v.distributions) || !isObj(v.occurrences)) return false
  if (
    !Object.values(v.distributions).every(
      (days) => Array.isArray(days) && days.every((d) => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6),
    )
  )
    return false
  const referencedTaskIds = new Set<string>()
  for (const [key, value] of Object.entries(v.occurrences)) {
    if (!isObj(value)) return false
    if (
      typeof value.id !== 'string' ||
      value.id !== key ||
      typeof value.routineId !== 'string' ||
      !dayPattern.test(String(value.day)) ||
      (value.taskId !== undefined && !/^t[a-z0-9]{6}$/i.test(String(value.taskId))) ||
      (value.taskFingerprint !== undefined && !/^[a-f0-9]{64}$/.test(String(value.taskFingerprint))) ||
      (value.taskLinkState !== undefined && value.taskLinkState !== 'reserved' && value.taskLinkState !== 'linked') ||
      (value.retiredTaskIds !== undefined &&
        (!Array.isArray(value.retiredTaskIds) ||
          !value.retiredTaskIds.every((id) => typeof id === 'string' && /^t[a-z0-9]{6}$/i.test(id)))) ||
      (value.status !== 'pending' && value.status !== 'completed') ||
      (value.completedAt !== undefined && !dayPattern.test(String(value.completedAt)))
    )
      return false

    for (const taskId of [value.taskId, ...(value.retiredTaskIds ?? [])]) {
      if (typeof taskId !== 'string') continue
      const canonical = taskId.toLowerCase()
      if (referencedTaskIds.has(canonical)) return false
      referencedTaskIds.add(canonical)
    }
  }
  return true
}

/** Personal occurrence state only: opaque IDs and dates, never user-authored routine text. */
export class PersonalRoutineStore {
  private data: PersonalRoutineData
  private readonly file: string

  constructor(
    dataDir: string,
    private readonly newTaskId: () => string = () => {
      const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
      return `t${Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join('')}`
    },
  ) {
    this.file = join(dataDir, 'personal-routines.json')
    const loaded = loadJson<PersonalRoutineData>(this.file, { valid: isPersonalRoutineData })
    reportLoad(this.file, loaded)
    this.data = loaded.status === 'ok' || loaded.status === 'restored' ? loaded.data : empty()
  }

  distribution(key: string): number[] | undefined {
    return this.data.distributions[key] ? [...this.data.distributions[key]!] : undefined
  }

  confirmDistribution(key: string, days: number[]): void {
    if (!days.length || days.length > 7 || days.some((d) => !Number.isInteger(d) || d < 0 || d > 6) || new Set(days).size !== days.length)
      throw new Error('Escolha dias válidos para distribuir a meta semanal.')
    this.data.distributions[key] = [...days].sort((a, b) => a - b)
    this.save()
  }

  occurrence(id: string): PersonalRoutineOccurrence | undefined {
    const found = this.data.occurrences[id]
    return found ? { ...found } : undefined
  }

  hasTaskLink(taskId: string): boolean {
    const canonical = taskId.toLowerCase()
    return Object.values(this.data.occurrences).some((row) => row.taskId?.toLowerCase() === canonical)
  }

  matchesTaskFingerprint(taskId: string, fingerprint: string): boolean {
    const references = this.taskReferences(taskId)
    return references.active.length === 1 && references.retired.length === 0 && references.active[0]!.taskFingerprint === fingerprint
  }

  ensureOccurrence(id: string, routineId: string, day: string): PersonalRoutineOccurrence {
    const found = this.data.occurrences[id]
    if (found) return { ...found }
    const occurrence: PersonalRoutineOccurrence = { id, routineId, day, status: 'pending' }
    this.data.occurrences[id] = occurrence
    this.save()
    return { ...occurrence }
  }

  /** Reserve the occurrence's task id before writing tarefas.md; retries after a crash reuse it. */
  reserve(
    id: string,
    routineId: string,
    day: string,
    takenTaskIds: ReadonlySet<string> = new Set(),
    taskFingerprint?: string,
  ): PersonalRoutineOccurrence {
    const found = this.data.occurrences[id]
    if (found?.taskId) {
      // Only an unmaterialized reservation can safely adopt an edited draft.
      if (
        found.taskLinkState === 'reserved' &&
        !takenTaskIds.has(found.taskId.toLowerCase()) &&
        taskFingerprint &&
        found.taskFingerprint !== taskFingerprint
      ) {
        found.taskFingerprint = taskFingerprint
        this.save()
      }
      return { ...found }
    }
    const taskIdsInUse = new Set(takenTaskIds)
    for (const occurrence of Object.values(this.data.occurrences)) {
      if (occurrence.taskId) taskIdsInUse.add(occurrence.taskId.toLowerCase())
      for (const retiredId of occurrence.retiredTaskIds ?? []) taskIdsInUse.add(retiredId.toLowerCase())
    }
    let taskId = ''
    for (let attempt = 0; attempt < 100; attempt++) {
      const candidate = this.newTaskId()
      if (/^t[a-z0-9]{6}$/i.test(candidate) && !taskIdsInUse.has(candidate.toLowerCase())) {
        taskId = candidate.toLowerCase()
        break
      }
    }
    if (!taskId) throw new Error('Não consegui reservar um identificador único para a ocorrência.')
    const occurrence: PersonalRoutineOccurrence = found ?? { id, routineId, day, status: 'pending' }
    occurrence.taskId = taskId
    occurrence.taskLinkState = 'reserved'
    if (taskFingerprint) occurrence.taskFingerprint = taskFingerprint
    this.data.occurrences[id] = occurrence
    this.save()
    return { ...occurrence }
  }

  setTask(id: string, taskId: string, taskFingerprint?: string): void {
    const row = this.require(id)
    if (!/^t[a-z0-9]{6}$/i.test(taskId)) throw new Error('O identificador de tarefa desta ocorrência é inválido.')
    const canonical = taskId.toLowerCase()
    if (row.taskId && row.taskId.toLowerCase() !== canonical)
      throw new Error('Esta ocorrência já está associada a outra tarefa; não vou substituir o vínculo válido.')
    if (row.retiredTaskIds?.some((retired) => retired.toLowerCase() === canonical))
      throw new Error('Este identificador já foi retirado desta ocorrência; reserve uma tarefa nova.')
    for (const [otherId, other] of Object.entries(this.data.occurrences)) {
      if (otherId === id) continue
      if (other.taskId?.toLowerCase() === canonical || other.retiredTaskIds?.some((retired) => retired.toLowerCase() === canonical))
        throw new Error('Este identificador de tarefa já pertence a outra ocorrência.')
    }
    if (taskFingerprint && row.taskFingerprint && row.taskFingerprint !== taskFingerprint)
      throw new Error('A tarefa não corresponde ao rascunho reservado para esta ocorrência.')
    row.taskId = canonical
    row.taskLinkState = 'linked'
    if (taskFingerprint) row.taskFingerprint = taskFingerprint
    row.status = 'pending'
    delete row.completedAt
    this.save()
  }

  completeTask(taskId: string, day: string): void {
    const references = this.taskReferences(taskId)
    this.assertUnambiguousTaskReferences(taskId, references)
    const row = references.active[0]
    if (!row) return
    row.status = 'completed'
    row.completedAt = day
    this.save()
  }

  reopenTask(taskId: string): void {
    const references = this.taskReferences(taskId)
    this.assertUnambiguousTaskReferences(taskId, references)
    const row = references.active[0] ?? references.retired[0]
    if (!row) return
    if (references.retired.length) {
      row.taskId = taskId.toLowerCase()
      row.taskLinkState = 'linked'
      row.retiredTaskIds = row.retiredTaskIds?.filter((id) => id.toLowerCase() !== taskId.toLowerCase())
    }
    row.status = 'pending'
    delete row.completedAt
    this.save()
  }

  discardTask(taskId: string): void {
    const references = this.taskReferences(taskId)
    this.assertUnambiguousTaskReferences(taskId, references)
    const row = references.active[0]
    if (!row) return
    row.status = 'pending'
    row.retiredTaskIds = [...new Set([...(row.retiredTaskIds ?? []), row.taskId!.toLowerCase()])]
    delete row.taskId
    delete row.taskLinkState
    delete row.completedAt
    this.save()
  }

  /** A task link that no longer exists is released, but the occurrence and its scheduled date remain. */
  recoverMissingTask(taskId: string): void {
    const references = this.taskReferences(taskId)
    this.assertUnambiguousTaskReferences(taskId, references)
    const row = references.active[0]
    if (!row) return
    row.status = 'pending'
    row.retiredTaskIds = [...new Set([...(row.retiredTaskIds ?? []), row.taskId!.toLowerCase()])]
    delete row.taskId
    delete row.taskLinkState
    this.save()
  }

  count(routineId: string, start: string, end: string): number {
    return Object.values(this.data.occurrences).filter(
      (row) => row.routineId === routineId && row.day >= start && row.day <= end && row.status === 'completed',
    ).length
  }

  list(): PersonalRoutineOccurrence[] {
    return Object.values(this.data.occurrences).map((row) => ({ ...row }))
  }

  private require(id: string): PersonalRoutineOccurrence {
    const row = this.data.occurrences[id]
    if (!row) throw new Error('Essa ocorrência da rotina não existe mais.')
    return row
  }

  private taskReferences(taskId: string): { active: PersonalRoutineOccurrence[]; retired: PersonalRoutineOccurrence[] } {
    const canonical = taskId.toLowerCase()
    const active: PersonalRoutineOccurrence[] = []
    const retired: PersonalRoutineOccurrence[] = []
    for (const row of Object.values(this.data.occurrences)) {
      if (row.taskId?.toLowerCase() === canonical) active.push(row)
      if (row.retiredTaskIds?.some((id) => id.toLowerCase() === canonical)) retired.push(row)
    }
    return { active, retired }
  }

  private assertUnambiguousTaskReferences(
    taskId: string,
    references: { active: PersonalRoutineOccurrence[]; retired: PersonalRoutineOccurrence[] },
  ): void {
    if (references.active.length + references.retired.length > 1)
      throw new Error(`O identificador ${taskId} aparece em mais de uma ocorrência; o estado de rotina não foi alterado.`)
  }

  private save(): void {
    writeJsonAtomic(this.file, this.data, { space: 2, newline: true })
  }
}
