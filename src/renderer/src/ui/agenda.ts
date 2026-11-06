import type { AgendaDay, AgendaEntry, AgendaView } from '@shared/agenda'
import type { PersonalRoutineOverview, PersonalRoutineWeekRow } from '@shared/routine-personal'
import { summarizeRange, type FocusRangeView, type FocusSegment } from '@shared/focusLog'
import { h, icon } from './dom'
import { layoutDayEvents, type DayEventLayout } from './agenda-day-layout'
import { addDaysIso, collectDays, dayInputs, taskBlocks, weekDates } from './agenda-time'
import { sevenDays, taskCard, timePanel, weekFocus, type WeekColumn } from './agenda-time-view'
import { cleanError, modal } from './modals/common'
import './agenda.css'

const WEEKDAYS = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo']
const WEEKDAY_SHORT = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']

const brDate = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`
const weekdayOf = (iso: string) => WEEKDAYS[(new Date(`${iso}T12:00:00`).getDay() + 6) % 7]!
const weekdayShortOf = (iso: string) => WEEKDAY_SHORT[(new Date(`${iso}T12:00:00`).getDay() + 6) % 7]!
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const mins = (hm: string) => {
  const [hh, mm] = hm.split(':').map(Number)
  return hh * 60 + mm
}

type ViewKind = 'resumo' | 'dia' | 'semana'
type DayEv = { at: string; t: string; kind: string; note?: string; conflict?: boolean }

const KIND_LABEL: Record<string, string> = {
  evento: 'Compromisso',
  aula: 'Aula',
  tarefa: 'Tarefa',
  feita: 'Rotina feita',
  concluida: 'Tarefa concluída',
  rotina: 'Rotina prevista',
}

function entryToEv(entry: AgendaEntry): DayEv | null {
  if (entry.kind === 'unknown') return null
  const kind = entry.kind === 'class' ? 'aula' : entry.kind === 'task' ? 'tarefa' : entry.kind === 'done' ? 'concluida' : 'evento'
  return {
    at: entry.time,
    t: entry.kind === 'task' ? (entry.text ?? 'tarefa não encontrada') : entry.kind === 'done' ? entry.text : entry.title,
    kind,
    conflict: entry.kind !== 'done' && !!entry.conflict,
  }
}

/** Escala vertical da aba Dia; o mesmo valor está em agenda.css (comentário de `.tl-day`). */
const PX_PER_MINUTE = 1.6

/** Cartão de um evento: a posição vem de `layoutDayEvents`, a largura é 1/colunas do grupo de sobreposição. */
function dayCard(ev: DayEv, spot: DayEventLayout, from: number): HTMLElement {
  const width = `calc(${100 / spot.columns}% - 4px)`
  const left = `calc(${(spot.column * 100) / spot.columns}% + 2px)`
  return h(
    'div',
    {
      class: `tl-dv-ev tl-dv-${ev.kind}${ev.conflict ? ' conflict' : ''}`,
      style: `left:${left};width:${width};top:${(spot.startMin - from) * PX_PER_MINUTE}px;height:${spot.height * PX_PER_MINUTE}px`,
      role: 'listitem',
      'aria-label': `${ev.at} ${KIND_LABEL[ev.kind]}: ${ev.t}${ev.note ? '. ' + ev.note : ''}${ev.conflict ? '. Conflito de horário.' : ''}`,
    },
    h('div', { class: 'tl-dv-top' }, h('b', {}, ev.at), h('span', { class: 'tl-dv-kind' }, KIND_LABEL[ev.kind])),
    h('div', { class: 'tl-dv-title' }, ev.t),
    ev.note ? h('div', { class: 'tl-dv-note' }, ev.note) : null,
  )
}

/** Entradas da agenda prontas para a grade; a linha de tarefa concluída que o Timer já mostra como bloco não se repete. */
function gridEvents(day: AgendaDay, workedIds: Set<string>): DayEv[] {
  return day.entries
    .filter((entry) => !(entry.kind === 'done' && workedIds.has(entry.id.toLowerCase())))
    .map(entryToEv)
    .filter((e): e is DayEv => e !== null)
}

function dayLine(day: AgendaDay, now: string, segs: FocusSegment[]): HTMLElement {
  const blocks = taskBlocks(segs)
  const evs = gridEvents(day, new Set(blocks.map((b) => b.taskId.toLowerCase())))
  const untimed = day.entries.filter((entry) => entry.kind === 'unknown').map((entry) => entry.text)
  const { events: spots, range } = layoutDayEvents(
    dayInputs(
      evs.map((ev) => ({ at: ev.at })),
      blocks,
    ),
  )
  const hours = Array.from({ length: Math.floor((range.to - range.from) / 60) + 1 }, (_, i) => range.from / 60 + i)
  const dayHasNow = day.date === isoDay(new Date()) && mins(now) >= range.from && mins(now) <= range.to
  return h(
    'div',
    { class: 'tl-day', role: 'list', 'aria-label': `Linha do tempo do dia ${weekdayOf(day.date)} ${brDate(day.date)}` },
    h(
      'div',
      { class: 'tl-day-stage', style: `height:${(range.to - range.from) * PX_PER_MINUTE}px` },
      ...hours.map((hh) =>
        h(
          'div',
          { class: 'tl-day-hour', style: `top:${(hh * 60 - range.from) * PX_PER_MINUTE}px`, 'aria-hidden': 'true' },
          h('span', {}, `${String(hh % 24).padStart(2, '0')}:00`),
        ),
      ),
      dayHasNow
        ? h('div', { class: 'tl-day-now', style: `top:${(mins(now) - range.from) * PX_PER_MINUTE}px`, title: `Agora, ${now}` }, h('b', {}, now))
        : null,
      ...evs.map((ev, i) => dayCard(ev, spots[i]!, range.from)),
      ...blocks.map((b, i) => taskCard(b, spots[evs.length + i]!, range.from, PX_PER_MINUTE)),
    ),
    untimed.length
      ? h(
          'div',
          { class: 'tl-tl-untimed tl-day-untimed' },
          h('span', {}, 'Sem hora:'),
          ...untimed.map((u) => h('span', { class: 'tl-tl-chip' }, u)),
        )
      : null,
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
function resumo(view: AgendaView, routines: PersonalRoutineOverview | null, focus: FocusRangeView, selected: string): HTMLElement[] {
  const now = new Date()
  const nowHm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  const weekEntries = view.week.flatMap((day) => day.entries)
  const commitments = weekEntries.filter((e) => e.kind === 'commitment')
  const classes = weekEntries.filter((e) => e.kind === 'class')
  const tasks = weekEntries.filter((e) => e.kind === 'task' || e.kind === 'done')
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
  // The dated read counts every occurrence of the week (a daily routine is 7); the overview only knows today's.
  const routinesDone = view.progress?.routinesDone ?? rows.reduce((n, row) => n + Math.min(row.completed, plannedOf(row)), 0)
  const routinesPlanned = view.progress?.routinesPlanned ?? rows.reduce((n, row) => n + plannedOf(row), 0)
  // Without completion data (an older read), every item counts as planned and none as done.
  const progress =
    view.progress?.days ??
    view.week.map((day) => ({ date: day.date, done: 0, planned: day.entries.filter((e) => e.kind !== 'unknown').length }))
  const doneWeek = progress.reduce((n, day) => n + day.done, 0)
  const plannedWeek = progress.reduce((n, day) => n + day.planned, 0)
  const max = Math.max(1, ...progress.map((day) => day.planned))
  const bars = progress.map((day, i) => ({ label: weekdayShortOf(day.date), ...day, today: i === todayIndex, future: i > todayIndex }))
  const next: { when: string; ev: DayEv }[] = []
  view.week.forEach((day, i) => {
    if (i < todayIndex) return
    for (const ev of day.entries.map(entryToEv)) {
      if (!ev || (i === todayIndex && ev.at < nowHm)) continue
      next.push({ when: `${i === todayIndex ? 'Hoje' : weekdayShortOf(day.date)} ${ev.at}`, ev })
    }
  })

  const dates = weekDates(selected)
  const todayKey = isoDay(new Date())
  const labels = dates.map((date) => ({ date, label: `${weekdayShortOf(date)} ${date.slice(8, 10)}${date === todayKey ? ' · hoje' : ''}`, today: date === todayKey }))
  const todayCommitments = view.today.entries.filter((e) => e.kind === 'commitment' || e.kind === 'class').length
  const sections: HTMLElement[] = [
    weekFocus(summarizeRange(focus.days, dates), labels, todayCommitments, todayKey),
    h(
      'div',
      { class: 'tl-stats' },
      stat(String(doneWeek), 'itens concluídos', `de ${plannedWeek} previstos na semana`),
      stat(String(commitments.length), 'compromissos', `${passed('commitment')} já passaram`),
      stat(String(classes.length), 'aulas', `${classes.filter((e) => e.kind === 'class' && e.attended).length} com presença confirmada`),
      rows.length ? stat(String(routinesDone), 'rotinas concluídas', `de ${routinesPlanned} previstas`, ' ok') : null,
      view.progress
        ? stat(
            String(view.progress.tasksDone),
            'tarefas concluídas',
            `${view.progress.tasksDiscarded} ${view.progress.tasksDiscarded === 1 ? 'descartada' : 'descartadas'}`,
            ' ok',
          )
        : stat(String(tasks.length), 'tarefas agendadas', 'na semana'),
    ),
    h(
      'div',
      { class: `tl-dash${rows.length ? '' : ' tl-dash-2'}` },
      h(
        'section',
        { class: 'tl-dash-card' },
        h('h3', { class: 'agenda-title' }, 'Concluídos por dia'),
        h(
          'div',
          {
            class: 'tl-bars',
            role: 'img',
            'aria-label': `Concluídos por dia: ${bars.map((bar) => `${bar.label} ${bar.done} de ${bar.planned}`).join(', ')}`,
          },
          ...bars.map((bar) =>
            h(
              'div',
              { class: `tl-bar${bar.today ? ' today' : ''}${bar.future ? ' future' : ''}` },
              h(
                'div',
                { class: 'tl-bar-col' },
                h('i', { class: 'plan', style: `height:${bar.planned ? (bar.planned / max) * 100 : 12}%` }),
                bar.done ? h('i', { class: 'done', style: `height:${(bar.done / max) * 100}%` }) : null,
              ),
              h('b', {}, bar.planned ? `${bar.done}/${bar.planned}` : '—'),
              h('span', {}, bar.label),
            ),
          ),
        ),
        h(
          'div',
          { class: 'tl-tl-legend' },
          h('span', {}, h('i', { class: 'tl-bar-done' }), 'Concluídos'),
          h('span', {}, h('i', { class: 'tl-bar-of' }), 'Previstos'),
        ),
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
                  h(
                    'li',
                    {},
                    h('b', {}, when),
                    h('span', {}, ev.t),
                    ev.conflict ? h('span', { class: 'tl-state late' }, 'conflito') : null,
                  ),
                ),
            )
          : h('span', { class: 'tl-sub' }, 'Nada mais nesta semana.'),
      ),
    ),
  ]
  if (view.warnings.length) {
    sections.push(h('div', { class: 'tl-warn' }, h('b', {}, 'Revise aulas.md:'), ...view.warnings.map((warning) => h('p', {}, warning))))
  }
  return sections
}

/** Legenda das abas Dia e 7 dias: os tipos da agenda e as tarefas feitas no Timer. */
function dayLegendItems(): HTMLElement[] {
  return [
    h('span', {}, h('i', { class: 'tl-dv-evento' }), 'Compromisso'),
    h('span', {}, h('i', { class: 'tl-dv-aula' }), 'Aula'),
    h('span', {}, h('i', { class: 'tl-dv-tarefa' }), 'Tarefa'),
    h('span', {}, h('i', { class: 'tl-dv-feita' }), 'Rotina feita'),
    h('span', {}, h('i', { class: 'tl-tk-0 tl-key' }), 'Tarefa feita no pomodoro'),
    h('span', {}, h('i', { class: 'tl-tk-run tl-key running' }), 'Em andamento'),
  ]
}

/** Cabeçalho com a troca de visualização e a navegação de datas. */
/** "06/11 a 12/11": os 7 dias que começam em `iso` (hoje e os 6 seguintes). */
function weekLabel(iso: string): string {
  const dm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`
  return `${dm(iso)} a ${dm(addDays(iso, 6))}`
}

