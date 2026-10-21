import { focusKey } from './planning'
import type { Task } from './tasks'

/** Toggles a visible task's line in the temporary, unsaved selection. */
export function toggleSelectedTask(lines: Set<number>, line: number): boolean {
  if (lines.has(line)) lines.delete(line)
  else lines.add(line)
  return lines.has(line)
}

/** Tasks to add after confirmation, in board order; existing focus entries are not duplicated. */
export function tasksToFocusSelection(tasks: readonly Task[], selectedLines: ReadonlySet<number>, focused: ReadonlySet<string>): Task[] {
  return tasks.filter((task) => selectedLines.has(task.line) && task.status === 'open' && (!task.id || !focused.has(focusKey(task.id))))
}
