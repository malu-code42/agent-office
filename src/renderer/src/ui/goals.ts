import { goalProgress, type Goal, type GoalMilestone } from '@shared/goals'
import { topicName } from '@shared/study-trail'
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
  const row = (done: boolean, text: string) =>
    h(
      'li',
      { class: done ? 'ok' : '' },
      h('span', { class: 'tl-mk', 'aria-hidden': 'true' }, done ? '✓' : ''),
      h('span', { class: 'sr-only' }, done ? 'Concluído: ' : 'Pendente: '),
      h('span', {}, text),
    )
  // A marco written "Grupo › item" folds under its group, like the trail disciplines; the others stay as plain rows.
  const groups = new Map<string, { text: string; done: boolean }[]>()
  const plain: GoalMilestone[] = []
  for (const milestone of goal.milestones) {
    const [group, ...rest] = milestone.text.split(' › ')
    if (rest.length) groups.set(group!, [...(groups.get(group!) ?? []), { text: rest.join(' › '), done: milestone.done }])
    else plain.push(milestone)
  }
  for (const topic of goal.trailTopics ?? [])
    groups.set(topic.discipline, [...(groups.get(topic.discipline) ?? []), { text: topicName(topic.label), done: topic.done }])
  const milestoneMarks = plain.map((milestone) => row(milestone.done, milestone.text))
  const trailMarks = [...groups].map(([name, items]) =>
    h(
      'details',
      { class: 'tl-disc' },
      h(
        'summary',
        {},
        h('span', {}, name),
        h('span', { class: 'tl-disc-bar', 'aria-hidden': 'true' }, h('i', { style: `width:${Math.floor((items.filter((item) => item.done).length / items.length) * 100)}%` })),
        h('span', { class: 'tl-sub tl-disc-pct' }, `${items.filter((item) => item.done).length} de ${items.length} · ${Math.floor((items.filter((item) => item.done).length / items.length) * 100)}%`),
      ),
      h('ul', { class: 'tl-marcos' }, ...items.map((item) => row(item.done, item.text))),
    ),
  )
  return h(
    'li',
    { class: 'agenda-entry tl-goal' },
    h(
      'div',
      { class: 'tl-goal-when' },
      h('span', { class: 'agenda-time' }, goal.deadline ? brDate(goal.deadline) : 'Sem prazo'),
      h('span', { class: 'tl-sub' }, goal.achieved ? (goal.achievedDate ? `Alcançado em ${brDate(goal.achievedDate)}` : 'Alcançado') : goal.deadline ? daysLeft(goal.deadline) : ''),
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
      goal.target ? h('div', { class: 'tl-sub' }, 'Alvo: ', goal.target) : '',
      h(
        'div',
        {
          class: 'tl-prog',
          role: 'progressbar',
          'aria-valuenow': String(pct),
          'aria-valuemin': '0',
          'aria-valuemax': '100',
          'aria-label': `Progresso de ${goal.title}`,
        },
        h('i', { style: `width:${pct}%` }),
      ),
      goal.simple
        ? h('div', { class: 'tl-sub' }, h('b', {}, goal.achieved ? 'Concluído' : 'Em aberto'))
        : progress.total === 0
          ? h('div', { class: 'tl-sub' }, 'Sem marcos nem tarefas ligadas: o progresso ainda não é medido.')
          : h('div', { class: 'tl-sub' }, h('b', {}, `${pct}%`), ` · ${progress.complete} de ${progress.total} ${goal.trail ? 'itens' : 'marcos'}`),
      h('ul', { class: 'tl-marcos' }, ...milestoneMarks),
      ...trailMarks,
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
    const completedTaskIds = new Set(tasks.filter((task) => task.status === 'completed' && task.id).map((task) => task.id!.toLowerCase()))
    const active = goals.filter((goal) => !goal.achieved)
    const done = goals.filter((goal) => goal.achieved)

    if (!goals.length) {
      content.replaceChildren(
        h(
          'div',
          { class: 'tl-empty' },
          icon('gauge', 28),
          h('b', {}, 'Nenhum objetivo ainda'),
          h(
            'span',
            {},
            'Os objetivos vêm de objetivos.md ou objetivos.txt na pasta do vault (uma linha “- [ ] objetivo” por item). Peça à Luna para criar o primeiro.',
          ),
        ),
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