function agendaHead(
  kind: ViewKind,
  selected: string,
  onView: (k: ViewKind) => void,
  onPrev: () => void,
  onNext: () => void,
  onToday: () => void,
): HTMLElement {
  const tabs = [
    ['resumo', 'Resumo da semana'],
    ['dia', 'Dia'],
    ['semana', '7 dias'],
  ] as const
  const dayPick =
    kind !== 'resumo'
      ? h(
          'div',
          { class: 'tl-daypick' },
          h(
            'button',
            { class: 'icon-btn', 'aria-label': kind === 'dia' ? 'Dia anterior' : 'Semana anterior', onclick: onPrev },
            h('span', { class: 'tl-flip' }, icon('chevron', 15)),
          ),
          h(
            'b',
            {},
            kind === 'dia'
              ? `${weekdayShortOf(selected)} ${selected.slice(8, 10)}/${selected.slice(5, 7)}${selected === isoDay(new Date()) ? ' · hoje' : ''}`
              : weekLabel(selected),
          ),
          h(
            'button',
            { class: 'icon-btn', 'aria-label': kind === 'dia' ? 'Próximo dia' : 'Próxima semana', onclick: onNext },
            icon('chevron', 15),
          ),
          h('button', { class: 'btn btn-small', onclick: onToday }, 'Hoje'),
        )
      : null
  return h(
    'div',
    { class: 'tl-ahead' },
    h(
      'div',
      { class: 'tl-seg', role: 'tablist', 'aria-label': 'Visualização da agenda' },
      ...tabs.map(([k, t]) =>
        h(
          'button',
          { class: kind === k ? 'on' : '', role: 'tab', 'aria-selected': String(kind === k), type: 'button', onclick: () => onView(k) },
          t,
        ),
      ),
    ),
    dayPick,
  )
}

