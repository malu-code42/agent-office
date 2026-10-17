import type { FocusItem } from '@shared/planning'
import type { ReopenResult } from '@shared/types'
import type { ParsedBoard, TaskRef } from '@shared/tasks'
import { h } from './dom'
import { cleanError, field, modal } from './modals/common'
import type { Toast } from './tasks-complete'

/**
 * Discarding and reopening a task (AO-06), from the board card, the completed list and the focus popup.
 * The reason is asked here and checked again in the main process; a refusal comes back as the toast.
 * Reopening asks for a list only when the task's origin list is gone.
 */

type Discarded = { id: string; board: ParsedBoard; focus: FocusItem[] }

export async function runDiscard(
  root: HTMLElement,
  toast: Toast,
  target: TaskRef,
  title: string,
  onDone: (next: Discarded) => void,
): Promise<void> {
  const reason = await askDiscardReason(root, title)
  if (reason === null) return
  try {
    const next = await window.office.discardTask({ target, reason })
    toast(`Tarefa descartada: ${title}.`, 'ok')
    onDone(next)
  } catch (err) {
    toast(cleanError(err), 'err')
  }
}

type Reopened = Extract<ReopenResult, { status: 'done' }>

export async function runReopen(
  root: HTMLElement,
  toast: Toast,
  target: TaskRef,
  title: string,
  onDone: (next: Reopened) => void,
): Promise<void> {
  try {
    let next = await window.office.reopenTask({ target })
    if (next.status === 'choose') {
      const list = await askReopenList(root, title, next.lists)
      if (list === null) return
      next = await window.office.reopenTask({ target, list })
    }
    if (next.status === 'choose') throw new Error('Não consegui devolver a tarefa a uma lista. Tente de novo.')
    toast(`Tarefa reaberta em ${next.list}.`, 'ok')
    onDone(next)
  } catch (err) {
    toast(cleanError(err), 'err')
  }
}

/** The reason of a discard, or null when the user cancels. An empty reason is not sent: the form asks again. */
export function askDiscardReason(root: HTMLElement, title: string): Promise<string | null> {
  return new Promise((resolve) => {
    let done = false
    const finish = (value: string | null) => {
      if (done) return
      done = true
      el.remove()
      resolve(value)
    }
    const input = h('input', {
      class: 'input',
      type: 'text',
      maxlength: '200',
      'aria-label': 'Motivo do descarte',
      placeholder: 'Ex.: não é mais necessária',
    })
    const error = h('div', { class: 'field-hint', role: 'alert' })
    const submit = () => {
      const reason = input.value.trim()
      if (!reason) {
        error.textContent = 'Escreva o motivo para descartar a tarefa.'
        input.focus()
        return
      }
      finish(reason)
    }
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing) return
      e.preventDefault()
      submit()
    })
    const el = modal(
      `Descartar “${title}”`,
      [field('Motivo', input, 'Obrigatório. A tarefa vai para o Archive com este motivo e não conta como concluída.'), error],
      [
        h('button', { class: 'btn', type: 'button', onclick: () => finish(null) }, 'Cancelar'),
        h('button', { class: 'btn btn-danger-solid', type: 'button', onclick: submit }, 'Descartar'),
      ],
      () => finish(null),
    )
    root.append(el)
    input.focus()
  })
}

/** The list a reopened task goes back to, when its origin list is gone. Esc cancels: nothing is written. */
export function askReopenList(root: HTMLElement, title: string, lists: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    let done = false
    const finish = (value: string | null) => {
      if (done) return
      done = true
      el.remove()
      resolve(value)
    }
    const choices = lists.map((name) => h('button', { class: 'btn', type: 'button', onclick: () => finish(name) }, name))
    const hint =
      lists.length === 0
        ? 'Não há lista para receber a tarefa. Crie uma lista no tarefas.md e tente de novo.'
        : 'A lista de origem não existe mais no tarefas.md. Escolha para qual lista a tarefa volta.'
    const el = modal(
      `Reabrir “${title}”`,
      [h('p', { class: 'hint' }, hint), h('div', { class: 'tasks-reopen-options', role: 'group', 'aria-label': 'Listas' }, ...choices)],
      [h('button', { class: 'btn', type: 'button', onclick: () => finish(null) }, 'Cancelar')],
      () => finish(null),
    )
    root.append(el)
    ;(choices[0] ?? el.querySelector<HTMLElement>('.modal-foot button'))?.focus()
  })
}
