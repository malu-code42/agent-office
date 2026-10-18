import { dayPt, type ProposalOperation } from '@shared/proposals'
import {
  ddmmOf,
  describeReviewOperations,
  isoOfDdmm,
  REVIEW_STEP_HINTS,
  REVIEW_STEP_TITLES,
  REVIEW_STEPS,
  reviewOperations,
  staleText,
  type FocusChoice,
  type ReviewChoices,
  type ReviewFocusRow,
  type ReviewPostpone,
  type ReviewView,
} from '@shared/review'
import { h } from './dom'
import { cleanError, modal } from './modals/common'
import { openTaskMenu, type TaskMenuOption } from './tasks-move'

type Toast = (text: string, kind?: 'info' | 'ok' | 'err') => void

/**
 * The review of the day (AO-12), in four steps: Agenda, Foco, Estudos e andares, Confirmar. Nothing is written
 * before "Confirmar", which applies every choice as one proposal. Each change is kept as a draft in planning.json,
 * so closing the review loses nothing and it can be resumed the same day. No step calls an AI.
 */

/** A focused task's choice as the user is making it. A reschedule without a date is not a choice yet. */
interface Pending {
  kind: FocusChoice['kind']
  /** AAAA-MM-DD, as the date input takes it. */
  date: string
  reason: string
}

const CHOICE_LABELS: { kind: FocusChoice['kind']; label: string }[] = [
  { kind: 'continuar', label: 'Continuar' },
  { kind: 'reagendar', label: 'Reagendar' },
  { kind: 'revisar', label: 'Revisar' },
  { kind: 'descartar', label: 'Descartar' },
]

const POSTPONE_LABELS: { option: ReviewPostpone; label: string }[] = [
  { option: 1, label: '1 dia' },
  { option: 2, label: '2 dias' },
  { option: 3, label: '3 dias' },
  { option: 7, label: '1 semana' },
]

const OFFER = 'A Íris propõe revisar o seu dia: agenda, foco, estudos e andares.'
const OFFER_NOTE = 'Nada muda sem a sua confirmação no fim. Se quiser, adie a revisão.'

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/** The four steps as pills. `current` is the step on screen; on the offer it is -1, and no pill is highlighted. */
const stepItems = (current: number): HTMLElement[] =>
  REVIEW_STEPS.map((s, i) =>
    h(
      'li',
      { class: 'review-step', 'aria-current': i === current ? 'step' : undefined, 'data-done': String(i < current) },
      h('span', { class: 'review-step-num' }, String(i + 1)),
      REVIEW_STEP_TITLES[s],
    ),
  )

/** The offer of the day: shown on the first open of each local day. "Dispensar hoje" and Esc leave it for the day. */
export function openReviewOffer(root: HTMLElement, toast: Toast): void {
  let done = false
  const leave = async (option: ReviewPostpone) => {
    if (done) return
    done = true
    el.remove()
    try {
      const { next } = await window.office.postponeReview(option)
      toast(option === 'dispensar' ? 'Revisão dispensada por hoje.' : `Revisão adiada até ${dayPt(next)}.`, 'info')
    } catch (err) {
      toast(cleanError(err), 'err')
    }
  }
  const start = () => {
    if (done) return
    done = true
    el.remove()
    void openReviewWizard(root, toast)
  }
  const dismiss = () => void leave('dispensar')
  const postpone = h('div', { class: 'review-postpone' })
  const postponeBtn = h(
    'button',
    {
      class: 'btn',
      type: 'button',
      'aria-haspopup': 'menu',
      onclick: () => {
        const options: TaskMenuOption[] = POSTPONE_LABELS.map(({ option, label }) => ({ text: label, choose: () => void leave(option) }))
        openTaskMenu(postpone, 'Adiar a revisão', options, '', postponeBtn)
      },
    },
    'Adiar',
  )
  postpone.append(postponeBtn)
  const el = modal(
    'Revisão do dia',
    [h('ol', { class: 'review-steps' }, ...stepItems(-1)), h('p', {}, `${OFFER} ${OFFER_NOTE}`)],
    [
      h('button', { class: 'btn', type: 'button', onclick: dismiss }, 'Dispensar hoje'),
      h('div', { class: 'grow' }),
      postpone,
      h('button', { class: 'btn btn-primary', type: 'button', onclick: start }, 'Começar'),
    ],
    dismiss,
  )
  root.append(el)
  el.querySelector<HTMLButtonElement>('.btn-primary')?.focus()
}

