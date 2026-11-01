import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isoDay } from '@shared/agenda'
import type { Goal } from '@shared/goals'

const FILE = 'goals-achieved.json'

/**
 * The day each achieved goal was first seen as achieved, kept beside the app data (never in the vault file).
 * A goal ticked in Obsidian gets today's date on the first read; one that is unticked loses it.
 * shortcut: the date is the day the app noticed, not the day of the click; upgrade when the writer stamps it.
 */
export function achievedDates(dataDirectory: string, goals: readonly Goal[], now: Date): Map<string, string> {
  const path = join(dataDirectory, FILE)
  let stored: Record<string, string> = {}
  try {
    if (existsSync(path)) stored = JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>
  } catch {
    stored = {}
  }
  const next: Record<string, string> = {}
  for (const goal of goals) if (goal.achieved) next[goal.id] = stored[goal.id] ?? isoDay(now)
  if (JSON.stringify(next) !== JSON.stringify(stored)) writeFileSync(path, JSON.stringify(next, null, 2))
  return new Map(Object.entries(next))
}
