import { createHash } from 'node:crypto'
import type { NewTaskDraft } from '@shared/tasks'
import { parseTasksFile, type Task } from '@shared/tasks'

/** Hash only normalized task fields; routine/task text is never written to personal-routines.json. */
export function personalRoutineTaskFingerprint(task: Pick<NewTaskDraft, 'title' | 'list' | 'date' | 'time'>): string {
  const canonical = [task.title, task.list, task.date ?? '', task.time ?? ''].map((value) => value.trim().normalize('NFC'))
  return createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex')
}

export function personalRoutineTaskFingerprintFromTask(task: Pick<Task, 'text' | 'date' | 'time'>, list: string): string {
  return personalRoutineTaskFingerprint({ title: task.text, list, date: task.date, time: task.time })
}

/** Parse the archived pre-completion/discard line to recover the exact task fields used for its fingerprint. */
export function personalRoutineTaskFingerprintFromLine(originalLine: string, list: string): string | undefined {
  const task = parseTasksFile(`## ${list}\n${originalLine}\n`).lists[0]?.tasks[0]
  return task ? personalRoutineTaskFingerprintFromTask(task, list) : undefined
}
