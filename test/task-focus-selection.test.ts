import { describe, expect, it } from 'vitest'
import { tasksToFocusSelection, toggleSelectedTask } from '../src/shared/task-focus-selection'
import type { Task } from '../src/shared/tasks'

const task = (line: number, id?: string, status: Task['status'] = 'open'): Task => ({
  line,
  text: `Task ${line}`,
  status,
  ...(id ? { id } : {}),
}) as Task

describe('temporary task focus selection', () => {
  it('selects and deselects a task line', () => {
    const selected = new Set<number>()
    expect(toggleSelectedTask(selected, 4)).toBe(true)
    expect(selected.has(4)).toBe(true)
    expect(toggleSelectedTask(selected, 4)).toBe(false)
    expect(selected.size).toBe(0)
  })

  it('returns only selected open tasks that are not already focused, preserving board order', () => {
    const tasks = [task(8, 'id-8'), task(2, 'id-2'), task(6, 'id-6', 'completed'), task(4)]
    const selected = new Set([2, 4, 6, 8])
    const focused = new Set(['id-8'])
    expect(tasksToFocusSelection(tasks, selected, focused).map((item) => item.line)).toEqual([2, 4])
  })
})
