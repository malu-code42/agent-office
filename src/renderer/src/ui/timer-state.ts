/**
 * The state of the popup of the Timer (bar button), shared so the dock button can show it,
 * and a cache of the last Timer view the app saw, so the open popup redraws itself when the
 * main process says the Timer changed. The popup is the only one that opens it: it is the
 * one that says when it opens and when it closes.
 */
import type { BarTimerView } from '@shared/barTimer'

let open = false
const openWatchers = new Set<() => void>()

/** Says that the popup of the Timer opened or closed. */
export function setTimerPopupOpen(value: boolean): void {
  if (value === open) return
  open = value
  for (const w of openWatchers) w()
}

/** Whether the popup of the Timer is open right now. */
export function isTimerPopupOpen(): boolean {
  return open
}

/** Calls back when the popup opens or closes; returns the unsubscribe. */
export function onTimerPopup(cb: () => void): () => void {
  openWatchers.add(cb)
  return () => {
    openWatchers.delete(cb)
  }
}

/** The close function the open popup gave; null when no popup is open. */
let closeRequest: (() => void) | null = null

/**
 * Registers (or clears) the function that closes the popup. Only one of the two popups of the
 * bar can be open at a time: the one that opens later calls the closer of the other first.
 */
export function requestTimerPopupClose(cb: (() => void) | null): void {
  closeRequest = cb
}

/** Closes the popup of the Timer through the closer it registered, if one is open. */
export function closeTimerPopup(): void {
  closeRequest?.()
  closeRequest = null
}

/** The last Timer view the app saw; follows the `barTimer` events (and the initial state). */
let view: BarTimerView | null = null
const viewWatchers = new Set<(v: BarTimerView | null) => void>()

/** Replaces the cached view and tells who follows it. */
export function setBarTimerView(v: BarTimerView | null): void {
  view = v
  for (const w of viewWatchers) w(v)
}

/** The cached view, without asking the main process. */
export function getBarTimerView(): BarTimerView | null {
  return view
}

/** Calls back when the Timer view changes; returns the unsubscribe. */
export function onBarTimerView(cb: (v: BarTimerView | null) => void): () => void {
  viewWatchers.add(cb)
  return () => {
    viewWatchers.delete(cb)
  }
}
