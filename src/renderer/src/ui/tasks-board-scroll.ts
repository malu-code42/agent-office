/**
 * Scroll offset of each list of the Tarefas board, by name, for a redraw in place: a list that is still
 * there keeps its offset, a new one starts at the top, and a list that is gone is dropped.
 */
export function keepListScroll(previous: ReadonlyMap<string, number>, lists: readonly string[]): Map<string, number> {
  return new Map(lists.map((name) => [name, previous.get(name) ?? 0]))
}
