import type { AgendaDay, AgendaEntry, AgendaView } from '@shared/agenda'
import { h } from './dom'
import { cleanError, modal } from './modals/common'
import './agenda.css'

const WEEKDAYS = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo']

/** "17.10.2026" from "2026-10-17". */
const brDate = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`
const weekday = (iso: string) => WEEKDAYS[(new Date(`${iso}T12:00:00`).getDay() + 6) % 7]!

function entryItem(entry: AgendaEntry): HTMLElement {
  if (entry.kind === 'commitment') {
    return h('li', { class: 'agenda-entry' }, h('span', { class: 'agenda-time' }, entry.time), h('span', {}, entry.title))
  }
  if (entry.kind === 'task') {
    return h(
      'li',
      { class: 'agenda-entry' },
      h('span', { class: 'agenda-time' }, entry.time),
      h('span', { class: entry.text === null ? 'agenda-missing' : '' }, entry.text ?? 'tarefa não encontrada'),
    )
  }
  // The line as written, so a line the app does not know is still there to read.
  return h('li', { class: 'agenda-entry agenda-raw' }, entry.text)
}

function dayList(day: AgendaDay): HTMLElement {
  return day.entries.length ? h('ul', { class: 'agenda-list' }, ...day.entries.map(entryItem)) : h('p', { class: 'hint' }, 'Nada marcado.')
}

function paint(view: AgendaView): HTMLElement[] {
  if (!view.found) {
    return [
      h(
        'div',
        { class: 'empty-box panelbox' },
        h('b', {}, 'Nenhum agenda.md no vault.'),
        h('span', {}, 'Crie o arquivo agenda.md na pasta do vault.'),
      ),
    ]
  }
  const sections = [
    h(
      'section',
      { class: 'agenda-section', 'aria-label': 'Hoje' },
      h('h3', { class: 'agenda-title' }, `Hoje, ${weekday(view.today.date)} ${brDate(view.today.date)}`),
      dayList(view.today),
    ),
    h(
      'section',
      { class: 'agenda-section', 'aria-label': 'Semana' },
      h('h3', { class: 'agenda-title' }, 'Semana'),
      ...view.week.map((day) =>
        h('div', { class: 'agenda-day' }, h('h4', { class: 'agenda-day-title' }, `${weekday(day.date)} ${brDate(day.date)}`), dayList(day)),
      ),
    ),
  ]
  if (view.undated.length) {
    sections.push(
      h(
        'section',
        { class: 'agenda-section', 'aria-label': 'Linhas sem data' },
        h('h3', { class: 'agenda-title' }, 'Linhas sem data'),
        h('ul', { class: 'agenda-list' }, ...view.undated.map(entryItem)),
      ),
    )
  }
  return sections
}

/**
 * The "Agenda" dialog over the Tarefas board. It reads agenda.md each time it opens, through the main process,
 * so an edit made in Obsidian shows the next time. Esc closes it and gives the focus back to the button that opened it.
 */
export function openAgenda(root: HTMLElement): void {
  const content = h('div', { class: 'agenda' }, h('p', { class: 'hint' }, 'Lendo o agenda.md…'))
  const close = () => backdrop.remove()
  const closeButton = h('button', { class: 'btn btn-primary', type: 'button', onclick: close }, 'Fechar')
  const backdrop = modal('Agenda', [content], [closeButton], close)
  root.append(backdrop)
  closeButton.focus()
  void (async () => {
    try {
      content.replaceChildren(...paint(await window.office.readAgenda()))
    } catch (err) {
      content.replaceChildren(h('div', { class: 'dialog-note', role: 'alert' }, cleanError(err)))
    }
  })()
}
