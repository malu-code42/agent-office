/**
 * Peças de tela da agenda com tempo registrado (AO-92): cartão de tarefa com a faixa de pomodoros, painel
 * "Tempo por tarefa", foco da semana e a grade de 7 dias. Só monta DOM a partir de dados já preparados por
 * agenda-time.ts (as contas ficam lá, testadas); a cor de cada tarefa vem de classes `tl-tk-*` em agenda.css.
 */
import { focusByHourTask, summarizeDay, type DaySummary, type FocusSegment, type RangeSummary, type TaskTotal } from '@shared/focusLog'
import { layoutDayEvents, type DayEventLayout } from './agenda-day-layout'
import {
  dayInputs,
  focusShares,
  formatFocus,
  hourWindow,
  longestTask,
  sharedRange,
  taskBlocks,
  taskColorClass,
  weekAverage,
  type TaskBlock,
} from './agenda-time'
import { h } from './dom'

/** Evento da agenda já pronto para a grade (aula, compromisso, tarefa marcada). */
export type GridEvent = { at: string; t: string; kind: string; conflict?: boolean }

export const POMODOROS_LABEL = (n: number): string => `${n} ${n === 1 ? 'pomodoro' : 'pomodoros'}`

/** Cartão de uma tarefa feita no Timer: faixa lateral de pomodoros, título e tempo; tracejado quando está em andamento. */
export function taskCard(block: TaskBlock, spot: DayEventLayout, from: number, pxPerMinute: number, compact = false): HTMLElement {
  const width = `calc(${100 / spot.columns}% - 4px)`
  const left = `calc(${(spot.column * 100) / spot.columns}% + 2px)`
  const total = block.parts.reduce((a, p) => a + p.ms, 0) || 1
  const summary = block.running
    ? `${formatFocus(block.focusMs)} · em andamento`
    : `${block.pomodoros ? POMODOROS_LABEL(block.pomodoros) + ' · ' : ''}${formatFocus(block.focusMs)} de foco`
  return h(
    'div',
    {
      class: `tl-dv-ev tl-task ${taskColorClass(block.taskId, block.running)}${block.running ? ' running' : ''}${compact ? ' compact' : ''}`,
      style: `left:${left};width:${width};top:${(spot.startMin - from) * pxPerMinute}px;height:${spot.height * pxPerMinute}px`,
      role: 'listitem',
      'aria-label': `Tarefa ${block.taskText}: ${summary}${block.done ? '. Concluída.' : ''}`,
    },
    h(
      'span',
      { class: 'tl-strip', 'aria-hidden': 'true' },
      ...block.parts.map((p) => h('i', { class: `tl-strip-${p.kind}`, style: `flex:${p.ms / total}` })),
    ),
    h('div', { class: 'tl-dv-title' }, block.taskText),
    compact ? null : h('div', { class: 'tl-dv-note' }, summary),
  )
}

/** Quadrados de pomodoro de uma linha: um cheio por bloco de 25 min; um tracejado para o que está rodando ou sobra. */
function squares(t: TaskTotal): HTMLElement {
  const full = Math.min(t.pomodoros, 12)
  return h(
    'span',
    { class: `tl-sqs ${taskColorClass(t.taskId, t.running)}`, 'aria-hidden': 'true' },
    ...Array.from({ length: full }, () => h('i', { class: 'tl-sq' })),
    t.pomodoros > 12 ? h('small', {}, `+${t.pomodoros - 12}`) : null,
    t.running || t.partialMs > 0 ? h('i', { class: 'tl-sq part' }) : null,
  )
}

