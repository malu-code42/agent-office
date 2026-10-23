import { dayPt, type ProposalOperation } from '@shared/proposals'
import { ARCHIVE_LIST, dayLabel, taskDraftProblem } from '@shared/tasks'
import type { RoutineCandidate } from '@shared/routine-personal'
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
import { closeReviewAfterSave, createReviewDraftSaver } from './review-draft'
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

interface RoutineAddition {
  objective: string
  editing: boolean
  list?: string
  submitted?: { id: string; title: string; list: string; date: string; time?: string }
  created?: { id: string; line?: number }
  focused: boolean
  busy: boolean
  error?: string
}

/** In-memory retry cache only; no routine-occurrence history is persisted. */
const pendingRoutineRetries = new Map<string, RoutineAddition>()

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

const OFFER = 'A Luna propõe revisar o seu dia: agenda, foco, estudos e andares.'
const OFFER_NOTE = 'Nada muda sem a sua confirmação no fim. Se quiser, adie a revisão.'

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`
const TASK_ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

/** A retry token, not a secret; stable through this review window so createTask can be idempotent. */
function routineTaskId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  return `t${Array.from(bytes, (byte) => TASK_ID_ALPHABET[byte % TASK_ID_ALPHABET.length]).join('')}`
}

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
  let starting = false
  const leave = async (option: ReviewPostpone) => {
    if (done || starting) return
    done = true
    el.remove()
    try {
      const { next } = await window.office.postponeReview(option)
      toast(option === 'dispensar' ? 'Revisão dispensada por hoje.' : `Revisão adiada até ${dayPt(next)}.`, 'info')
    } catch (err) {
      toast(cleanError(err), 'err')
    }
  }
  const start = async () => {
    if (done || starting) return
    starting = true
    startBtn.disabled = true
    try {
      // Persist before opening: closing immediately must still leave something to resume.
      await window.office.saveReviewDraft(0, {})
      done = true
      el.remove()
      await openReviewWizard(root, toast)
    } catch (err) {
      starting = false
      startBtn.disabled = false
      toast(cleanError(err), 'err')
    }
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
  const startBtn = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => void start() }, 'Começar')
  const el = modal(
    'Revisão do dia',
    [h('ol', { class: 'review-steps' }, ...stepItems(-1)), h('p', {}, `${OFFER} ${OFFER_NOTE}`)],
    [h('button', { class: 'btn', type: 'button', onclick: dismiss }, 'Dispensar hoje'), h('div', { class: 'grow' }), postpone, startBtn],
    dismiss,
  )
  root.append(el)
  el.querySelector<HTMLButtonElement>('.btn-primary')?.focus()
}

/** The four-step review. Opens from the offer, or from the caixa de entrada when a draft of today is waiting. */
export async function openReviewWizard(root: HTMLElement, toast: Toast): Promise<void> {
  let view: ReviewView
  let routines: RoutineCandidate[] = []
  let vaultPath = ''
  try {
    const [opened, candidates, state] = await Promise.all([
      window.office.openReview(),
      window.office.routineCandidates(),
      window.office.getState(),
    ])
    view = opened
    routines = candidates
    vaultPath = state.settings.vaultPath ?? ''
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
  const draftSaver = createReviewDraftSaver((nextStep, choices) => window.office.saveReviewDraft(nextStep, choices))
  const save = (): Promise<void> => {
    if (busy) return Promise.resolve()
    const pendingSave = draftSaver.save(step, choicesNow())
    void pendingSave.catch((err) => toast(cleanError(err), 'err'))
    return pendingSave
  }

  const stepsEl = h('ol', { class: 'review-steps' })
  const hintEl = h('p', { class: 'review-hint' })
  const content = h('div', { class: 'review-content' })
  const actions = h('div', { class: 'review-actions' })
  let busy = false
  let confirmBtn: HTMLButtonElement | undefined
  // Closing keeps the draft: a text field is saved when it changes, and the rest is saved on the way out.
  const close = async () => {
    if (busy) return
    try {
      await closeReviewAfterSave(
        save(),
        () => busy,
        () => el.remove(),
      )
    } catch {
      // save() reports the error; keep the wizard open so the user can retry.
    }
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

  // Rotinas pessoais (AO-42): acceptance needs an objective; ids stay in-memory for safe create/focus retries.
  const routineAdditions = new Map<number, RoutineAddition>()
  const retryKey = (ro: RoutineCandidate) => `${vaultPath}\u001f${view.day}\u001f${ro.line}\u001f${JSON.stringify(ro.item ?? ro.title)}`

  const additionFor = (ro: RoutineCandidate): RoutineAddition => {
    let addition = routineAdditions.get(ro.line)
    if (!addition) {
      addition = pendingRoutineRetries.get(retryKey(ro)) ?? { objective: '', editing: false, focused: false, busy: false }
      routineAdditions.set(ro.line, addition)
    }
    return addition
  }

  const routineWhen = (ro: RoutineCandidate): string | null => {
    const item = ro.item
    if (!item) return null
    const cadence = item.cadence === 'semanal' ? `semanal (${(item.days ?? []).join(', ')})` : 'diária'
    return item.time ? `${cadence} · ${item.time}` : cadence
  }

  const focusCreatedRoutine = async (ro: RoutineCandidate, addition: RoutineAddition): Promise<void> => {
    const created = addition.created
    if (!created || addition.busy) return
    addition.busy = true
    addition.error = undefined
    render()
    try {
      const board = await window.office.readTasks()
      const task = board.lists
        .flatMap((list) => list.tasks.map((entry) => ({ list: list.name, task: entry })))
        .find(({ task: entry }) => entry.id === created.id)
      if (!task || task.list === ARCHIVE_LIST || task.task.status !== 'open')
        throw new Error('A tarefa criada não está mais aberta no tarefas.md. Ela não será criada de novo.')
      const line = task.task.line
      created.line = line
      await window.office.focusTask(line)
      addition.focused = true
      pendingRoutineRetries.delete(retryKey(ro))
    } catch (err) {
      addition.error = cleanError(err)
      toast(addition.error, 'err')
    } finally {
      addition.busy = false
      render()
    }
  }

  const createRoutineTask = async (ro: RoutineCandidate, addition: RoutineAddition): Promise<void> => {
    if (addition.busy || addition.created || !addition.objective.trim() || !addition.list) return
    const item = ro.item
    if (!item) return
    const candidate = {
      title: addition.objective.trim(),
      list: addition.list,
      date: dayLabel(new Date()),
      ...(item.time ? { time: item.time } : {}),
    }
    const problem = taskDraftProblem(candidate, [addition.list])
    if (problem) {
      addition.error = problem
      render()
      return
    }
    addition.submitted ??= {
      id: routineTaskId(),
      ...candidate,
    }
    pendingRoutineRetries.set(retryKey(ro), addition)
    const draft = addition.submitted
    addition.busy = true
    addition.error = undefined
    render()
    try {
      // Refresh the writer's stale-check baseline before retrying the same idempotency key.
      const current = await window.office.readTasks()
      const existing = current.lists
        .flatMap((list) => list.tasks.map((task) => ({ list: list.name, task })))
        .find(({ task }) => task.id === draft.id)
      if (existing) {
        if (existing.list === ARCHIVE_LIST || existing.task.status !== 'open')
          throw new Error('A tarefa com este identificador já não está aberta. Ela não será criada de novo.')
        addition.created = { id: draft.id, line: existing.task.line }
      } else {
        const { id, board } = await window.office.createTask(draft)
        addition.created = { id, line: board.lists.flatMap((list) => list.tasks).find((task) => task.id === id)?.line }
      }
      addition.editing = false
      addition.busy = false
      await focusCreatedRoutine(ro, addition)
    } catch (err) {
      addition.error = cleanError(err)
      toast(addition.error, 'err')
    } finally {
      addition.busy = false
      render()
    }
  }

  /** Selecting a list only stages the draft; task creation needs the separate confirmation button. */
  const chooseRoutineList = (ro: RoutineCandidate, addition: RoutineAddition, btn: HTMLButtonElement): void => {
    if (addition.busy || addition.submitted) return
    btn.disabled = true
    btn.textContent = 'Lendo listas…'
    void (async () => {
      let names: string[]
      try {
        names = (await window.office.readTasks()).lists.map((l) => l.name).filter((n) => n !== ARCHIVE_LIST && n)
      } catch (err) {
        names = []
        toast(cleanError(err), 'err')
      }
      btn.disabled = false
      btn.textContent = addition.list ? 'Trocar lista' : 'Escolher lista'
      if (!el.isConnected) return
      if (!names.length) {
        toast('Não encontrei listas no tarefas.md para receber a rotina.', 'err')
        render()
        return
      }
      const row = btn.closest<HTMLElement>('.review-task') ?? btn.parentElement ?? btn
      openTaskMenu(
        row,
        'Escolher a lista da rotina',
        names.map((n) => ({
          text: n,
          choose: () => {
            addition.list = n
            addition.error = undefined
            render()
          },
        })),
        'Sem listas no tarefas.md.',
        btn,
      )
      btn.disabled = false
      btn.textContent = addition.list ? 'Trocar lista' : 'Escolher lista'
    })()
  }

  /** The routines of rotinas-pessoais.md for the foco step, beside the focused tasks. Null = none. */
  const routineSection = (): HTMLElement | null => {
    if (!routines.length) return null
    const rows = routines.map((ro) => {
      const title = ro.item?.title ?? ro.title ?? `Linha ${ro.line} de rotinas-pessoais.md`
      // The numbered line keeps what the file shows the user.
      const children: HTMLElement[] = [
        h('div', { class: 'review-task-title' }, title),
        ...(ro.kind === 'needsInput' && ro.reason ? [h('div', { class: 'field-hint' }, ro.reason)] : []),
      ]
      if (ro.kind === 'due') {
        const when = routineWhen(ro)
        if (when) children.push(h('div', { class: 'field-hint' }, when))
        const addition = additionFor(ro)
        if (addition.created) {
          children.push(
            h(
              'div',
              { class: 'review-suggest' },
              `Objetivo de hoje: ${addition.created.id} · ${addition.submitted?.title ?? addition.objective}`,
            ),
          )
          if (addition.focused) {
            children.push(h('div', { class: 'review-suggest' }, 'Está no foco de hoje.'))
          } else {
            children.push(
              h(
                'button',
                {
                  class: 'btn btn-small',
                  type: 'button',
                  disabled: addition.busy || undefined,
                  onclick: () => void focusCreatedRoutine(ro, addition),
                },
                addition.busy ? 'Adicionando ao foco…' : 'Tentar colocar no foco',
              ),
            )
          }
        } else if (addition.submitted) {
          children.push(
            h('div', { class: 'field-hint' }, `Objetivo definido: “${addition.submitted.title}” · lista ${addition.submitted.list}.`),
            h(
              'div',
              { class: 'field-hint' },
              addition.error ?? 'Se a confirmação anterior falhou, tente novamente; o mesmo identificador evita duplicar a tarefa.',
            ),
            h(
              'button',
              {
                class: 'btn btn-small',
                type: 'button',
                disabled: addition.busy || undefined,
                onclick: () => void createRoutineTask(ro, addition),
              },
              addition.busy ? 'Confirmando tarefa…' : 'Tentar criar e adicionar ao foco',
            ),
          )
        } else if (addition.editing) {
          const problemFor = (value: string) =>
            taskDraftProblem(
              { title: value, list: addition.list ?? '', date: dayLabel(new Date()), ...(ro.item?.time ? { time: ro.item.time } : {}) },
              addition.list ? [addition.list] : [],
            )
          const initialProblem = problemFor(addition.objective)
          const problem = h('div', { class: 'field-hint', role: 'alert' }, addition.error ?? initialProblem ?? '')
          const objective = h('textarea', {
            class: 'input',
            rows: '2',
            maxlength: '200',
            value: addition.objective,
            placeholder: 'O que você pretende fazer hoje?',
            'aria-label': `Objetivo de hoje para ${title}`,
            disabled: addition.busy || undefined,
            oninput: (event: Event) => {
              addition.objective = (event.currentTarget as HTMLTextAreaElement).value
              addition.error = undefined
              const currentProblem = problemFor(addition.objective)
              problem.textContent = currentProblem ?? ''
              create.disabled = !!currentProblem || addition.busy
            },
          }) as HTMLTextAreaElement
          const chooseList = h(
            'button',
            {
              class: 'btn btn-small',
              type: 'button',
              disabled: addition.busy || undefined,
              onclick: () => chooseRoutineList(ro, addition, chooseList),
            },
            addition.list ? `Lista: ${addition.list} · trocar` : 'Escolher lista',
          ) as HTMLButtonElement
          const create = h(
            'button',
            {
              class: 'btn btn-small btn-primary',
              type: 'button',
              disabled: !!initialProblem || addition.busy || undefined,
              onclick: () => void createRoutineTask(ro, addition),
            },
            'Criar tarefa e adicionar ao foco',
          ) as HTMLButtonElement
          children.push(
            h('label', { class: 'review-detail' }, h('span', { class: 'field-label' }, 'Objetivo de hoje'), objective),
            problem,
            chooseList,
            create,
            h(
              'button',
              {
                class: 'btn btn-small',
                type: 'button',
                disabled: addition.busy || undefined,
                onclick: () => {
                  routineAdditions.delete(ro.line)
                  render()
                },
              },
              'Cancelar',
            ),
          )
        } else {
          const btn = h(
            'button',
            {
              class: 'btn btn-small',
              type: 'button',
              onclick: () => {
                const draft = additionFor(ro)
                draft.editing = true
                render()
              },
            },
            'Definir objetivo de hoje',
          )
          children.push(btn)
        }
      } else {
        children.push(h('div', { class: 'field-hint' }, `Precisa da sua mão na linha ${ro.line} da nota antes de virar tarefa.`))
        const edit = h(
          'button',
          {
            class: 'btn btn-small',
            type: 'button',
            onclick: async () => {
              edit.disabled = true
              try {
                await window.office.openPersonalRoutines()
              } catch (err) {
                toast(cleanError(err), 'err')
              } finally {
                edit.disabled = false
              }
            },
          },
          'Abrir a nota para corrigir',
        )
        children.push(edit)
      }
      return h('div', { class: `review-task${ro.kind === 'due' ? '' : ' review-task-missing'}` }, ...children)
    })
    return h(
      'div',
      { class: 'review-foco-routines' },
      h('p', { class: 'field-hint' }, 'Rotinas pessoais de hoje (de rotinas-pessoais.md; entra no foco só com o seu clique):'),
      ...rows,
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
      const sec = routineSection()
      if (!view.focus.length)
        return [
          h('p', { class: 'field-hint' }, 'Nenhuma tarefa em foco. Escolha tarefas no quadro para elas aparecerem aqui.'),
          ...(sec ? [sec] : []),
        ]
      return [...view.focus.map(focusRow), ...(sec ? [sec] : [])]
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
      await draftSaver.drain()
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
