import type { ClassScheduleView, ClassSlot } from '@shared/class-schedule'
import { announce } from './a11y'
import { h } from './dom'
import { cleanError, modal } from './modals/common'

type Toast = (text: string, kind?: 'info' | 'ok' | 'err') => void

/** The colors of the classes, by topic: the same topic keeps its color all week. */
const COLORS = ['--amber', '--blue', '--green', '--red', '--pink']

const colorOf = (topic: string): string => {
  let n = 0
  for (const ch of topic) n = (n * 31 + ch.charCodeAt(0)) >>> 0
  return `var(${COLORS[n % COLORS.length]})`
}

const changeText = (slot: ClassSlot): string | null => {
  if (!slot.change) return null
  if (slot.change.kind === 'cancelled') return 'Cancelada nesta semana'
  if (slot.change.kind === 'moved') return `Só nesta semana: ${slot.time} (era ${slot.change.from})`
  return 'Alterada só nesta semana'
}

/**
 * The "Horário de aula" board of the study floor: the week grid of aulas.md (Monday to
 * Saturday by time, today highlighted), each class with its topic and what happens in it.
 * Read only: the grid and its exceptions are edited in the vault; the agenda shows the same classes.
 */
export async function openStudySchedule(root: HTMLElement, toast: Toast, openAgenda: () => void): Promise<void> {
  let view: ClassScheduleView
  try {
    view = await window.office.readClassSchedule()
  } catch (error) {
    toast(cleanError(error), 'err')
    return
  }
  const close = () => el.remove()
  const today = view.days.find((day) => day.today)
  const cell = (slot: ClassSlot) => {
    const change = changeText(slot)
    return h(
      'div',
      {
        class: `study-schedule-class${slot.change ? ` is-${slot.change.kind}` : ''}`,
        style: `--class-color: ${colorOf(slot.topic)}`,
      },
      h('b', {}, slot.topic),
      slot.detail ? h('span', {}, slot.detail) : null,
      change ? h('em', {}, change) : null,
    )
  }
  const grid = h(
    'table',
    { class: 'study-schedule', 'aria-label': 'Grade semanal de aulas' },
    h(
      'thead',
      {},
      h(
        'tr',
        {},
        h('th', { scope: 'col', 'aria-label': 'Horário' }),
        ...view.days.map((day) =>
          h('th', { scope: 'col', class: day.today ? 'is-today' : '' }, day.today ? `${day.label} · hoje` : day.label),
        ),
      ),
    ),
    h(
      'tbody',
      {},
      ...view.times.map((time) =>
        h(
          'tr',
          {},
          h('th', { scope: 'row' }, time),
          ...view.days.map((day) =>
            h('td', { class: day.today ? 'is-today' : '' }, ...day.classes.filter((slot) => slot.time === time).map(cell)),
          ),
        ),
      ),
    ),
  )
  const count = view.days.reduce((n, day) => n + day.classes.filter((slot) => slot.change?.kind !== 'cancelled').length, 0)
  const body: HTMLElement[] = [
    h(
      'p',
      { class: 'field-hint' },
      'Grade fixa da semana, lida de aulas.md no vault. Uma exceção muda só aquela ocorrência, não a grade. Aqui é só leitura.',
    ),
  ]
  if (!view.found)
    body.push(
      h(
        'div',
        { class: 'study-schedule-empty' },
        h('b', {}, 'Ainda não há aulas.md no vault.'),
        h('span', {}, 'Uma aula por linha; o título pode trazer o tópico e o que acontece, separados por “·”:'),
        h('code', {}, '- id: ed-seg | dia: segunda | hora: 19:00 | título: Estrutura de Dados · Filas com o tutor'),
      ),
    )
  else if (!view.times.length) body.push(h('p', { class: 'study-schedule-empty' }, 'aulas.md não tem aulas nesta semana.'))
  else body.push(h('div', { class: 'study-schedule-wrap' }, grid))
  if (view.warnings.length)
    body.push(
      h(
        'details',
        { class: 'study-schedule-warnings' },
        h('summary', {}, `${view.warnings.length} linha(s) de aulas.md não foram entendidas`),
        h('ul', {}, ...view.warnings.map((warning) => h('li', {}, warning))),
      ),
    )
  const el = modal(
    'Horário de aula',
    body,
    [
      h(
        'span',
        { class: 'field-hint grow' },
        today ? `Hoje: ${today.classes.length ? today.classes.map((s) => `${s.time} ${s.topic}`).join(', ') : 'sem aulas'}` : '',
      ),
      h('button', { class: 'btn', type: 'button', onclick: close }, 'Fechar'),
      h(
        'button',
        {
          class: 'btn btn-primary',
          type: 'button',
          onclick: () => {
            close()
            openAgenda()
          },
        },
        'Ver na agenda',
      ),
    ],
    close,
    true,
  )
  el.querySelector('.modal')?.classList.add('study-schedule-modal')
  root.append(el)
  el.querySelector<HTMLButtonElement>('.modal-foot .btn-primary')?.focus()
  announce(view.found ? `Horário de aula aberto: ${count} aulas nesta semana.` : 'Horário de aula aberto: ainda não há aulas.md no vault.')
}