/** Adiciona `n` dias a uma data ISO (AAAA-MM-DD), sem envolver fuso horário. */
const addDays = addDaysIso

/** Dialogo somente leitura da Agenda, aberto pelo atalho Agenda da Casa e do quadro Tarefas. */
export function openAgenda(root: HTMLElement): void {
  const content = h('div', { class: 'agenda' }, h('p', { class: 'hint' }, 'Lendo a agenda…'))
  // O foco chega ao vivo (AO-92): o evento do registro e um relógio de 30 s enquanto há tarefa em andamento.
  let stopEvents = (): void => {}
  const timers: { clock?: ReturnType<typeof setInterval> } = {}
  const close = () => {
    stopEvents()
    if (timers.clock !== undefined) clearInterval(timers.clock)
    backdrop.remove()
  }
  const closeButton = h('button', { class: 'btn', type: 'button', onclick: close }, 'Fechar')
  const closeX = h(
    'button',
    { class: 'icon-btn', type: 'button', title: 'Fechar (Esc)', 'aria-label': 'Fechar a agenda', onclick: close },
    icon('x', 18),
  )
  const footHint = h('span', { class: 'hint grow tl-foot-hint' }, 'Somente leitura. Mudanças na agenda são feitas pela Luna, no chat.')
  const backdrop = modal('Agenda', [content], [footHint, closeButton], close, true)
  root.append(backdrop)
  closeButton.focus()

  let kind: ViewKind = 'resumo'
  let selected = isoDay(new Date())
  let routines: PersonalRoutineOverview | null = null
  let view: AgendaView = { found: false, classesFound: false, warnings: [], today: { date: selected, entries: [] }, week: [], undated: [] }
  // As semanas lidas (a aba 7 dias pode atravessar duas) e o registro de foco dos dias mostrados (AO-92).
  let views: AgendaView[] = []
  let focus: FocusRangeView = { days: {}, now: Date.now() }

  /** Carrega a semana que contém `selected` e renderiza. */
  const render = async (date?: string, silent = false): Promise<void> => {
    if (date) selected = date
    // Atualização do foco ao vivo: redesenha sem o aviso de leitura e mantém a rolagem.
    const scroll = silent ? content.scrollTop : 0
    if (!silent) content.replaceChildren(h('p', { class: 'hint' }, 'Lendo a agenda…'))
    try {
      view = await window.office.readAgendaForDate(selected)
      views = [view]
      // A aba 7 dias vai de hoje a hoje+6: se isso passa para a semana seguinte, lê também a dela.
      const last = addDays(selected, 6)
      if (kind === 'semana' && !view.week.some((day) => day.date === last)) views.push(await window.office.readAgendaForDate(last))
      const span = kind === 'resumo' ? weekDates(selected) : kind === 'dia' ? [selected] : [selected, last]
      // Sem o registro (erro ou versão antiga), a agenda continua: só o tempo fica de fora.
      focus = await window.office.readFocusLog(span[0]!, span[span.length - 1]!).catch(() => ({ days: {}, now: Date.now() }))
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
      agendaHead(
        kind,
        selected,
        (k) => {
          kind = k
          void render()
        },
        () => moveDate(-1),
        () => moveDate(1),
        () => {
          selected = isoDay(new Date())
          void render(selected)
        },
      ),
      closeX,
    )
    modalBox.setAttribute('aria-labelledby', 'agenda-modal-title')

    const now = `${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`

    // Sem arquivo nem aulas: estado vazio. Se há aulas.md, as aulas aparecem nas visualizações.
    if (!view.found && !view.classesFound) {
      content.replaceChildren(
        h(
          'div',
          { class: 'tl-empty' },
          icon('calendar', 28),
          h('b', {}, 'Nenhum compromisso'),
          h('span', {}, 'A agenda vem de agenda.md e das aulas de aulas.md no vault. Peça à Luna para marcar um compromisso.'),
        ),
      )
      return
    }

    const body: HTMLElement[] = []
    if (kind === 'resumo') {
      body.push(...resumo(view, routines, focus, selected))
    } else if (kind === 'dia') {
      const weekDay = view.week.find((day) => day.date === selected) ?? view.today
      const segs = focus.days[selected] ?? []
      const untimed = weekDay.entries.filter((entry) => entry.kind === 'unknown').map((entry) => entry.text)
      if (weekDay.entries.length === 0 && !untimed.length && !segs.length) {
        body.push(
          h(
            'div',
            { class: 'tl-empty' },
            icon('calendar', 28),
            h('b', {}, 'Nenhum compromisso para hoje.'),
            h('span', {}, 'Nada marcado para este dia.'),
          ),
        )
      } else {
        const title = selected === isoDay(new Date()) ? 'Tempo por tarefa hoje' : `Tempo por tarefa · ${weekdayShortOf(selected)} ${selected.slice(8, 10)}/${selected.slice(5, 7)}`
        const agendaCount = weekDay.entries.filter((entry) => entry.kind === 'commitment' || entry.kind === 'class').length
        body.push(
          h(
            'div',
            { class: 'tl-day-wrap' },
            h(
              'div',
              { class: 'tl-day-main' },
              h('div', { class: 'tl-tl-head' }, h('span', { class: 'grow' }), h('div', { class: 'tl-tl-legend' }, ...dayLegendItems())),
              dayLine(weekDay, now, segs),
            ),
            timePanel(title, segs, agendaCount),
          ),
        )
      }
    } else {
      const dates = Array.from({ length: 7 }, (_, i) => addDays(selected, i))
      const days = collectDays(views, dates)
      const today = isoDay(new Date())
      if (!days.some((day) => day.entries.length > 0) && !dates.some((date) => (focus.days[date] ?? []).length > 0)) {
        body.push(
          h(
            'div',
            { class: 'tl-empty' },
            icon('calendar', 28),
            h('b', {}, 'Sem itens nestes 7 dias.'),
            h('span', {}, 'Não há compromissos, aulas ou tarefas agendadas neste período.'),
          ),
        )
      } else {
        const columns: WeekColumn[] = days.map((day) => {
          const segs = focus.days[day.date] ?? []
          const events = gridEvents(day, new Set(segs.map((s) => s.taskId.toLowerCase())))
          return {
            date: day.date,
            head: `${weekdayShortOf(day.date)}${day.date === today ? ' · hoje' : ''}`,
            num: day.date.slice(8, 10),
            today: day.date === today,
            events,
            segs,
            count: events.filter((ev) => ev.kind === 'evento' || ev.kind === 'aula').length,
          }
        })
        body.push(
          h('div', { class: 'tl-tl-head' }, h('span', { class: 'grow' }), h('div', { class: 'tl-tl-legend' }, ...dayLegendItems())),
          sevenDays(columns, mins(now), KIND_LABEL),
        )
      }
    }
    content.replaceChildren(...body)
    content.scrollTop = scroll
  }

  const moveDate = (delta: number): void => {
    const step = kind === 'dia' ? 1 : 7
    void render(addDays(selected, step * delta))
  }

  let refreshing = false
  const refresh = (): void => {
    if (refreshing || !backdrop.isConnected) return
    refreshing = true
    void render(undefined, true).finally(() => {
      refreshing = false
    })
  }
  stopEvents = window.office.onEvent((e) => {
    if (e.type === 'focusLog') refresh()
  })
  timers.clock = setInterval(() => {
    if (Object.values(focus.days).some((list) => list.some((seg) => seg.running))) refresh()
  }, 30_000)

  void render()
}
