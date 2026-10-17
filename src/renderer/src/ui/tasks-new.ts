import { taskDraftProblem, type ParsedBoard } from '@shared/tasks'
import { h } from './dom'
import { cleanError, field, modal } from './modals/common'

/**
 * The "Nova tarefa" form over the Tarefas board. The main process checks the file again
 * before writing; `done` gets the board read after the write.
 */
export function openNewTask(
  root: HTMLElement,
  lists: string[],
  done: (board: ParsedBoard) => void,
  toast: (msg: string, type?: 'info' | 'ok' | 'err') => void,
): void {
  const title = h('input', { class: 'input', type: 'text', maxlength: 200, autocomplete: 'off', required: true })
  const list = h('select', { class: 'input', required: true }, ...lists.map((name) => h('option', { value: name }, name)))
  const date = h('input', { class: 'input', type: 'text', placeholder: 'DD.MM.AAAA', maxlength: 10, autocomplete: 'off' })
  const time = h('input', { class: 'input', type: 'text', placeholder: 'HH:MM', maxlength: 5, autocomplete: 'off' })
  const error = h('div', { class: 'dialog-note', role: 'alert' })
  const showError = (text: string) => {
    error.textContent = text
  }
  const submit = h(
    'button',
    { class: 'btn btn-primary', type: 'submit', form: 'tasks-new-form', disabled: lists.length === 0 },
    'Criar tarefa',
  )
  let busy = false

  const save = async () => {
    if (busy) return
    const draft = { title: title.value, list: list.value, date: date.value, time: time.value }
    const problem = taskDraftProblem(draft, lists)
    if (problem) return showError(problem)
    busy = true
    try {
      const created = await window.office.createTask(draft)
      backdrop.remove()
      toast('Tarefa criada.', 'ok')
      done(created.board)
    } catch (err) {
      showError(cleanError(err))
    } finally {
      busy = false
    }
  }

  const form = h(
    'form',
    {
      id: 'tasks-new-form',
      onsubmit: (e: Event) => {
        e.preventDefault()
        void save()
      },
    },
    field('Título', title),
    field('Lista', list),
    field('Data', date, 'Opcional. Use DD.MM.AAAA.'),
    field('Hora', time, 'Opcional. Use HH:MM.'),
    error,
  )
  if (!lists.length) showError('Não há listas no tarefas.md. Crie uma com uma linha “## Nome”.')

  const close = () => backdrop.remove()
  const backdrop = modal('Nova tarefa', [form], [h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancelar'), submit], close)
  root.append(backdrop)
  title.focus()
}
