import type { LogEntry } from './types'

/**
 * The final reply reaches the log twice: as an assistant message and again as the "result" card.
 * True when `prev` is that assistant bubble for the result `e`. The log keeps both; the feed hides it.
 */
export function isDupOfResult(prev: LogEntry | undefined, e: LogEntry | undefined): boolean {
  return !!prev && !!e && prev.kind === 'assistant' && e.kind === 'result' && !e.isError && prev.text.trim() === e.text.trim()
}
