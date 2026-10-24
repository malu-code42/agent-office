import { goalProgress, type Goal } from '@shared/goals'
import { h } from './dom'
import { cleanError, field, modal } from './modals/common'
import './goals.css'

const brDate = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`

/** Editable goals stay in objetivos.md; linked tasks remain canonical in tarefas.md. */
export function openGoals(root: HTMLElement, toast: (message: string, kind?: 'ok' | 'err') => void): void {
  const content = h('div', { class: 'goals-content' }, h('p', { class: 'hint' }, 'Lendo objetivos.md…'))
  const close = () => backdrop.remove()
  const closeButton = h('button', { class: 'btn btn-primary', type: 'button', onclick: close }, 'Fechar')
  const backdrop = modal('Objetivos', [content], [closeButton], close)
  root.append(backdrop)
  closeButton.focus()

  const refresh = async (focusId?: string) => {
    const data = await window.office.readGoals()
    const completedTaskIds = new Set(
      data.tasks.filter((task) => task.status === 'completed' && task.id).map((task) => task.id!.toLowerCase()),
    )
    const drawGoal = (goal: Goal) => {
      const progress = goalProgress(goal, completedTaskIds)
      const milestoneRows = goal.milestones.map((milestone, index) =>
        h(
          'label',
          { class: 'goal-milestone' },
          h('input', {
            type: 'checkbox',
            checked: milestone.done,
            onchange: async (event: Event) => {
              const checkbox = event.currentTarget as HTMLInputElement
              checkbox.disabled = true
              try {
                await window.office.setGoalMilestone(goal.id, index, checkbox.checked)
                await refresh(goal.id)
              } catch (err) {
                toast(cleanError(err), 'err')
                checkbox.disabled = false
              }
            },
          }),
          h('span', {}, milestone.text),
        ),
      )
      const linked = new Set(goal.taskIds)
      const candidates = data.tasks.filter((task) => task.id && !linked.has(task.id.toLowerCase()))
      const taskPicker = h(
        'select',
        { class: 'goal-task-select', 'aria-label': `Vincular tarefa a ${goal.title}` },
        h('option', { value: '' }, 'Vincular tarefa…'),
        ...candidates.map((task) =>
          h('option', { value: task.id! }, `${task.status === 'completed' ? 'Concluída' : 'Em aberto'} — ${task.text}`),
        ),
      ) as HTMLSelectElement
      const linkButton = h(
        'button',
        {
          class: 'btn btn-small',
          type: 'button',
          disabled: candidates.length === 0 || undefined,
          onclick: async () => {
            if (!taskPicker.value) return
            linkButton.disabled = true
            try {
              await window.office.linkGoalTask(goal.id, taskPicker.value)
              await refresh(goal.id)
            } catch (err) {
              toast(cleanError(err), 'err')
              linkButton.disabled = false
            }
          },
        },
        'Vincular',
      )
      const taskRows = goal.taskIds.map((id) => {
        const task = data.tasks.find((item) => item.id?.toLowerCase() === id)
        return h(
          'li',
          {},
          task ? `${task.status === 'completed' ? 'Concluída' : 'Em aberto'} — ${task.text}` : `Tarefa ^${id} não encontrada`,
        )
      })
      const actions: HTMLElement[] = []
      if (progress.percent === 100 && !goal.achieved) {
        const achieve = h(
          'button',
          {
            class: 'btn btn-small btn-primary',
            type: 'button',
            onclick: async () => {
              achieve.disabled = true
              try {
                const confirmed = await window.office.achieveGoal(goal.id)
                if (confirmed) toast('Objetivo marcado como alcançado.', 'ok')
                await refresh(goal.id)
              } catch (err) {
                toast(cleanError(err), 'err')
                achieve.disabled = false
              }
            },
          },
          'Marcar como alcançado',
        )
        actions.push(achieve)
      }
      return h(
        'article',
        { class: 'goal-card', 'data-goal-id': goal.id, tabindex: '-1' },
        h(
          'div',
          { class: 'goal-card-head' },
          h('h3', {}, goal.title),
          h('span', { class: goal.achieved ? 'goal-state goal-state-done' : 'goal-state' }, goal.achieved ? 'Alcançado' : 'Em andamento'),
        ),
        h('p', { class: 'goal-target' }, goal.target),
        h('p', { class: 'goal-deadline' }, `Prazo: ${brDate(goal.deadline)}`),
        h(
          'div',
          { class: 'goal-progress-line' },
          h('span', {}, `${progress.percent}%`),
          h('span', {}, `${progress.complete} de ${progress.total} itens`),
        ),
        goal.milestones.length
          ? h('ul', { class: 'goal-milestones' }, ...milestoneRows)
          : h('p', { class: 'field-hint' }, 'Nenhum marco cadastrado.'),
        h(
          'div',
          { class: 'goal-linked' },
          h('strong', {}, 'Tarefas vinculadas'),
          taskRows.length ? h('ul', {}, ...taskRows) : h('p', { class: 'field-hint' }, 'Nenhuma tarefa vinculada.'),
          h('div', { class: 'goal-link-row' }, taskPicker, linkButton),
        ),
        ...actions,
      )
    }

    const title = h('input', { type: 'text', maxlength: '200', placeholder: 'Ex.: Aprender fotografia' }) as HTMLInputElement
    const target = h('input', { type: 'text', maxlength: '500', placeholder: 'Ex.: concluir 8 módulos do curso' }) as HTMLInputElement
    const deadline = h('input', { type: 'date' }) as HTMLInputElement
    const milestones = h('textarea', { rows: '4', placeholder: 'Um marco por linha' }) as HTMLTextAreaElement
    const taskPicker = h(
      'select',
      { class: 'goal-task-select', multiple: true, 'aria-label': 'Tarefas canônicas vinculadas' },
      ...data.tasks.map((task) =>
        h(
          'option',
          { value: task.id ?? '', disabled: !task.id || undefined },
          `${task.status === 'completed' ? 'Concluída' : 'Em aberto'} — ${task.text}${task.id ? '' : ' (sem identificador)'}`,
        ),
      ),
    ) as HTMLSelectElement
    const status = h('p', { class: 'field-hint', role: 'status' })
    const create = h(
      'button',
      {
        class: 'btn btn-primary',
        type: 'button',
        onclick: async () => {
          const selected = [...taskPicker.selectedOptions].map((option) => option.value).filter(Boolean)
          const draft = {
            title: title.value,
            target: target.value,
            deadline: deadline.value,
            milestones: milestones.value
              .split(/\r?\n/)
              .map((text) => text.trim())
              .filter(Boolean)
              .map((text) => ({ text, done: false })),
            taskIds: selected,
          }
          create.disabled = true
          try {
            await window.office.createGoal(draft)
            toast('Objetivo criado em objetivos.md.', 'ok')
            await refresh()
          } catch (err) {
            status.textContent = cleanError(err)
            create.disabled = false
          }
        },
      },
      'Criar objetivo',
    )
    const createForm = h(
      'section',
      { class: 'goal-create' },
      h('h3', {}, 'Novo objetivo'),
      field('Objetivo', title),
      field('Alvo mensurável', target, 'Descreva como saberá que chegou ao alvo.'),
      field('Prazo', deadline),
      field('Marcos', milestones, 'Marcos têm pesos iguais entre si e às tarefas vinculadas.'),
      field('Vincular tarefas existentes', taskPicker, 'As tarefas continuam em tarefas.md e não serão alteradas.'),
      status,
      create,
    )
    content.replaceChildren(
      data.goals.length
        ? h('div', { class: 'goal-list' }, ...data.goals.map(drawGoal))
        : h(
            'div',
            { class: 'empty-box panelbox' },
            h('b', {}, 'Nenhum objetivo cadastrado.'),
            h('span', {}, 'Crie um abaixo ou edite objetivos.md no Obsidian.'),
          ),
      createForm,
    )
    if (focusId) content.querySelector<HTMLElement>(`[data-goal-id="${focusId}"]`)?.focus()
  }

  void refresh().catch((err) => content.replaceChildren(h('div', { class: 'dialog-note', role: 'alert' }, cleanError(err))))
}
