import type { ProposalOperation } from '@shared/proposals'
import type { StudyCycleState } from '@shared/study-cycle'
import type {
  ReviewChoices,
  ReviewFocusRow,
  ReviewPostpone,
  ReviewView,
} from '@shared/review'
import {
  REVIEW_STEPS,
  REVIEW_STEP_HINTS,
  REVIEW_STEP_TITLES,
  describeReviewOperations,
  reviewOperations,
  staleText,
} from '@shared/review'
import { h } from './dom'
import { announce, focusedKey, refocusKey } from './a11y'
import { cleanError } from './modals/common'
import { FocusKind, Pending, pendingChoices, restoreChoices } from './review-chat-choices'

type Toast = (text: string, kind?: 'info' | 'ok' | 'err') => void

const POSTPONE_LABELS: { option: ReviewPostpone; label: string }[] = [
  { option: 1, label: 'Adiar 1 dia' },
  { option: 2, label: 'Adiar 2 dias' },
  { option: 3, label: 'Adiar 3 dias' },
  { option: 7, label: 'Adiar 1 semana' },
  { option: 'dispensar', label: 'Dispensar hoje' },
]

const CHOICE_LABELS: { kind: FocusKind; label: string }[] = [
  { kind: 'continuar', label: 'Continuar' },
  { kind: 'reagendar', label: 'Reagendar' },
  { kind: 'revisar', label: 'Revisar' },
  { kind: 'descartar', label: 'Descartar' },
]

const STAGE_LABELS: Record<string, string> = {
  diagnosis: 'Diagnóstico',
  'review-required': 'Revisão de erros e dúvidas',
  practice: 'Prática e fontes',
  'retest-ready': 'Pronto para reteste',
  retest: 'Reteste',
  completed: 'Concluído',
}

const dayPt = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

/** The ruler of the four steps shown on every card. */
const stepItems = (current: number): HTMLElement[] =>
  REVIEW_STEPS.map((s, i) =>
    h(
      'li',
      {
        class: 'review-step',
        'aria-current': i === current ? 'step' : undefined,
        'data-done': String(i < current),
      },
      h('span', { class: 'review-step-num' }, String(i + 1)),
      REVIEW_STEP_TITLES[s],
    ),
  )

/** One focused task: its title, list, the stale nudge and its choice buttons. */
const focusRow = (
  row: ReviewFocusRow,
  pendingById: Map<string, Pending>,
  save: () => void,
  render: () => void,
): HTMLElement => {
  if (row.missing) {
    return h(
      'div',
      { class: 'review-task review-task-missing' },
      h('div', { class: 'review-task-title' }, `Tarefa sumida do tarefas.md (${row.id})`),
      h('div', { class: 'field-hint' }, 'Ela não aparece mais no arquivo. Tire-a do foco pelo painel de foco.'),
    )
  }
  const p = pendingById.get(row.id) ?? { kind: 'continuar', date: '', reason: '' }
  const set = (kind: FocusKind) => {
    pendingById.set(row.id, { ...p, kind })
    save()
    render()
  }
  const detail: HTMLElement[] = []
  if (p.kind === 'reagendar') {
    detail.push(
      h(
        'label',
        { class: 'review-detail' },
        h('span', { class: 'field-label' }, 'Nova data'),
        h('input', {
          class: 'input',
          type: 'date',
          value: p.date,
          'aria-label': `Nova data de ${row.title}`,
          'data-focus-key': `review-date-${row.id}`,
          onchange: (e: Event) => {
            pendingById.set(row.id, { ...p, date: (e.target as HTMLInputElement).value })
            save()
            render()
          },
        }),
      ),
    )
  }
  if (p.kind === 'descartar') {
    detail.push(
      h(
        'label',
        { class: 'review-detail' },
        h('span', { class: 'field-label' }, 'Motivo do descarte'),
        h('input', {
          class: 'input',
          type: 'text',
          value: p.reason,
          maxlength: 1000,
          'aria-label': `Motivo para descartar ${row.title}`,
          'data-focus-key': `review-reason-${row.id}`,
          onchange: (e: Event) => {
            pendingById.set(row.id, { ...p, reason: (e.target as HTMLInputElement).value })
            save()
            render()
          },
        }),
      ),
    )
  }
  return h(
    'div',
    { class: 'review-task' },
    h('div', { class: 'review-task-title' }, row.title, h('span', { class: 'review-task-list' }, row.list)),
    row.stale ? h('div', { class: 'review-suggest' }, staleText()) : null,
    h(
      'div',
      { class: 'review-choices', role: 'group', 'aria-label': `Escolha para ${row.title}` },
      ...CHOICE_LABELS.map(({ kind, label }) =>
        h('button', {
          class: 'btn btn-small',
          type: 'button',
          'aria-pressed': String(p.kind === kind),
          'data-focus-key': `review-${row.id}-${kind}`,
          onclick: () => set(kind),
        }, label),
      ),
    ),
    ...detail,
  )
}

