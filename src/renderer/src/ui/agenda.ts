import type { AgendaDay, AgendaEntry, AgendaView } from '@shared/agenda'
import type { PersonalRoutineOverview, PersonalRoutineWeekRow } from '@shared/routine-personal'
import { h, icon } from './dom'
import { cleanError, modal } from './modals/common'
import './agenda.css'

const WEEKDAYS = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo']
const WEEKDAY_SHORT = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']

const brDate = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`
const weekdayOf = (iso: string) => WEEKDAYS[(new Date(`${iso}T12:00:00`).getDay() + 6) % 7]!
const weekdayShortOf = (iso: string) => WEEKDAY_SHORT[(new Date(`${iso}T12:00:00`).getDay() + 6) % 7]!
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const T_FROM = 7
const T_TO = 23
const mins = (hm: string) => {
  const [hh, mm] = hm.split(':').map(Number)
  return hh * 60 + mm
}
const pos = (hm: string) => ((mins(hm) - T_FROM * 60) / ((T_TO - T_FROM) * 60)) * 100

type ViewKind = 'resumo' | 'dia' | 'semana'
type DayEv = { at: string; t: string; kind: string; note?: string; conflict?: boolean }

const KIND_LABEL: Record<string, string> = { evento: 'Compromisso', aula: 'Aula', tarefa: 'Tarefa', feita: 'Rotina feita', rotina: 'Rotina prevista' }

function entryToEv(entry: AgendaEntry): DayEv | null {
  if (entry.kind === 'unknown') return null
  const kind = entry.kind === 'class' ? 'aula' : entry.kind === 'task' ? 'tarefa' : 'evento'
  return {
    at: entry.time,
    t: entry.kind === 'task' ? (entry.text ?? 'tarefa não encontrada') : entry.title,
    kind,
    conflict: !!entry.conflict,
  }
}

/** Alterna os lados da linha e afasta um balão um nível quando cobriria o anterior desse lado. */
function placeBalloons(evs: DayEv[]): { side: 'up' | 'down'; level: number }[] {
  const right: Record<'up' | 'down', number[]> = { up: [], down: [] }
  return evs.map((e, i) => {
    const x = pos(e.at) - 1.4
    const sides: ('up' | 'down')[] = i % 2 ? ['down', 'up'] : ['up', 'down']
    for (let level = 0; level < 3; level++)
      for (const side of sides)
        if ((right[side][level] ?? -100) <= x) {
          right[side][level] = x + 16.3
          return { side, level }
        }
    return { side: sides[0], level: 2 }
  })
}

function balloon(ev: DayEv, place: { side: 'up' | 'down'; level: number }): HTMLElement {
  const stem = 44 + place.level * 86
  return h(
    'div',
    {
      class: `tl-bal tl-bal-${place.side} tl-ev-${ev.kind}${ev.conflict ? ' conflict' : ''}`,
      style: `left:${pos(ev.at)}%;--stem:${stem}px`,
      role: 'listitem',
      'aria-label': `${ev.at} ${KIND_LABEL[ev.kind]}: ${ev.t}${ev.note ? '. ' + ev.note : ''}${ev.conflict ? '. Conflito de horário.' : ''}`,
    },
    h('i', { class: 'tl-bal-dot', 'aria-hidden': 'true' }),
    h('i', { class: 'tl-bal-stem', 'aria-hidden': 'true' }),
    h(
      'div',
      { class: 'tl-bal-box' },
      h('div', { class: 'tl-bal-top' }, h('b', {}, ev.at), h('span', {}, KIND_LABEL[ev.kind])),
      h('div', { class: 'tl-bal-title' }, ev.t),
      ev.note ? h('div', { class: 'tl-bal-note' }, ev.note) : null,
    ),
  )
}

function dayLine(day: AgendaDay, now: string): HTMLElement {
  const evs = day.entries.map(entryToEv).filter((e): e is DayEv => e !== null)
  const untimed = day.entries.filter((entry) => entry.kind === 'unknown').map((entry) => entry.text)
  const places = placeBalloons(evs)
  const hours = Array.from({ length: T_TO - T_FROM + 1 }, (_, i) => T_FROM + i)
  const dayHasNow = day.date === isoDay(new Date())
  return h(
    'div',
    { class: 'tl-day', role: 'list', 'aria-label': `Linha do tempo do dia ${weekdayOf(day.date)} ${brDate(day.date)}` },
    h(
      'div',
      { class: 'tl-day-stage' },
      h('div', { class: 'tl-day-axis' }),
      ...hours.map((hh) => h('span', { class: 'tl-day-tick', style: `left:${pos(`${hh}:00`)}%`, 'aria-hidden': 'true' }, `${String(hh).padStart(2, '0')}h`)),
      dayHasNow ? h('span', { class: 'tl-day-now', style: `left:${pos(now)}%` }, h('b', {}, `agora · ${now}`)) : null,
      ...evs.map((ev, i) => balloon(ev, places[i])),
    ),
    untimed.length
      ? h('div', { class: 'tl-tl-untimed tl-day-untimed' }, h('span', {}, 'Sem hora:'), ...untimed.map((u) => h('span', { class: 'tl-tl-chip' }, u)))
      : null,
  )
}

function weekBand(day: AgendaDay, now: string): HTMLElement {
  const evs = day.entries.map(entryToEv).filter((e): e is DayEv => e !== null)
  const today = day.date === isoDay(new Date())
  return h(
    'div',
    { class: `tl-tl-row${today ? ' today' : ''}`, role: 'row' },
    h('span', { class: 'tl-tl-day', role: 'rowheader' }, `${weekdayShortOf(day.date)} ${day.date.slice(8, 10)}/${day.date.slice(5, 7)}`, today ? h('small', {}, 'hoje') : null),
    h(
      'div',
      { class: 'tl-tl-track', role: 'cell' },
      ...Array.from({ length: T_TO - T_FROM + 1 }, (_, i) => T_FROM + i).map((hh) => h('i', { class: 'tl-tl-grid', style: `left:${pos(`${hh}:00`)}%` })),
      today ? h('span', { class: 'tl-tl-now', style: `left:${pos(now)}%`, title: `Agora, ${now}` }) : null,
      ...evs.map((ev, i) => {
        const end = `${Math.floor((mins(ev.at) + 50) / 60)}:${String((mins(ev.at) + 50) % 60).padStart(2, '0')}`
        // A block that starts inside the one before it goes half a lane down, like a conflict, so both stay readable.
        const low = ev.conflict || evs.slice(0, i).some((prev) => mins(ev.at) < mins(prev.at) + 50)
        return h(
          'div',
          {
            class: `tl-tl-ev tl-ev-${ev.kind}${ev.conflict ? ' conflict' : ''}`,
            style: `left:${pos(ev.at)}%;width:max(${pos(end) - pos(ev.at)}%, 96px);top:${low ? 24 : 6}px;bottom:${low ? 2 : 6}px`,
            title: `${ev.at}${ev.conflict ? ' – conflito' : ''} · ${ev.t}`,
            role: 'gridcell',
            'aria-label': `${weekdayShortOf(day.date)} ${ev.at} ${KIND_LABEL[ev.kind]}: ${ev.t}${ev.conflict ? '. Conflito de horário.' : ''}`,
          },
          h('b', {}, ev.at),
          h('span', {}, ev.t),
        )
      }),
    ),
  )
}

function stat(number: string, label: string, sub: string, cls = ''): HTMLElement {
  return h(
    'div',
    { class: `tl-stat${cls}` },
    h('b', {}, number),
    h('span', { class: 'tl-stat-l' }, label),
    h('span', { class: 'tl-sub' }, sub),
  )
}

/** How often a routine runs, in words: "Todo dia", "3 vezes por semana", "2 dias na semana". */
function routineFrequency(row: PersonalRoutineWeekRow, planned: number): string {
  if (row.cadence === 'diária') return 'Todo dia'
  if (row.target) return `${row.target} vezes por semana`
  return `${planned} ${planned === 1 ? 'dia' : 'dias'} na semana`
}

/** The week dashboard (round 5, capture 09): numbers, items per day, routines of the week and what comes next. */
function resumo(view: AgendaView, routines: PersonalRoutineOverview | null): HTMLElement[] {
  const now = new Date()
  const nowHm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  const weekEntries = view.week.flatMap((day) => day.entries)
  const commitments = weekEntries.filter((e) => e.kind === 'commitment')
  const classes = weekEntries.filter((e) => e.kind === 'class')
  const tasks = weekEntries.filter((e) => e.kind === 'task')
  const todayIndex = view.week.findIndex((day) => day.date === view.today.date)
  // Passed this week: every entry of the days before today, and today's up to now.
  const passed = (kind: AgendaEntry['kind']) =>
    view.week.reduce(
      (n, day, i) =>
        n + day.entries.filter((e) => e.kind === kind && (i < todayIndex || (i === todayIndex && 'time' in e && e.time < nowHm))).length,
      0,
    )
  const rows = routines?.rows ?? []
  const plannedOf = (row: PersonalRoutineWeekRow) => row.target ?? row.occurrenceIds.length
  const routinesDone = rows.reduce((n, row) => n + Math.min(row.completed, plannedOf(row)), 0)
  const routinesPlanned = rows.reduce((n, row) => n + plannedOf(row), 0)
  const max = Math.max(1, ...view.week.map((day) => day.entries.length))
  const bars = view.week.map((day, i) => [weekdayShortOf(day.date), day.entries.length, i === todayIndex, i > todayIndex] as const)
  const next: { when: string; ev: DayEv }[] = []
  view.week.forEach((day, i) => {
    if (i < todayIndex) return
    for (const ev of day.entries.map(entryToEv)) {
      if (!ev || (i === todayIndex && ev.at < nowHm)) continue
      next.push({ when: `${i === todayIndex ? 'Hoje' : weekdayShortOf(day.date)} ${ev.at}`, ev })
    }
  })

  const sections: HTMLElement[] = [
    h(
      'div',
      { class: 'tl-stats' },
      stat(String(weekEntries.length), 'itens previstos', `${commitments.length} compromissos, ${classes.length} aulas, ${tasks.length} tarefas`),
      stat(String(commitments.length), 'compromissos', `${passed('commitment')} já passaram`),
      stat(String(classes.length), 'aulas', `${passed('class')} já aconteceram`),
      rows.length ? stat(String(routinesDone), 'rotinas concluídas', `de ${routinesPlanned} previstas`, ' ok') : null,
      stat(String(tasks.length), 'tarefas agendadas', 'na semana'),
    ),
    h(
      'div',
      { class: `tl-dash${rows.length ? '' : ' tl-dash-2'}` },
      h(
        'section',
        { class: 'tl-dash-card' },
        h('h3', { class: 'agenda-title' }, 'Itens por dia'),
        h(
          'div',
          { class: 'tl-bars', role: 'img', 'aria-label': `Itens previstos por dia: ${bars.map(([d, n]) => `${d} ${n}`).join(', ')}` },
          ...bars.map(([label, total, today, future]) =>
            h(
              'div',
              { class: `tl-bar${today ? ' today' : ''}${future ? ' future' : ''}` },
              h('div', { class: 'tl-bar-col' }, h('i', { class: total ? 'done' : 'none', style: `height:${total ? (total / max) * 100 : 12}%` })),
              h('b', {}, total ? String(total) : '—'),
              h('span', {}, label),
            ),
          ),
        ),
        h('div', { class: 'tl-tl-legend' }, h('span', {}, h('i', { class: 'tl-ev-feita' }), 'Itens do dia'), h('span', {}, h('i', { class: 'tl-bar-of' }), 'Dia sem itens')),
      ),
      rows.length
        ? h(
            'section',
            { class: 'tl-dash-card' },
            h('h3', { class: 'agenda-title' }, 'Rotinas na semana'),
            h(
              'ul',
              { class: 'tl-dash-rt' },
              ...rows.map((row) => {
                const planned = plannedOf(row)
                const done = Math.min(row.completed, planned)
                return h(
                  'li',
                  {},
                  h('div', { class: 'tl-row' }, h('span', { class: 'grow' }, row.title), h('b', {}, `${done} de ${planned}`)),
                  h(
                    'div',
                    {
                      class: 'tl-prog',
                      role: 'progressbar',
                      'aria-label': row.title,
                      'aria-valuemin': '0',
                      'aria-valuemax': String(planned),
                      'aria-valuenow': String(done),
                    },
                    h('i', { style: `width:${planned ? (done / planned) * 100 : 0}%` }),
                  ),
                  h('span', { class: 'tl-sub' }, routineFrequency(row, planned)),
                )
              }),
            ),
          )
        : null,
      h(
        'section',
        { class: 'tl-dash-card' },
        h('h3', { class: 'agenda-title' }, 'Próximos'),
        next.length
          ? h(
              'ul',
              { class: 'tl-dash-next' },
              ...next
                .slice(0, 6)
                .map(({ when, ev }) =>
                  h('li', {}, h('b', {}, when), h('span', {}, ev.t), ev.conflict ? h('span', { class: 'tl-state late' }, 'conflito') : null),
                ),
            )
          : h('span', { class: 'tl-sub' }, 'Nada mais nesta semana.'),
      ),
    ),
  ]
  if (view.warnings.length) {
    sections.push(
      h(
        'div',
        { class: 'tl-warn' },
        h('b', {}, 'Revise aulas.md:'),
        ...view.warnings.map((warning) => h('p', {}, warning)),
      ),
    )
  }
  return sections
}

function legendItems(): HTMLElement[] {
  return [
    h('span', {}, h('i', { class: 'tl-ev-evento' }), 'Compromisso'),
    h('span', {}, h('i', { class: 'tl-ev-aula' }), 'Aula'),
    h('span', {}, h('i', { class: 'tl-ev-tarefa' }), 'Tarefa'),
    h('span', {}, h('i', { class: 'tl-ev-feita' }), 'Rotina feita'),
    h('span', {}, h('i', { class: 'tl-ev-rotina' }), 'Rotina prevista'),
    h('span', { class: 'tl-state late' }, 'Conflito'),
  ]
}

/** Cabeçalho com a troca de visualização e a navegação de datas. */
/** "26/10 a 01/11": the Monday-to-Sunday week that holds `iso`. */
function weekLabel(iso: string): string {
  const start = addDays(iso, -((new Date(`${iso}T12:00:00`).getDay() + 6) % 7))
  const dm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`
  return `${dm(start)} a ${dm(addDays(start, 6))}`
}