/** Painel "Tempo por tarefa" do dia: foco total, pomodoros, divisão, linha por tarefa e foco por hora. */
export function timePanel(title: string, segs: FocusSegment[], agendaCount: number): HTMLElement {
  const day: DaySummary = summarizeDay(segs)
  const running = day.tasks.filter((t) => t.running).length
  const withFocus = day.tasks.filter((t) => t.focusMs > 0)
  const shares = focusShares(withFocus)
  const hours = focusByHourTask(segs)
  const win = hourWindow(hours)
  const nameOf = new Map(day.tasks.map((t) => [t.taskId, t]))
  const peak = hours.reduce((best, r) => (r.totalMs > best ? r.totalMs : best), 0)
  const peakHours = hours.filter((r) => r.totalMs === peak && peak > 0).map((r) => `${r.hour}h`)

  const kpi = (value: string, label: string) => h('div', { class: 'tl-kpi' }, h('b', {}, value), h('span', {}, label))

  return h(
    'aside',
    { class: 'tl-tpanel', 'aria-label': title },
    h('h3', { class: 'tl-tpanel-title' }, title),
    h(
      'div',
      { class: 'tl-kpis2' },
      kpi(formatFocus(day.focusMs), 'de foco'),
      kpi(running ? `${day.pomodoros}+${running}` : String(day.pomodoros), running ? `pomodoros (${running} em curso)` : 'pomodoros'),
    ),
    withFocus.length
      ? h(
          'div',
          { class: 'tl-tpanel-sec' },
          h('div', { class: 'tl-sec' }, 'COMO O FOCO SE DIVIDIU'),
          h(
            'div',
            {
              class: 'tl-split',
              role: 'img',
              'aria-label': `Divisão do foco: ${withFocus.map((t, i) => `${t.taskText} ${shares[i]!.pct}%`).join(', ')}`,
            },
            ...withFocus.map((t) =>
              h('span', {
                class: taskColorClass(t.taskId, t.running),
                style: `flex:${t.focusMs}`,
                title: `${t.taskText}: ${formatFocus(t.focusMs)}`,
              }),
            ),
          ),
          h('div', { class: 'tl-split-pct' }, ...shares.map((s) => h('span', {}, `${s.pct}%`))),
        )
      : null,
    h(
      'div',
      { class: 'tl-tpanel-sec' },
      h('div', { class: 'tl-sec' }, 'POR TAREFA'),
      day.tasks.length
        ? h(
            'ul',
            { class: 'tl-trows' },
            ...day.tasks.map((t) =>
              h(
                'li',
                { class: taskColorClass(t.taskId, t.running) },
                h('i', { class: 'tl-dot' }),
                h('span', { class: 'tl-trow-name' }, t.taskText, t.running ? h('small', {}, ' em curso') : null),
                squares(t),
                h('b', { class: 'tl-trow-time' }, formatFocus(t.focusMs)),
              ),
            ),
          )
        : h('p', { class: 'tl-sub' }, 'Nenhum foco registrado neste dia. Inicie uma tarefa no Timer da barra.'),
      day.tasks.length
        ? h('div', { class: 'tl-legend-sq' }, h('i', { class: 'tl-sq key' }), '1 quadrado = 1 pomodoro de 25 min de foco')
        : null,
    ),
    win
      ? h(
          'div',
          { class: 'tl-tpanel-sec tl-hours-sec' },
          h('div', { class: 'tl-sec' }, 'FOCO POR HORA'),
          h(
            'div',
            {
              class: 'tl-hours',
              role: 'img',
              'aria-label': `Foco por hora: ${hours.map((r) => `${r.hour}h ${Math.round(r.totalMs / 60_000)} min`).join(', ')}`,
            },
            h(
              'div',
              { class: 'tl-hours-cols', style: `--cols:${win.to - win.from + 1}` },
              ...Array.from({ length: win.to - win.from + 1 }, (_, i) => {
                const row = hours.find((r) => r.hour === win.from + i)
                return h(
                  'div',
                  { class: 'tl-hour-col' },
                  row
                    ? h(
                        'div',
                        { class: 'tl-hour-bar', style: `height:${Math.min(100, (row.totalMs / 3_600_000) * 100)}%` },
                        ...row.parts.map((p) => {
                          const t = nameOf.get(p.taskId)
                          return h('i', { class: taskColorClass(p.taskId, !!t?.running), style: `flex:${p.ms}` })
                        }),
                      )
                    : null,
                )
              }),
            ),
            h(
              'div',
              { class: 'tl-hours-axis', style: `--cols:${win.to - win.from + 1}` },
              ...Array.from({ length: win.to - win.from + 1 }, (_, i) => h('span', {}, `${win.from + i}h`)),
            ),
          ),
          h(
            'p',
            { class: 'tl-sub' },
            `Minutos de foco em cada hora. Hora mais cheia: ${peakHours.join(', ')} (${Math.round(peak / 60_000)} min).`,
          ),
        )
      : null,
    h(
      'div',
      { class: 'tl-tpanel-foot' },
      'Total com pausas: ',
      h('b', {}, formatFocus(day.focusMs + day.pauseMs)),
      ' · compromissos e aulas: ',
      h('b', {}, String(agendaCount)),
    ),
  )
}