/** Read-only card summarizing the active study cycle (Estudos e andares step). */
function studyCycleCard(studyCycle: StudyCycleState | null): HTMLElement[] {
  const active = studyCycle?.activeId ? studyCycle.cycles.find((c) => c.id === studyCycle.activeId) : null
  if (!active) {
    return [
      h('p', { class: 'field-hint' }, 'Não há um ciclo de estudos ativo. Crie um ciclo no tópico atual para acompanhar o diagnóstico, a prática e o reteste.'),
    ]
  }
  const answered = active.questions.filter((q) => q.assessment).length
  return [
    h(
      'div',
      { class: 'review-task' },
      h('div', { class: 'review-task-title' }, `Ciclo de estudos: ${active.topic}`),
      h('div', { class: 'field-hint' }, `Etapa: ${STAGE_LABELS[active.stage] ?? active.stage}`),
      h('div', { class: 'field-hint' }, `Questões respondidas: ${answered} de ${active.questions.length}`),
    ),
  ]
}

/** Renders the whole daily review as Luna chat cards, appended to a container (e.g. Luna's panel feed).
 *  Nothing is written before explicit confirmation; choices are saved as a draft on every interaction. */
export function reviewChat(
  view: ReviewView,
  opts: {
    toast: Toast
    onConfirmed: () => void
    onPostponed: (next: string) => void
    onClose: () => void
    studyCycle?: StudyCycleState | null
  },
): HTMLElement {
  const { toast, onConfirmed, onPostponed, onClose, studyCycle = null } = opts
  const focusIds = view.focus.map((r) => r.id)
  const pendingById = restoreChoices(view.choices)
  let step = Math.min(Math.max(view.step, 0), REVIEW_STEPS.length - 1)
  let busy = false

  const container = h('div', { class: 'review-chat', 'aria-label': 'Revisão do dia' })

  const titleOf = (id: string) => view.focus.find((r) => r.id === id)?.title

  /** Only complete choices are saved/applied. Pure over the pending map. */
  const choicesNow = (): ReviewChoices => pendingChoices(pendingById)

  const save = (): void => {
    const stepNum = step
    const choices: ReviewChoices = choicesNow()
    void window.office.saveReviewDraft(stepNum, choices).catch((err) => toast(cleanError(err), 'err'))
  }

  const plan = (): { ops: ProposalOperation[]; problems: string[] } => {
    const problems: string[] = []
    const choices = choicesNow()
    for (const id of focusIds) {
      const p = pendingById.get(id)
      if (p?.kind === 'reagendar' && !p.date) problems.push(`Escolha a nova data de “${titleOf(id) ?? id}”.`)
    }
    let ops: ProposalOperation[] = []
    try {
      ops = reviewOperations(choices, focusIds, titleOf)
    } catch (err) {
      problems.push(cleanError(err))
    }
    return { ops, problems }
  }

  const stepBody = (name: (typeof REVIEW_STEPS)[number], current: { ops: ProposalOperation[]; problems: string[] }): HTMLElement[] => {
    if (name === 'agenda') {
      if (!view.agenda.found) return [h('p', { class: 'field-hint' }, 'Não encontrei o agenda.md no vault, então não há compromissos para mostrar.')]
      if (!view.agenda.items.length) return [h('p', {}, 'Nenhum compromisso para hoje.')]
      return [h('ul', { class: 'review-list' }, ...view.agenda.items.map((i) => h('li', {}, `${i.time} ${i.title}`)))]
    }
    if (name === 'foco') {
      if (!view.focus.length) return [h('p', { class: 'field-hint' }, 'Nenhuma tarefa em foco. Escolha tarefas no quadro para elas aparecerem aqui.')]
      return view.focus.map((row) => focusRow(row, pendingById, save, render))
    }
    if (name === 'estudos') return studyCycleCard(studyCycle)
    // confirmar
    if (current.problems.length) {
      return [h('ul', { class: 'review-problems', role: 'alert' }, ...current.problems.map((t) => h('li', {}, t)))]
    }
    const kept = view.focus.filter((r) => !r.missing && (pendingById.get(r.id)?.kind === 'continuar' || pendingById.get(r.id)?.kind === 'revisar'))
    const keptLines = kept.length
      ? [
          h('p', { class: 'field-hint' }, 'Sem operação:'),
          h(
            'ul',
            { class: 'review-list' },
            ...kept.map((r) => {
              const k = pendingById.get(r.id)?.kind === 'revisar' ? 'revisar, sem mudança' : 'continua como está'
              return h('li', {}, `“${r.title}”: ${k}`)
            }),
          ),
        ]
      : []
    if (!current.ops.length) return [h('p', {}, 'Nada muda. Todas as tarefas continuam como estão.'), ...keptLines]
    return [
      h('p', { class: 'hint' }, 'Estas são todas as operações, na ordem em que rodam:'),
      h('ol', { class: 'proposal-ops' }, ...describeReviewOperations(current.ops, titleOf).map((t) => h('li', {}, t))),
      h('p', { class: 'field-hint' }, 'Todas são aplicadas juntas: se uma falhar, nenhuma é aplicada.'),
      ...keptLines,
    ]
  }

  const go = (to: number) => {
    step = to
    save()
    render()
  }

  const confirm = async () => {
    if (busy) return
    busy = true
    try {
      const r = await window.office.confirmReview(choicesNow())
      toast(r.applied ? `Revisão confirmada: ${r.applied} operação${r.applied === 1 ? '' : 's'} aplicada.` : 'Revisão confirmada. Nada mudou.', 'ok')
      onConfirmed()
    } catch (err) {
      toast(cleanError(err), 'err')
      busy = false
      render()
    }
  }

  const postpone = async (option: ReviewPostpone) => {
    try {
      const { next } = await window.office.postponeReview(option)
      toast(option === 'dispensar' ? 'Revisão dispensada por hoje.' : `Revisão adiada até ${dayPt(next)}.`, 'info')
      onPostponed(next)
    } catch (err) {
      toast(cleanError(err), 'err')
    }
  }

  const button = (label: string, onclick: () => void, cls = 'btn'): HTMLButtonElement =>
    h('button', { class: cls, type: 'button', onclick }, label)

  const footer = (current: { ops: ProposalOperation[]; problems: string[] }): HTMLElement[] => {
    const out: HTMLElement[] = []
    if (step > 0) out.push(button('Voltar', () => go(step - 1), 'btn-small'))
    out.push(button('Fechar', () => void onClose(), 'btn-small'))
    out.push(h('div', { class: 'grow' }))
    if (step < REVIEW_STEPS.length - 1) {
      out.push(button('Próximo passo', () => go(step + 1), 'btn btn-primary'))
    } else {
      const n = current.ops.length
      const label = n ? `Confirmar ${n} operação${n === 1 ? '' : 's'}` : 'Confirmar'
      const b = button(label, () => void confirm(), 'btn btn-primary')
      b.disabled = busy || current.problems.length > 0
      out.push(b)
      out.push(button('Ajustar', () => go(0), 'btn-small'))
    }
    // Adiar / dispensar: saem da revisão sem aplicar nada; a oferta volta no dia definido.
    out.push(
      h('div', { class: 'review-postpone' }),
      ...POSTPONE_LABELS.map(({ option, label }) => button(label, () => void postpone(option), 'btn-small')),
    )
    return out
  }

  const render = (): void => {
    const key = focusedKey(container)
    const current = plan()
    const name = REVIEW_STEPS[step]
    container.replaceChildren(
      h('div', { class: 'review-chat-card' }, [
        h('ol', { class: 'review-steps', 'aria-label': 'Passos da revisão' }, ...stepItems(step)),
        h('p', { class: 'review-hint' }, REVIEW_STEP_HINTS[name]),
        h('div', { class: 'review-content' }, ...stepBody(name, current)),
        h('div', { class: 'review-chat-foot' }, ...footer(current)),
      ]),
    )
    if (key !== undefined) refocusKey(container, key)
  }

  render()
  announce(`Revisão do dia: passo ${REVIEW_STEP_TITLES[REVIEW_STEPS[step]]}.`)
  return container
}
