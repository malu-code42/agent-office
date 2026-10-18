/**
 * Where the lists of the Tarefas board were scrolled, kept across a redraw (openTasksBoard).
 * No DOM here, so it can be tested on its own.
 */

/**
 * The scrollTop each list of the new board gets: a list that was in `prev` and is still in
 * `lists` keeps its position, clamped to `maxScroll[name]` (0 when the list no longer scrolls).
 * A list that disappeared is dropped.
 */
export function keepScroll(prev: Record<string, number>, lists: string[], maxScroll: Record<string, number>): Record<string, number> {
  const kept: Record<string, number> = {}
  for (const name of lists) {
    if (!Object.prototype.hasOwnProperty.call(prev, name)) continue
    kept[name] = Math.max(0, Math.min(prev[name]!, maxScroll[name] ?? 0))
  }
  return kept
}