/** Foco da semana (aba Resumo): números, barras por dia divididas por tarefa, ranking e o resumo de hoje. */
export function weekFocus(
  summary: RangeSummary,
  labels: { date: string; label: string; today: boolean }[],
  todayCommitments: number,
  todayDate: string,
): HTMLElement {
  const maxDay = Math.max(1, ...summary.days.map((d) => d.focusMs))
  const todaySummary = summary.days.find((d) => d.date === todayDate)
  const running = (todaySummary?.tasks ?? []).filter((t) => t.running).length
  const longest = todaySummary ? longestTask(todaySummary.tasks) : undefined
  const maxRank = Math.max(1, ...summary.ranking.map((r) => r.focusMs))
  const kpi = (value: string, label: string) => h('div', { class: 'tl-kpi' }, h('b', {}, value), h('span', {}, label))

  return h(
    'section',
    { class: 'tl-fw', 'aria-label': 'Foco da semana' },
    h(
      'div',
      { class: 'tl-kpis4' },
      kpi(formatFocus(summary.focusMs), 'de foco na semana'),
      kpi(String(summary.pomodoros), 'pomodoros'),
      kpi(String(summary.doneTasks), 'tarefas concluídas'),
      kpi(formatFocus(weekAverage(summary)), 'de foco por dia, em média'),
    ),
    h(
      'div',
      { class: 'tl-dash-card' },
      h('div', { class: 'tl-sec' }, 'FOCO POR DIA, DIVIDIDO POR TAREFA'),
      h(
        'div',
        {
          class: 'tl-fw-days',
          role: 'img',
          'aria-label': `Foco por dia: ${summary.days.map((d, i) => `${labels[i]!.label} ${formatFocus(d.focusMs)}`).join(', ')}`,
        },
        ...summary.days.map((d, i) =>
          h(
            'div',
            { class: `tl-fw-col${labels[i]!.today ? ' today' : ''}` },
            h('span', { class: 'tl-fw-val' }, d.focusMs ? formatFocus(d.focusMs) : '0'),
            h(
              'div',
              { class: 'tl-fw-plot' },
              d.focusMs
                ? h(
                    'div',
                    { class: 'tl-fw-stack', style: `height:${Math.max(4, (d.focusMs / maxDay) * 100)}%` },
                    ...d.tasks
                      .filter((t) => t.focusMs > 0)
                      .map((t) =>
                        h('i', {
                          class: taskColorClass(t.taskId, t.running),
                          style: `flex:${t.focusMs}`,
                          title: `${t.taskText}: ${formatFocus(t.focusMs)}`,
                        }),
                      ),
                  )
                : h('div', { class: 'tl-fw-stack empty' }),
            ),
            h('span', { class: 'tl-fw-day' }, labels[i]!.label),
          ),
        ),
      ),
    ),
    h(
      'div',
      { class: 'tl-fw-low' },
      h(
        'div',
        { class: 'tl-dash-card' },
        h('div', { class: 'tl-sec' }, 'TEMPO POR TAREFA NA SEMANA'),
        summary.ranking.length
          ? h(
              'ul',
              { class: 'tl-rank' },
              ...summary.ranking.slice(0, 8).map((r) => {
                const live = summary.days.some((d) => d.tasks.some((t) => t.taskId === r.taskId && t.running))
                return h(
                  'li',
                  { class: taskColorClass(r.taskId, live) },
                  h('i', { class: 'tl-dot' }),
                  h('span', { class: 'tl-rank-name' }, r.taskText, live ? h('small', {}, ' · em curso') : null),
                  h('span', { class: 'tl-rank-bar' }, h('i', { style: `width:${Math.max(3, (r.focusMs / maxRank) * 100)}%` })),
                  h('b', { class: 'tl-trow-time' }, formatFocus(r.focusMs)),
                )
              }),
            )
          : h('p', { class: 'tl-sub' }, 'Nenhum foco registrado nesta semana.'),
      ),
      h(
        'div',
        { class: 'tl-dash-card' },
        h('div', { class: 'tl-sec' }, 'HOJE, DE RELANCE'),
        h(
          'dl',
          { class: 'tl-relance' },
          h('dt', {}, 'Foco hoje'),
          h('dd', {}, formatFocus(todaySummary?.focusMs ?? 0)),
          h('dt', {}, 'Pomodoros'),
          h('dd', {}, running ? `${todaySummary?.pomodoros ?? 0} + ${running} em curso` : String(todaySummary?.pomodoros ?? 0)),
          h('dt', {}, 'Compromissos'),
          h('dd', {}, String(todayCommitments)),
          h('dt', {}, 'Tarefa mais longa'),
          h('dd', {}, longest && longest.focusMs > 0 ? `${longest.taskText} · ${formatFocus(longest.focusMs)}` : '—'),
        ),
      ),
    ),
  )
}

export type WeekColumn = {
  date: string
  head: string
  num: string
  today: boolean
  events: GridEvent[]
  segs: FocusSegment[]
  /** "7 eventos" etc., para a linha de baixo quando o dia não tem foco. */
  count: number
}

