import { UNDO_WINDOW_MS } from '@shared/tasks'
import type { TaskCompletion } from './tasks-write'

/**
 * The completions that can still be undone, by task id, for UNDO_WINDOW_MS after each one. Kept in
 * memory: a completion of an earlier session is not offered again. The clock comes in, so the
 * window is tested without waiting.
 */

export interface PendingCompletion extends TaskCompletion {
  /** The vault folder the task was completed in. */
  vault: string
  /** Whether the task was in focus before it was completed: undo puts it back. */
  wasFocused: boolean
}

export function createCompletionUndo(now: () => number = () => Date.now()) {
  const pending = new Map<string, { at: number; done: PendingCompletion }>()

  return {
    remember(done: PendingCompletion): void {
      const at = now()
      for (const [key, p] of pending) if (at - p.at >= UNDO_WINDOW_MS) pending.delete(key)
      pending.set(done.id.toLowerCase(), { at, done })
    },
    /** The completion to undo in this vault. Throws once its window has passed, or when there is none. */
    peek(id: string, vault: string): PendingCompletion {
      const p = pending.get(id.toLowerCase())
      if (!p || p.done.vault !== vault) throw new Error('Não há conclusão para desfazer. Só dá para desfazer logo depois de concluir.')
      if (now() - p.at >= UNDO_WINDOW_MS) {
        pending.delete(id.toLowerCase())
        throw new Error('Passaram os 10 segundos para desfazer. A tarefa continua concluída.')
      }
      return p.done
    },
    forget(id: string): void {
      pending.delete(id.toLowerCase())
    },
  }
}

export type CompletionUndo = ReturnType<typeof createCompletionUndo>
