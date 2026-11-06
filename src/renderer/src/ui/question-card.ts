import type { AskQuestion } from '@shared/types'
import { h, icon } from './dom'
import {
  answeredCount,
  answerText,
  buildAnswers,
  canSubmit,
  createFlow,
  edit,
  goBack,
  goNext,
  isAnswered,
  setOther,
  toggleOption,
  type FlowState,
} from './question-flow'
import { splitQuestion } from './question-text'

/**
 * AO-101: the body of the AskUserQuestion card. One question: numbered steps (what happened,
 * the question, the answer). Two or more: one question at a time, step list on top, Voltar and
 * Próxima, and a review screen before sending. The answers go out in the same shape as ever
 * (question text -> chosen labels joined by ", "), through hooks.submit.
 */
export interface QuestionCardHooks {
  submit(answers: Record<string, string>): void
  /** "Agora não": the user prefers not to answer. */
  dismiss(): void
  toast(text: string, kind?: 'info' | 'ok' | 'err'): void
  /** The element that names the open question, for aria-describedby of the card. */
  described(el: HTMLElement): void
}

export interface QuestionCard {
  subtitle: string
  body: HTMLElement
  /** Footer buttons for the dialog frame; empty when the card draws its own footer (sequence). */
  buttons: HTMLElement[]
  /** Wider popup for a sequence. */
  wide: boolean
  /** Enter with no control focused. */
  onEnter(): void
}

function contextBlocks(ctx: ReturnType<typeof splitQuestion>['context']): HTMLElement {
  const root = h('div', { class: 'q-context' })
  let list: HTMLElement | null = null
  for (const b of ctx) {
    if (b.kind === 'item') {
      if (!list) {
        list = h('ul', { class: 'q-list' })
        root.append(list)
      }
      list.append(h('li', {}, b.text))
    } else {
      list = null
      root.append(h('p', {}, b.text))
    }
  }
  return root
}