function agendaHead(kind: ViewKind, selected: string, onView: (k: ViewKind) => void, onPrev: () => void, onNext: () => void, onToday: () => void): HTMLElement {
  const tabs = [['resumo', 'Resumo da semana'], ['dia', 'Dia'], ['semana', '7 dias']] as const
  const dayPick = kind !== 'resumo' ? h('div', { class: 'tl-daypick' }, h('button', { class: 'icon-btn', 'aria-label': kind === 'dia' ? 'Dia anterior' : 'Semana anterior', onclick: onPrev }, h('span', { class: 'tl-flip' }, icon('chevron', 15))), h('b', {}, kind === 'dia' ? `${weekdayShortOf(selected)} ${selected.slice(8, 10)}/${selected.slice(5, 7)}${selected === isoDay(new Date()) ? ' · hoje' : ''}` : weekLabel(selected)), h('button', { class: 'icon-btn', 'aria-label': kind === 'dia' ? 'Próximo dia' : 'Próxima semana', onclick: onNext }, icon('chevron', 15)), h('button', { class: 'btn btn-small', onclick: onToday }, 'Hoje')) : null
  return h(
    'div',
    { class: 'tl-ahead' },
    h(
      'div',
      { class: 'tl-seg', role: 'tablist', 'aria-label': 'Visualização da agenda' },
      ...tabs.map(([k, t]) => h('button', { class: kind === k ? 'on' : '', role: 'tab', 'aria-selected': String(kind === k), type: 'button', onclick: () => onView(k) }, t)),
    ),
    dayPick,
  )
}

