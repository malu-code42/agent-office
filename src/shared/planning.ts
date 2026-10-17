import type { TaskList } from './tasks'

/**
 * The focus set ("Tarefas em foco") and what the popup shows of it. Focus is state, not a copy
 * of the task: the set holds task ids, and the title and list come from tarefas.md when read.
 */

/** The "Passo de hoje" of a focused task: one a day, saved with the day it is for. */
export interface Step {
  date: string
  text: string
}

/** Longest text of a "Passo de hoje", in characters. */
export const STEP_MAX = 200

/** A focused task: its title and list in tarefas.md; `missing` when its id is no longer there. `step` is today's step, when there is one. */
export type FocusItem = { id: string; missing: false; text: string; list: string; step?: string } | { id: string; missing: true }

/** Ids in planning.json are lowercase, as the reader stores them, so a comparison never misses on case. */
export const focusKey = (id: string): string => id.toLowerCase()

/** Each focused id in the order it was added, matched against the tasks that have an id. */
export function focusItems(lists: TaskList[], focus: readonly string[], todaySteps: ReadonlyMap<string, string> = new Map()): FocusItem[] {
  const tasks = new Map<string, { text: string; list: string }>()
  for (const list of lists) {
    for (const task of list.tasks) if (task.id) tasks.set(focusKey(task.id), { text: task.text, list: list.name })
  }
  return focus.map((id) => {
    const task = tasks.get(id)
    if (!task) return { id, missing: true }
    const step = todaySteps.get(id)
    return { id, missing: false, text: task.text, list: task.list, ...(step ? { step } : {}) }
  })
}