export function questionCard(questions: AskQuestion[], hooks: QuestionCardHooks): QuestionCard {
  let flow: FlowState = createFlow(questions)
  const seq = questions.length > 1
  const root = h('div', { class: seq ? 'q-flow q-seq' : 'q-flow' })

  const submit = () => {
    const answers = buildAnswers(questions, flow)
    if (!answers) return hooks.toast('Responda todas as perguntas.', 'err')
    hooks.submit(answers)
  }
  /** Próxima, or send when this is the only question. */
  const advance = () => {
    if (!seq) return submit()
    if (flow.reviewing) return submit()
    const next = goNext(flow)
    if (next === flow) return hooks.toast('Responda esta pergunta para seguir.', 'err')
    go(next)
  }
  /** Moves to another step and brings the focus to its title, which the removed button no longer holds. */
  const go = (f: FlowState) => {
    flow = f
    render()
    root.querySelector<HTMLElement>('[data-q-focus]')?.focus({ preventScroll: true })
  }

  /** The options, "Outra resposta" and the marks of question i, bound to the flow state. */
  function answerBlock(i: number): HTMLElement {
    const q = questions[i]
    const multi = q.multiSelect
    const group = h('div', { class: 'q-options', role: multi ? 'group' : 'radiogroup', 'aria-label': `Respostas: ${q.question}` })
    const buttons: HTMLButtonElement[] = []
    const other = h('input', { class: 'input q-other', type: 'text', placeholder: 'Escreva aqui' })
    other.value = flow.answers[i].other

    const sync = () => {
      const chosen = flow.answers[i].chosen
      buttons.forEach((b, k) => {
        const on = chosen.includes(q.options[k].label)
        b.classList.toggle('on', on)
        b.setAttribute('aria-checked', String(on))
        // Roving tabindex of a radio group: the marked one, or the first.
        if (!multi) b.tabIndex = on || (!chosen.length && k === 0) ? 0 : -1
      })
    }
    const pick = (label: string) => {
      flow = toggleOption(flow, i, label)
      if (!multi) other.value = ''
      sync()
    }

    q.options.forEach((o, k) => {
      const b = h(
        'button',
        { type: 'button', class: 'q-option', role: multi ? 'checkbox' : 'radio', 'aria-checked': 'false', onclick: () => pick(o.label) },
        h('span', { class: multi ? 'q-mark q-mark-sq' : 'q-mark', 'aria-hidden': 'true' }),
        h(
          'span',
          { class: 'q-text' },
          h('span', { class: 'q-label' }, o.label),
          o.description ? h('span', { class: 'q-desc' }, o.description) : null,
        ),
      )
      b.addEventListener('keydown', (e) => {
        if (e.isComposing) return
        if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
          // Enter on an option answers with it (adding it first, unless a multiple choice already has marks).
          e.preventDefault()
          e.stopPropagation()
          if (!multi || !flow.answers[i].chosen.length) pick(o.label)
          advance()
        } else if (!multi && ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key) && !e.altKey && !e.metaKey && !e.ctrlKey) {
          // Radio group: arrows move the mark; they would also walk the player around the office.
          e.preventDefault()
          e.stopPropagation()
          const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1
          const n = (k + step + buttons.length) % buttons.length
          pick(q.options[n].label)
          buttons[n].focus()
        }
      })
      buttons.push(b)
      group.append(b)
    })

    other.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Enter' && !e.isComposing && !e.shiftKey) {
        e.preventDefault()
        advance()
      }
    })
    other.addEventListener('input', () => {
      flow = setOther(flow, i, other.value)
      sync()
      if (seq) refreshFooter()
    })
    sync()
    return h('div', { class: 'q-answer' }, group, h('label', { class: 'q-other-label' }, 'Outra resposta', other))
  }

  // ----- one question alone: variant C, numbered steps -----
  function renderSingle(): void {
    const q = questions[0]
    const { context, question } = splitQuestion(q.question)
    const steps: HTMLElement[] = []
    let n = 0
    const num = (on: boolean) => h('span', { class: on ? 'q-num q-num-on' : 'q-num', 'aria-hidden': 'true' }, String(++n))
    if (context.length) {
      steps.push(
        h(
          'li',
          { class: 'q-step' },
          num(false),
          h('div', { class: 'q-step-body' }, h('h3', { class: 'q-step-name' }, 'O que aconteceu'), contextBlocks(context)),
        ),
      )
    }
    const ask = h('p', { class: 'q-ask', id: 'q-ask-0' }, question || q.question)
    steps.push(
      h(
        'li',
        { class: 'q-step' },
        num(true),
        h(
          'div',
          { class: 'q-step-body' },
          h('h3', { class: 'q-step-name q-step-hi' }, 'A pergunta', q.header ? h('span', { class: 'chip' }, q.header) : null),
          ask,
        ),
      ),
    )
    steps.push(h('li', { class: 'q-step' }, num(false), h('div', { class: 'q-step-body' }, answerBlock(0))))
    root.replaceChildren(h('ol', { class: 'q-steps' }, ...steps))
    hooks.described(ask)
  }

  // ----- several questions: step list, one question, footer; then the review -----
  let footerEl: HTMLElement | null = null
  function refreshFooter(): void {
    if (!footerEl) return
    const total = questions.length
    const done = answeredCount(flow)
    footerEl.querySelector('.q-count')!.textContent =
      `${done} respondida${done === 1 ? '' : 's'} · ${total - done} ${total - done === 1 ? 'falta' : 'faltam'}`
    const next = footerEl.querySelector<HTMLButtonElement>('.q-next')
    if (next) next.disabled = !isAnswered(flow, flow.index)
  }

  function stepList(): HTMLElement {
    return h(
      'ol',
      { class: 'q-stepper', 'aria-label': 'Perguntas' },
      ...questions.map((q, i) => {
        const done = isAnswered(flow, i)
        const cur = !flow.reviewing && i === flow.index
        const state = cur ? 'pergunta atual' : done ? 'respondida' : 'ainda sem resposta'
        return h(
          'li',
          { class: `q-stp${done ? ' q-stp-done' : ''}${cur ? ' q-stp-on' : ''}`, 'aria-current': cur ? 'step' : undefined },
          h('span', { class: 'q-stp-n', 'aria-hidden': 'true' }, done && !cur ? '✓' : String(i + 1)),
          h('span', { class: 'q-stp-t' }, q.header || `Pergunta ${i + 1}`),
          h('span', { class: 'sr-only' }, ` (${state})`),
        )
      }),
    )
  }

  function renderSeq(): void {
    const total = questions.length
    const i = flow.index
    if (flow.reviewing) {
      const rows = questions.map((q, k) =>
        h(
          'li',
          { class: 'q-rv' },
          h('span', { class: 'q-rv-n', 'aria-hidden': 'true' }, String(k + 1)),
          h('div', { class: 'q-rv-t' }, h('span', { class: 'q-rv-q' }, q.question), h('span', { class: 'q-rv-a' }, answerText(flow, k))),
          h(
            'button',
            {
              type: 'button',
              class: 'btn q-edit',
              'aria-label': `Editar a resposta ${k + 1}: ${q.header || q.question}`,
              onclick: () => go(edit(flow, k)),
            },
            'Editar',
          ),
        ),
      )
      const title = h('h3', { class: 'q-seq-title', tabindex: -1, 'data-q-focus': '' }, 'Revisar as respostas')
      const send = h(
        'button',
        { type: 'button', class: 'btn btn-primary', disabled: !canSubmit(flow), onclick: submit },
        icon('send', 15),
        `Enviar as ${total} respostas`,
      )
      root.replaceChildren(
        h('div', { class: 'q-seq-head' }, title, h('span', { class: 'q-seq-count' }, `${total} de ${total}`)),
        stepList(),
        h('p', { class: 'q-note' }, 'Confira antes de enviar. O agente só continua depois que você enviar.'),
        h('ol', { class: 'q-review' }, ...rows),
        h(
          'div',
          { class: 'q-footer' },
          h('button', { type: 'button', class: 'btn', onclick: () => go(goBack(flow)) }, 'Voltar'),
          h('button', { type: 'button', class: 'btn btn-danger-soft', onclick: hooks.dismiss }, 'Agora não'),
          h('div', { class: 'grow' }),
          send,
        ),
      )
      footerEl = null
      hooks.described(title)
      return
    }
    const q = questions[i]
    const { context, question } = splitQuestion(q.question)
    const ask = h('p', { class: 'q-ask q-ask-big', id: `q-ask-${i}`, tabindex: -1, 'data-q-focus': '' }, question || q.question)
    const next = h(
      'button',
      { type: 'button', class: 'btn btn-primary q-next', disabled: !isAnswered(flow, i), onclick: advance },
      i === total - 1 || flow.fromReview ? 'Revisar' : 'Próxima',
    )
    const footer = h(
      'div',
      { class: 'q-footer' },
      h('button', { type: 'button', class: 'btn', disabled: i === 0 && !flow.fromReview, onclick: () => go(goBack(flow)) }, 'Voltar'),
      h('button', { type: 'button', class: 'btn btn-danger-soft', onclick: hooks.dismiss }, 'Agora não'),
      h('span', { class: 'q-count', 'aria-live': 'polite' }),
      next,
    )
    root.replaceChildren(
      h(
        'div',
        { class: 'q-seq-head' },
        h('h3', { class: 'q-seq-title' }, `Pergunta ${i + 1} de ${total}`),
        h('span', { class: 'q-seq-count' }, `${i + 1} de ${total}`),
      ),
      stepList(),
      ...(context.length
        ? [h('div', { class: 'q-block' }, h('h4', { class: 'q-step-name' }, 'O que aconteceu'), contextBlocks(context))]
        : []),
      h('div', { class: 'q-block' }, h('h4', { class: 'q-step-name q-step-hi' }, 'A pergunta'), ask),
      answerBlock(i),
      footer,
    )
    footerEl = footer
    refreshFooter()
    hooks.described(ask)
  }

  function render(): void {
    if (seq) renderSeq()
    else renderSingle()
  }
  render()

  return {
    subtitle: seq ? `veio te fazer ${questions.length} perguntas` : 'veio te fazer uma pergunta',
    body: root,
    buttons: seq
      ? []
      : [
          h('button', { type: 'button', class: 'btn', title: 'Deixar sem resposta', onclick: hooks.dismiss }, 'Agora não'),
          h('div', { class: 'grow' }),
          h('button', { type: 'button', class: 'btn btn-primary', onclick: submit }, icon('send', 15), 'Responder'),
        ],
    wide: seq,
    onEnter: advance,
  }
}
