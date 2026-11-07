// Which desk a sitter takes (AO-106): any free desk, at random, but never a different one on the
// next frame. The "random" is a hash of a stable key, so the same squad (or the same floor) always
// gets the same order: a reload, a new plan or a member joining does not move the ones who sat.
// Plain numbers and strings, so the rule is checked without a scene.

/** 32-bit FNV-1a with a final avalanche, so near keys ("a:1", "a:2") do not rank near each other. */
export function hashKey(key: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  h ^= h >>> 16
  h = Math.imul(h, 0x45d9f3b)
  h ^= h >>> 16
  return h >>> 0
}

/**
 * The items in a pseudo-random order that depends only on `seed` and on each item's own key.
 * Taking an item out never reorders the others, and adding one never moves the rest.
 */
export function stableOrder<T>(items: readonly T[], seed: string, keyOf: (item: T, index: number) => string): T[] {
  return items
    .map((item, index) => ({ item, index, rank: hashKey(`${seed}|${keyOf(item, index)}`) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((e) => e.item)
}

/** The desk positions 0..count-1 of a room, in the order a squad's members take them. */
export function memberDeskOrder(count: number, seed: string): number[] {
  return stableOrder(
    Array.from({ length: count }, (_, i) => i),
    seed,
    (i) => String(i),
  )
}
