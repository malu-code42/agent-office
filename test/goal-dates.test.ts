import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { achievedDates } from '../src/main/goal-dates'
import { parseGoals } from '../src/shared/goals'

describe('achievedDates', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'goal-dates-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('stamps the first day a goal is seen achieved, keeps it, and drops it when unticked', () => {
    const done = parseGoals('- [x] Meta A\n- [ ] Meta B\n').goals
    const id = done[0]!.id
    expect([...achievedDates(dir, done, new Date(2026, 9, 31)).entries()]).toEqual([[id, '2026-10-31']])
    expect(achievedDates(dir, done, new Date(2026, 10, 5)).get(id)).toBe('2026-10-31')
    expect(achievedDates(dir, parseGoals('- [ ] Meta A\n').goals, new Date(2026, 10, 6)).size).toBe(0)
  })
})
