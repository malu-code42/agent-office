import type { PersonalRoutineOverview } from '@shared/routine-personal'
import { h, icon } from './dom'
import { cleanError, modal } from './modals/common'
import './personal-routines.css'

const WEEKDAY_NAMES = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']
const WEEKDAY_CHIPS = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D'] // seg, ter, qua, qui, sex, sab, dom

const brDate = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`
const weekdayShortOf = (iso: string) => WEEKDAY_CHIPS[(new Date(`${iso}T12:00:00`).getDay() + 6) % 7]!
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

type RoutineCard = {
  title: string
  freq: string
  target?: [number, number]
  days?: number[]
  next: string
  hour?: string
  st: [string, string]
  problem?: string
  line?: number
}

type RoutineLike = { cadence: 'diária' | 'semanal'; days?: string[]; target?: number }

function frequencyText(item: RoutineLike): string {
  if (item.cadence === 'diária') return 'Todo dia'
  if (item.days?.length)
    return 'Toda ' + (item.days.length > 1 ? `${item.days.slice(0, -1).join(', ')} e ${item.days.at(-1)}` : item.days[0])
  if (item.target) return `${item.target} vezes por semana`
  return 'Semanal'
}

function nextLabel(occurrenceIds: string[], today: string): string {
  const upcoming = occurrenceIds
    .map((id) => id.split(':')[1] ?? id)
    .filter((d) => d >= today)
    .sort()
  if (!upcoming.length) return '—'
  const d = upcoming[0]!
  if (d === today) return 'Hoje'
  const tomorrow = isoDay(new Date(Date.now() + 86400000))
  if (d === tomorrow) return 'Amanhã'
  return `${weekdayShortOf(d)} ${brDate(d)}`
}

function stateChip(cls: string, text: string): HTMLElement {
  return h('span', { class: `tl-state ${cls}` }, text)
}

function routineCard(card: RoutineCard): HTMLElement {
  const problem = !!card.problem
  return h(
    'li',
    { class: `tl-rt${problem ? ' warn' : ''}` },
    h(
      'div',
      { class: 'tl-row' },
      h('b', { class: 'tl-rt-name' }, card.title ?? `Linha ${card.line ?? '?'}`),
      stateChip(card.st[0], card.st[1]),
    ),
    h('div', { class: 'tl-rt-freq' }, card.freq),
    card.target
      ? h(
          'div',
          { class: 'tl-rt-target', 'aria-label': `${card.target![0]} de ${card.target![1]} nesta semana` },
          ...Array.from({ length: card.target![1] }, (_, i) => h('i', { class: i < card.target![0] ? 'on' : '' })),
          h('span', {}, `${card.target![0]} de ${card.target![1]} nesta semana, em qualquer dia`),
        )
      : h(
          'div',
          {
            class: 'tl-rt-days',
            'aria-label': card.days ? `Dias: ${card.days.map((d) => WEEKDAY_NAMES[d]).join(', ') || 'nenhum marcado'}` : 'Todos os dias',
          },
          // The chips start on Monday; the days of a row are JS weekdays (Sunday is 0).
          ...WEEKDAY_CHIPS.map((chip, i) =>
            h('span', { class: !card.days || card.days.includes((i + 1) % 7) ? 'on' : '', 'aria-hidden': 'true' }, chip),
          ),
        ),
    card.problem
      ? h('div', { class: 'tl-rt-problem' }, `Linha ${card.line}: ${card.problem}`)
      : h(
          'dl',
          { class: 'tl-rt-meta' },
          h('dt', {}, 'Próxima'),
          h('dd', {}, card.next),
          h('dt', {}, 'Hora'),
          h('dd', {}, card.hour ?? 'sem hora'),
        ),
  )
}

/** Painel somente leitura das rotinas pessoais (AO-42 / rodada 5). Não cria tarefas nem altera rotinas. */
export async function openPersonalRoutinesPanel(root: HTMLElement, _toast?: (message: string, kind?: 'ok' | 'err') => void): Promise<void> {
  const content = h('div', { class: 'personal-routines' }, h('p', { class: 'hint' }, 'Lendo as rotinas pessoais.'))
  const close = () => backdrop.remove()
  const closeButton = h('button', { class: 'btn', type: 'button', onclick: close }, 'Fechar')
  const footHint = h('span', { class: 'hint grow tl-foot-hint' }, 'Somente leitura. Mudanças nas rotinas são feitas pela Luna, no chat.')
  const backdrop = modal('Rotinas pessoais', [content], [footHint, closeButton], close, true)
  root.append(backdrop)
  closeButton.focus()

  let overview: PersonalRoutineOverview
  try {
    overview = await window.office.personalRoutineOverview()
  } catch (err) {
    content.replaceChildren(h('div', { class: 'dialog-note', role: 'alert' }, cleanError(err)))
    return
  }

  const today = overview.today
  const needsInput = overview.candidates.filter((c) => c.kind === 'needsInput')

  const cards: RoutineCard[] = overview.rows.map((row) => ({
    title: row.title,
    freq: frequencyText({ cadence: row.cadence, days: row.days?.map((d) => WEEKDAY_NAMES[d]), target: row.target }),
    // A weekly target on explicit days shows the days; only "N times a week, any day" shows the dots.
    ...(row.target && !row.days?.length ? { target: [row.completed, row.target!] } : {}),
    ...(row.days ? { days: row.days } : {}),
    next: nextLabel(row.occurrenceIds, today),
    hour: row.time,
    st: ['ok', 'Ativa'],
  }))
  for (const candidate of needsInput) {
    cards.push({
      title: candidate.item?.title ?? candidate.title ?? `Linha ${candidate.line}`,
      freq: candidate.item ? frequencyText(candidate.item) : '—',
      days: [],
      next: '—',
      st: ['warn', 'Precisa de você'],
      problem: candidate.reason,
      line: candidate.line,
    })
  }

  const render = (): void => {
    if (!cards.length) {
      content.replaceChildren(
        h(
          'div',
          { class: 'tl-empty' },
          icon('history', 28),
          h('b', {}, 'Nenhuma rotina ainda'),
          h(
            'span',
            {},
            'As rotinas vêm de rotinas-pessoais.md ou rotina_pessoal.txt na pasta do vault. Peça à Luna para criar a primeira.',
          ),
        ),
      )
      return
    }
    content.replaceChildren(
      h(
        'div',
        { class: 'tl-tl-head' },
        h('h3', { class: 'agenda-title' }, `${cards.length} rotina${cards.length === 1 ? '' : 's'}`),
        h('span', { class: 'grow' }),
      ),
      h('ul', { class: 'tl-rts' }, ...cards.map(routineCard)),
    )
  }

  render()
}
