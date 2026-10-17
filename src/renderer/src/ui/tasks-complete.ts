import type { FocusItem } from '@shared/planning'
import { type ParsedBoard, UNDO_WINDOW_MS } from '@shared/tasks'
import type { ToastAction } from './hud'
import { cleanError } from './modals/common'

/**
 * Completing a task, from the board card or the focus popup. The toast offers "Desfazer" for
 * UNDO_WINDOW_MS; the main process checks tarefas.md again when it is pressed, and a refusal
 * comes back as the toast.
 */

export type Toast = (msg: string, type?: 'info' | 'ok' | 'err', action?: ToastAction) => void

/** The board and the focus as the main process read them after a change. */
export interface TasksState {
  board: ParsedBoard
  focus: FocusItem[]
}

export function offerUndo(toast: Toast, title: string, id: string, onUndone: (state: TasksState) => void): void {
  toast(`Tarefa concluída: ${title}`, 'ok', {
    label: 'Desfazer',
    lifetimeMs: UNDO_WINDOW_MS,
    run: () => void undo(toast, id, onUndone),
  })
}

async function undo(toast: Toast, id: string, onUndone: (state: TasksState) => void): Promise<void> {
  try {
    const next = await window.office.undoCompleteTask(id)
    toast('Conclusão desfeita: a tarefa voltou para a lista de origem.', 'ok')
    onUndone(next)
  } catch (err) {
    toast(cleanError(err), 'err')
  }
}
