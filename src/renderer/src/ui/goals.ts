import { goalProgress, type Goal } from '@shared/goals'
import { h, icon } from './dom'
import { cleanError, modal } from './modals/common'
import './goals.css'

const brDate = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function daysLeft(deadline: string): string {
  const today = isoDay(new Date())
  const diff = Math.round((new Date(`${deadline}T12:00:00Z`).getTime() - new Date(`${today}T12:00:00Z`).getTime()) / 86400000)
  if (diff < 0) return 'prazo vencido'
  if (diff === 0) return 'vence hoje'
  return `faltam ${diff} dias`
}

function goalItem(goal: Goal, completedTaskIds: ReadonlySet<string>): HTMLElement {
  const progress = goalProgress(goal, completedTaskIds)
  const pct = progress.percent
  const milestoneMarks = goal.milestones.map((milestone) =>
    h(
      'li',
      { class: milestone.done ? 'ok' : '' },
      h('span', { class: 'tl-mk', 'aria-hidden': 'true' }, milestone.done ? '✓' : ''),
      h('span', { class: 'sr-only' }, milestone.done ? 'Concluído: ' : 'Pendente: '),
      h('span', {}, milestone.text),
    ),
  )
  return h(
    'li',
    { class: 'agenda-entry tl-goal' },
    h(
      'div',
      { class: 'tl-goal-when' },
      h('span', { class: 'agenda-time' }, brDate(goal.deadline)),
      h('span', { class: 'tl-sub' }, goal.achieved ? 'Alcançado' : daysLeft(goal.deadline)),
    ),
    h(
      'div',
      { class: 'tl-entry-main' },
      h(
        'div',
        { class: 'tl-row' },
        h('b', { class: 'tl-goal-title' }, goal.title),
        h('span', { class: `tl-state ${goal.achieved ? 'tl-state-done' : 'tl-state-open'}` }, goal.achieved ? 'Alcançado' : 'Em andamento'),
      ),
      h('div', { class: 'tl-sub' }, 'Alvo: ', goal.target),
      h(
        'div',
        { class: 'tl-prog', role: 'progressbar', 'aria-valuenow': String(pct), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': `Progresso de ${goal.title}` },
        h('i', { style: `width:${pct}%` }),
      ),
      h('div', { class: 'tl-sub' }, h('b', {}, `${pct}%`), ` · ${progress.complete} de ${progress.total} marcos`),
      h('ul', { class: 'tl-marcos' }, ...milestoneMarks),
    ),
  )
}

/** Objetivos somente leitura (rodada 5): Em andamento e Alcançados, sem vincular tarefa, concluir ou criar. */
export function openGoals(root: HTMLElement, _toast: (message: string, kind?: 'ok' | 'err') => void): void {
  const content = h('div', { class: 'goals-content' }, h('p', { class: 'hint' }, 'Lendo os objetivos…'))
  const close = () => backdrop.remove()
  const closeButton = h('button', { class: 'btn', type: 'button', onclick: close }, 'Fechar')
  const footHint = h('span', { class: 'hint grow tl-foot-hint' }, 'Somente leitura. Mudanças nos objetivos são feitas pela Luna, no chat.')
  const backdrop = modal('Objetivos', [content], [footHint, closeButton], close)
  root.append(backdrop)
  closeButton.focus()

  const render = async (): Promise<void> => {
    let goals: Goal[]
    let tasks: { id?: string; status: string }[]
    try {
      ;({ goals, tasks } = await window.office.readGoals())
    } catch (err) {
      content.replaceChildren(h('div', { class: 'dialog-note', role: 'alert' }, cleanError(err)))
      return
    }
    const completedTaskIds = new Set(
      tasks.filter((task) => task.status === 'completed' && task.id).map((task) => task.id!.toLowerCase()),
    )
    const active = goals.filter((goal) => !goal.achieved)
    const done = goals.filter((goal) => goal.achieved)

    if (!goals.length) {
      content.replaceChildren(
        h('div', { class: 'tl-empty' }, icon('gauge', 28), h('b', {}, 'Nenhum objetivo ainda'), h('span', {}, 'Os objetivos vêm de objetivos.md no vault. Peça à Luna para criar o primeiro.')),
      )
      return
    }

    const sections: HTMLElement[] = []
    if (active.length)
      sections.push(
        h(
          'section',
          { class: 'agenda-section' },
          h('h3', { class: 'agenda-title' }, 'Em andamento'),
          h('ul', { class: 'agenda-list' }, ...active.map((goal) => goalItem(goal, completedTaskIds))),
        ),
      )
    if (done.length)
      sections.push(
        h(
          'section',
          { class: 'agenda-section' },
          h('h3', { class: 'agenda-title' }, 'Alcançados'),
          h('ul', { class: 'agenda-list' }, ...done.map((goal) => goalItem(goal, completedTaskIds))),
        ),
      )
    content.replaceChildren(...sections)
  }

  void render()
}