/** The four-step review. Opens from the offer, or from the caixa de entrada when a draft of today is waiting. */
export async function openReviewWizard(root: HTMLElement, toast: Toast): Promise<void> {
  let view: ReviewView
  try {
    view = await window.office.openReview()
  } catch (err) {
    toast(cleanError(err), 'err')
    return
  }
  const lastStep = REVIEW_STEPS.length - 1
  let step = Math.min(Math.max(view.step, 0), lastStep)
  const titles = new Map<string, string>(view.focus.filter((r) => !r.missing).map((r): [string, string] => [r.id, r.title]))
  const titleOf = (id: string) => titles.get(id)
  const focusIds = view.focus.map((r) => r.id)
  const pending = new Map<string, Pending>()
  for (const [id, c] of Object.entries(view.choices)) {
    pending.set(id, {
      kind: c.kind,
      date: c.kind === 'reagendar' ? isoOfDdmm(c.date) : '',
      reason: c.kind === 'descartar' ? c.reason : '',
    })
  }

  /** The choices as the draft and the proposal keep them: only the ones that are complete. */
  const choicesNow = (): ReviewChoices => {
    const out: ReviewChoices = {}
    for (const [id, p] of pending) {
      if (p.kind === 'reagendar') {
        if (p.date) out[id] = { kind: 'reagendar', date: ddmmOf(p.date) }
      } else if (p.kind === 'descartar') out[id] = { kind: 'descartar', reason: p.reason }
      else if (p.kind !== 'continuar') out[id] = { kind: p.kind }
    }
    return out
  }
  const save = () => {
    void window.office.saveReviewDraft(step, choicesNow()).catch((err) => toast(cleanError(err), 'err'))
  }

  const stepsEl = h('ol', { class: 'review-steps' })
  const hintEl = h('p', { class: 'review-hint' })
  const content = h('div', { class: 'review-content' })
  const actions = h('div', { class: 'review-actions' })
  let busy = false
  let confirmBtn: HTMLButtonElement | undefined
  // Closing keeps the draft: a text field is saved when it changes, and the rest is saved on the way out.
  const close = () => {
    save()
    el.remove()
  }
  // A text field changes on blur: only the confirm button's state follows, the button itself is not rebuilt (a click would be lost).
  const edited = () => {
    save()
    if (confirmBtn) confirmBtn.disabled = busy || plan().problems.length > 0
  }

  /** One focused task: its choices as toggle buttons, with the date or the reason the choice needs. */
  const focusRow = (row: ReviewFocusRow): HTMLElement => {
    if (row.missing) {
      return h(
        'div',
        { class: 'review-task review-task-missing' },
        h('div', { class: 'review-task-title' }, `Tarefa sumida do tarefas.md (${row.id})`),
        h('div', { class: 'field-hint' }, 'Ela não aparece mais no arquivo. Tire-a do foco pelo painel de foco.'),
      )
    }
    const p: Pending = pending.get(row.id) ?? { kind: 'continuar', date: '', reason: '' }
    const set = (kind: FocusChoice['kind']) => {
      pending.set(row.id, { ...p, kind })
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
            onchange: (e: Event) => {
              pending.set(row.id, { ...p, date: (e.target as HTMLInputElement).value })
              edited()
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
            onchange: (e: Event) => {
              pending.set(row.id, { ...p, reason: (e.target as HTMLInputElement).value })
              edited()
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
          h('button', { class: 'btn btn-small', type: 'button', 'aria-pressed': String(p.kind === kind), onclick: () => set(kind) }, label),
        ),
      ),
      ...detail,
    )
  }

  /** What the Confirmar step would apply, and what stops it. */
  const plan = (): { ops: ProposalOperation[]; problems: string[] } => {
    const problems: string[] = []
    for (const id of focusIds) {
      const p = pending.get(id)
      if (p?.kind === 'reagendar' && !p.date) problems.push(`Escolha a nova data de “${titleOf(id) ?? id}”.`)
    }
    let ops: ProposalOperation[] = []
    try {
      ops = reviewOperations(choicesNow(), focusIds, titleOf)
    } catch (err) {
      problems.push(cleanError(err))
    }
    return { ops, problems }
  }

  const stepBody = (name: (typeof REVIEW_STEPS)[number], current: { ops: ProposalOperation[]; problems: string[] }): HTMLElement[] => {
    if (name === 'agenda') {
      if (!view.agenda.found)
        return [h('p', { class: 'field-hint' }, 'Não encontrei o agenda.md no vault, então não há compromissos para mostrar.')]
      if (!view.agenda.items.length) return [h('p', {}, 'Nenhum compromisso para hoje.')]
      return [h('ul', { class: 'review-list' }, ...view.agenda.items.map((i) => h('li', {}, `${i.time} ${i.title}`)))]
    }
    if (name === 'foco') {
      if (!view.focus.length)
        return [h('p', { class: 'field-hint' }, 'Nenhuma tarefa em foco. Escolha tarefas no quadro para elas aparecerem aqui.')]
      return view.focus.map(focusRow)
    }
    if (name === 'estudos') return [h('p', {}, 'Estudos e andares ficam para as próximas entregas.')]
    if (current.problems.length) {
      return [h('ul', { class: 'review-problems', role: 'alert' }, ...current.problems.map((t) => h('li', {}, t)))]
    }
    // The tasks that make no operation are listed too, so the summary covers every choice.
    const kept = view.focus.filter((r) => !r.missing && ['continuar', 'revisar'].includes(pending.get(r.id)?.kind ?? 'continuar'))
    const keptLines = kept.length
      ? [
          h('p', { class: 'field-hint' }, 'Sem operação:'),
          h(
            'ul',
            { class: 'review-list' },
            ...kept.map((r) =>
              h('li', {}, `“${r.title}”: ${pending.get(r.id)?.kind === 'revisar' ? 'revisar, sem mudança' : 'continua como está'}`),
            ),
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
      toast(
        r.applied
          ? `Revisão confirmada: ${plural(r.applied, 'operação aplicada', 'operações aplicadas')}.`
          : 'Revisão confirmada. Nada mudou.',
        'ok',
      )
      // Not close(): the draft is gone now, and saving it again would bring it back.
      el.remove()
    } catch (err) {
      // The review stays open with its choices: the draft is kept and nothing was written.
      toast(cleanError(err), 'err')
      busy = false
      render()
    }
  }

  const button = (label: string, onclick: () => void, cls = 'btn'): HTMLButtonElement =>
    h('button', { class: cls, type: 'button', onclick }, label)

  const footer = (current: { ops: ProposalOperation[]; problems: string[] }): HTMLElement[] => {
    const out: HTMLElement[] = []
    if (step > 0) out.push(button('Voltar', () => go(step - 1)))
    out.push(button('Fechar', close))
    out.push(h('div', { class: 'grow' }))
    if (step < lastStep) out.push(button('Próximo', () => go(step + 1), 'btn btn-primary'))
    else {
      const n = current.ops.length
      const label = n ? `Confirmar ${plural(n, 'operação', 'operações')}` : 'Confirmar'
      const b = button(label, () => void confirm(), 'btn btn-primary')
      b.disabled = busy || current.problems.length > 0
      confirmBtn = b
      out.push(b)
    }
    return out
  }

  const render = () => {
    const current = plan()
    stepsEl.replaceChildren(...stepItems(step))
    hintEl.textContent = REVIEW_STEP_HINTS[REVIEW_STEPS[step]]
    content.replaceChildren(...stepBody(REVIEW_STEPS[step], current))
    actions.replaceChildren(...footer(current))
  }

  const el = modal('Revisão do dia', [stepsEl, hintEl, content], [actions], close)
  root.append(el)
  render()
  actions.querySelector<HTMLButtonElement>('.btn-primary')?.focus()
}
