import type { AskQuestion } from '@shared/types'
import { h, icon } from './dom'
import {
  buildAnswers,
  canSubmit,
  createFlow,
  goBack,
  goNext,
  helpText,
  isAnswered,
  jump,
  positionText,
  progressText,
  reviewAnswer,
  reviewQuestion,
  setOther,
  stepState,
  toggleOption,
  type FlowState,
} from './question-flow'
import { splitQuestion } from './question-text'

/**
 * AO-101: the body of the AskUserQuestion card (designs q-uma, q-seq, q-rev). One question: what
 * happened, the question, the options, and a footer with the help text and "Enviar resposta".
 * Two or more: one question at a time, a clickable step list on top, Voltar / count / Próxima,
 * and a review screen before sending. The answers go out in the same shape as ever
 * (question text -> chosen labels joined by ", "), through hooks.submit.
 */
export interface QuestionCardHooks {
  submit(answers: Record<string, string>): void
  toast(text: string, kind?: 'info' | 'ok' | 'err'): void
  /** The element that names the open question, for aria-describedby of the card. */
  described(el: HTMLElement): void
  /** The header of the popup changed (sequence only): the line under the agent name and the "2 de 4" counter. */
  heading(subtitle: string, count: string): void
}

export interface QuestionCard {
  subtitle: string
  /** "2 de 4" for the header of the popup; empty for a single question. */
  count: string
  body: HTMLElement
  /** Footer buttons for the dialog frame: always empty, the card draws its own footer. */
  buttons: HTMLElement[]
  /** The wide popup of the designs (two columns of options). */
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

export function questionCard(questions: AskQuestion[], agentName: string, hooks: QuestionCardHooks): QuestionCard {
  let flow: FlowState = createFlow(questions)
  const seq = questions.length > 1
  const root = h('div', { class: seq ? 'q-flow q-seq' : 'q-flow' })
  // The dialog frame does not exist yet while the first render runs.
  let ready = false

  const submit = () => {
    const answers = buildAnswers(questions, flow)
    if (!answers) return hooks.toast('Responda todas as perguntas.', 'err')
    hooks.submit(answers)
  }
  /** Próxima, or send when this is the only question (or the review). */
  const advance = () => {
    if (!seq || flow.reviewing) return submit()
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
      refreshFooter()
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
      refreshFooter()
    })
    sync()
    return h('div', { class: 'q-answer' }, group, h('label', { class: 'q-other-label' }, 'Outra resposta', other))
  }

  // ----- the step list, the footer and the review -----
  let footerEl: HTMLElement | null = null
  const headingText = () => (flow.reviewing ? 'Revisar as respostas' : `veio te fazer ${questions.length} perguntas`)

  /** Count of the sequence and the enabled state of Próxima / Enviar resposta. */
  function refreshFooter(): void {
    if (!footerEl) return
    const count = footerEl.querySelector('.q-count[aria-live]')
    if (count) count.textContent = progressText(flow)
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
        return h(
          'li',
          { class: 'q-stp-li' },
          h(
            'button',
            {
              type: 'button',
              class: `q-stp${done ? ' q-stp-done' : ''}${cur ? ' q-stp-on' : ''}`,
              'aria-current': cur ? 'step' : undefined,
              onclick: () => go(jump(flow, i)),
            },
            h('span', { class: 'q-stp-n', 'aria-hidden': 'true' }, done && !cur ? '✓' : String(i + 1)),
            h('span', { class: 'q-stp-t' }, q.header || `Pergunta ${i + 1}`),
            h('span', { class: 'sr-only' }, ` (${stepState(flow, i)})`),
          ),
        )
      }),
    )
  }

  function renderReview(): void {
    const total = questions.length
    const rows = questions.map((q, k) =>
      h(
        'li',
        { class: 'q-rv' },
        h('span', { class: 'q-rv-n', 'aria-hidden': 'true' }, String(k + 1)),
        h('div', { class: 'q-rv-t' }, h('span', { class: 'q-rv-q' }, reviewQuestion(q, flow, k)), h('span', { class: 'q-rv-a' }, reviewAnswer(flow, k))),
        h(
          'button',
          {
            type: 'button',
            class: 'btn q-edit',
            'aria-label': `Editar a resposta ${k + 1}: ${q.header || q.question}`,
            onclick: () => go(jump(flow, k)),
          },
          'Editar',
        ),
      ),
    )
    const note = h(
      'p',
      { class: 'q-note', id: 'q-review-note', tabindex: -1, 'data-q-focus': '' },
      `Confira antes de enviar. ${agentName} só continua depois que você enviar.`,
    )
    root.replaceChildren(
      stepList(),
      note,
      h('ol', { class: 'q-review' }, ...rows),
      h(
        'div',
        { class: 'q-footer' },
        h('button', { type: 'button', class: 'btn', onclick: () => go(goBack(flow)) }, 'Voltar'),
        h('div', { class: 'grow' }),
        h(
          'button',
          { type: 'button', class: 'btn btn-primary', disabled: !canSubmit(flow), onclick: submit },
          icon('send', 15),
          `Enviar as ${total} respostas`,
        ),
      ),
    )
    footerEl = null
    hooks.described(note)
  }

  /** One question: alone (q-uma, no steps) or one of a sequence (q-seq). */
  function renderQuestion(): void {
    const total = questions.length
    const i = flow.index
    const q = questions[i]
    const { context, question } = splitQuestion(q.question)
    const ask = h('p', { class: 'q-ask q-ask-big', id: `q-ask-${i}`, tabindex: -1, 'data-q-focus': '' }, question || q.question)
    const footer = seq
      ? h(
          'div',
          { class: 'q-footer' },
          h('button', { type: 'button', class: 'btn', disabled: i === 0 && !flow.fromReview, onclick: () => go(goBack(flow)) }, 'Voltar'),
          h('span', { class: 'q-count', 'aria-live': 'polite' }),
          h(
            'button',
            { type: 'button', class: 'btn btn-primary q-next', disabled: !isAnswered(flow, i), onclick: advance },
            i === total - 1 || flow.fromReview ? 'Revisar' : 'Próxima',
          ),
        )
      : h(
          'div',
          { class: 'q-footer' },
          h('span', { class: 'q-count q-help' }, helpText(q.multiSelect)),
          h(
            'button',
            { type: 'button', class: 'btn btn-primary q-next', disabled: !isAnswered(flow, i), onclick: advance },
            icon('send', 15),
            'Enviar resposta',
          ),
        )
    root.replaceChildren(
      ...(seq ? [stepList()] : []),
      ...(context.length
        ? [h('div', { class: 'q-block' }, h('h4', { class: 'q-step-name' }, 'O que aconteceu'), contextBlocks(context))]
        : []),
      h(
        'div',
        { class: 'q-block' },
        h('h4', { class: 'q-step-name q-step-hi' }, 'A pergunta', q.header && !seq ? h('span', { class: 'chip' }, q.header) : null),
        ask,
      ),
      answerBlock(i),
      footer,
    )
    footerEl = footer
    refreshFooter()
    hooks.described(ask)
  }

  function render(): void {
    if (flow.reviewing) renderReview()
    else renderQuestion()
    if (ready && seq) hooks.heading(headingText(), positionText(flow))
  }
  render()
  ready = true

  return {
    subtitle: seq ? headingText() : 'veio te fazer uma pergunta',
    count: positionText(flow),
    body: root,
    buttons: [],
    wide: true,
    onEnter: advance,
  }
}
