/** The keyboard of the app's dropdown (ui/dropdown.ts), without the DOM, so it is tested on its own. */

export interface DropdownOption {
  text: string
  disabled: boolean
}

/** The option the arrow keys, Home and End land on from `from`, skipping disabled ones; -1 when none. */
export function dropdownMove(options: readonly DropdownOption[], from: number, key: string): number {
  const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0)
  if (!enabled.length) return -1
  if (key === 'Home') return enabled[0]!
  if (key === 'End') return enabled.at(-1)!
  if (key === 'ArrowDown') return enabled.find((i) => i > from) ?? (from < 0 ? enabled[0]! : from)
  if (key === 'ArrowUp') return [...enabled].reverse().find((i) => i < from) ?? (from < 0 ? enabled[0]! : from)
  return from
}

/** Type-ahead: the next enabled option after `from` whose text starts with `query` (no case, no accents); -1 when none. */
export function dropdownMatch(options: readonly DropdownOption[], from: number, query: string): number {
  const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  const q = fold(query)
  if (!q) return -1
  for (let step = 1; step <= options.length; step++) {
    const i = (from + step + options.length) % options.length
    if (!options[i]!.disabled && fold(options[i]!.text).startsWith(q)) return i
  }
  return -1
}