/** Escala vertical da grade de 7 dias, em px por minuto (a de 1 dia é 1,6; aqui cabem sete colunas em pé). */
export const WEEK_PX_PER_MINUTE = 0.8

const hh = (min: number): string => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:00`

/** Grade de 7 dias (hoje mais os 6 seguintes): uma coluna por dia na mesma escala, com o foco do dia embaixo. */
export function sevenDays(columns: WeekColumn[], nowMin: number | null, kindLabel: Record<string, string>): HTMLElement {
  const perDay = columns.map((c) => {
    const blocks = taskBlocks(c.segs)
    const inputs = dayInputs(
      c.events.map((e) => ({ at: e.at })),
      blocks,
    )
    return { c, blocks, layout: layoutDayEvents(inputs) }
  })
  const range = sharedRange(perDay.map((p) => p.layout))
  const hours = Array.from({ length: Math.floor((range.to - range.from) / 60) + 1 }, (_, i) => range.from / 60 + i)
  const height = (range.to - range.from) * WEEK_PX_PER_MINUTE
  const lines = hours.map((x) =>
    h('i', { class: 'tl-w7-line', style: `top:${(x * 60 - range.from) * WEEK_PX_PER_MINUTE}px`, 'aria-hidden': 'true' }),
  )

  return h(
    'div',
    { class: 'tl-w7', role: 'group', 'aria-label': 'Linha do tempo dos próximos sete dias' },
    h(
      'div',
      { class: 'tl-w7-row tl-w7-head' },
      h('span', {}),
      ...columns.map((c) => h('div', { class: `tl-w7-hd${c.today ? ' today' : ''}` }, c.head, h('b', {}, c.num))),
    ),
    h(
      'div',
      { class: 'tl-w7-row' },
      h(
        'div',
        { class: 'tl-w7-axis', style: `height:${height}px`, 'aria-hidden': 'true' },
        ...hours.map((x) => h('span', { style: `top:${(x * 60 - range.from) * WEEK_PX_PER_MINUTE - 7}px` }, hh(x * 60))),
      ),
      ...perDay.map(({ c, blocks, layout }) => {
        const nEv = c.events.length
        return h(
          'div',
          { class: `tl-w7-day${c.today ? ' today' : ''}`, style: `height:${height}px`, role: 'list', 'aria-label': `${c.head} ${c.num}` },
          ...lines,
          ...c.events.map((ev, i) => {
            const spot = layout.events[i]!
            return h(
              'div',
              {
                class: `tl-w7-ev tl-dv-${ev.kind}${ev.conflict ? ' conflict' : ''}`,
                style: `left:calc(${(spot.column * 100) / spot.columns}% + 2px);width:calc(${100 / spot.columns}% - 4px);top:${(spot.startMin - range.from) * WEEK_PX_PER_MINUTE}px;height:${spot.height * WEEK_PX_PER_MINUTE}px`,
                role: 'listitem',
                title: `${ev.at} · ${kindLabel[ev.kind] ?? ev.kind}: ${ev.t}`,
                'aria-label': `${ev.at} ${kindLabel[ev.kind] ?? ev.kind}: ${ev.t}${ev.conflict ? '. Conflito de horário.' : ''}`,
              },
              h('b', {}, ev.at),
              h('span', {}, ev.t),
            )
          }),
          ...blocks.map((b, i) => taskCard(b, layout.events[nEv + i]!, range.from, WEEK_PX_PER_MINUTE, true)),
          c.today && nowMin !== null && nowMin >= range.from && nowMin <= range.to
            ? h('i', { class: 'tl-w7-now', style: `top:${(nowMin - range.from) * WEEK_PX_PER_MINUTE}px`, title: 'Agora' })
            : null,
        )
      }),
    ),
    h(
      'div',
      { class: 'tl-w7-row tl-w7-foot' },
      h('span', { class: 'tl-w7-foot-l' }, 'foco'),
      ...perDay.map(({ c }) => {
        const day = summarizeDay(c.segs)
        const run = day.tasks.filter((t) => t.running).length
        return h(
          'div',
          { class: `tl-w7-fo${c.today ? ' today' : ''}` },
          h('b', {}, day.focusMs ? formatFocus(day.focusMs) : '—'),
          h(
            'span',
            {},
            day.focusMs
              ? `${day.pomodoros}${run ? `+${run}` : ''} pom · ${c.count} compr.`
              : c.count
                ? `${c.count} ${c.count === 1 ? 'evento' : 'eventos'}`
                : 'sem eventos',
          ),
        )
      }),
    ),
  )
}