/** Adiciona `n` dias a uma data ISO (AAAA-MM-DD), sem envolver fuso horário. */
const addDays = (iso: string, n: number): string => {
  const [y, m, d] = iso.split('-').map(Number)
  const parsed = new Date(y, m - 1, d + n)
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`
}

/** Dialogo somente leitura da Agenda, aberto pelo atalho Agenda da Casa e do quadro Tarefas. */
export function openAgenda(root: HTMLElement): void {
  const content = h('div', { class: 'agenda' }, h('p', { class: 'hint' }, 'Lendo a agenda…'))
  const close = () => backdrop.remove()
  const closeButton = h('button', { class: 'btn', type: 'button', onclick: close }, 'Fechar')
  const closeX = h('button', { class: 'icon-btn', type: 'button', title: 'Fechar (Esc)', 'aria-label': 'Fechar a agenda', onclick: close }, icon('x', 18))
  const footHint = h('span', { class: 'hint grow tl-foot-hint' }, 'Somente leitura. Mudanças na agenda são feitas pela Luna, no chat.')
  const backdrop = modal('Agenda', [content], [footHint, closeButton], close, true)
  root.append(backdrop)
  closeButton.focus()

  let kind: ViewKind = 'resumo'
  let selected = isoDay(new Date())
  let routines: PersonalRoutineOverview | null = null
  let view: AgendaView = { found: false, classesFound: false, warnings: [], today: { date: selected, entries: [] }, week: [], undated: [] }

  /** Carrega a semana que contém `selected` e renderiza. */
  const render = async (date?: string): Promise<void> => {
    if (date) selected = date
    content.replaceChildren(h('p', { class: 'hint' }, 'Lendo a agenda…'))
    try {
      view = await window.office.readAgendaForDate(selected)
      // The routines of the week only feed the dashboard; a failure there leaves them out, not the agenda.
      if (kind === 'resumo') routines = await window.office.personalRoutineOverview().catch(() => null)
    } catch (err) {
      content.replaceChildren(h('div', { class: 'dialog-note', role: 'alert' }, cleanError(err)))
      return
    }

    // Reconstroi o cabeçalho do modal com a troca de visualização e a navegação de datas.
    // Mantém um id estável no título para que o aria-labelledby do diálogo (definido por modalA11y)
    // continue válido após cada re-render do cabeçalho.
    const modalHead = backdrop.querySelector<HTMLElement>('.modal-head')!
    const modalBox = backdrop.querySelector<HTMLElement>('.modal.card')!
    modalHead.replaceChildren(
      h('div', { class: 'modal-title', id: 'agenda-modal-title' }, 'Agenda'),
      agendaHead(kind, selected, (k) => { kind = k; void render() }, () => moveDate(-1), () => moveDate(1), () => { selected = isoDay(new Date()); void render(selected) }),
      closeX,
    )
    modalBox.setAttribute('aria-labelledby', 'agenda-modal-title')

    const now = `${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`

    // Sem arquivo nem aulas: estado vazio. Se há aulas.md, as aulas aparecem nas visualizações.
    if (!view.found && !view.classesFound) {
      content.replaceChildren(
        h('div', { class: 'tl-empty' }, icon('calendar', 28), h('b', {}, 'Nenhum compromisso'), h('span', {}, 'A agenda vem de agenda.md e das aulas de aulas.md no vault. Peça à Luna para marcar um compromisso.')),
      )
      return
    }

    const body: HTMLElement[] = []
    if (kind === 'resumo') {
      body.push(...resumo(view, routines))
    } else if (kind === 'dia') {
      const weekDay = view.week.find((day) => day.date === selected) ?? view.today
      const untimed = weekDay.entries.filter((entry) => entry.kind === 'unknown').map((entry) => entry.text)
      if (weekDay.entries.length === 0 && !untimed.length) {
        body.push(h('div', { class: 'tl-empty' }, icon('calendar', 28), h('b', {}, 'Nenhum compromisso para hoje.'), h('span', {}, 'Nada marcado para este dia.')))
      } else {
        body.push(h('div', { class: 'tl-tl-head' }, h('span', { class: 'grow' }), h('div', { class: 'tl-tl-legend' }, ...legendItems().slice(0, 4))), dayLine(weekDay, now))
      }
    } else {
      const anyEntries = view.week.some((day) => day.entries.length > 0)
      if (!anyEntries) {
        body.push(h('div', { class: 'tl-empty' }, icon('calendar', 28), h('b', {}, 'Sem itens nesta semana.'), h('span', {}, 'Não há compromissos, aulas ou tarefas agendadas neste período.')))
      } else {
        body.push(
          h('div', { class: 'tl-tl-head' }, h('span', { class: 'grow' }), h('div', { class: 'tl-tl-legend' }, ...legendItems().slice(0, 4))),
          h(
            'div',
            { class: 'tl-tl', role: 'table', 'aria-label': 'Linha do tempo da semana' },
            h('div', { class: 'tl-tl-row tl-tl-axis', role: 'row', 'aria-hidden': 'true' }, h('span', { class: 'tl-tl-day' }), h('div', { class: 'tl-tl-track' }, ...Array.from({ length: T_TO - T_FROM + 1 }, (_, i) => T_FROM + i).map((hh) => h('span', { class: 'tl-tl-hour', style: `left:${pos(`${hh}:00`)}%` }, `${String(hh).padStart(2, '0')}h`)))),
            ...view.week.map((day) => weekBand(day, now)),
          ),
        )
      }
    }
    content.replaceChildren(...body)
  }

  const moveDate = (delta: number): void => {
    const step = kind === 'dia' ? 1 : 7
    void render(addDays(selected, step * delta))
  }

  void render()
}
