/**
 * Whether the popup of "Tarefas em foco" is open, so the button in the dock can show it.
 * The popup is the only one that opens it, so it is the one that says when it opens and
 * when it closes.
 */

let open = false
const watchers = new Set<() => void>()

/** Says that the popup of "Tarefas em foco" opened or closed. */
export function setFocusPopupOpen(value: boolean): void {
  if (value === open) return
  open = value
  for (const w of watchers) w()
}

/** Whether the popup of "Tarefas em foco" is open right now. */
export function isFocusPopupOpen(): boolean {
  return open
}

/** Calls back when the popup opens or closes; returns the unsubscribe. */
export function onFocusPopup(cb: () => void): () => void {
  watchers.add(cb)
  return () => {
    watchers.delete(cb)
  }
}

/** The close function the open popup gave; null when no popup is open. */
let closeRequest: (() => void) | null = null

/**
 * Registers (or clears) the function that closes the popup. Only one of the two popups of the
 * bar can be open at a time: the one that opens later calls the closer of the other first.
 */
export function requestFocusPopupClose(cb: (() => void) | null): void {
  closeRequest = cb
}

/** Closes the popup of "Tarefas em foco" through the closer it registered, if one is open. */
export function closeFocusPopup(): void {
  closeRequest?.()
  closeRequest = null
}
