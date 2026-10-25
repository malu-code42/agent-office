import { activeStudyCycle, evaluateStudyGate, type StudyCycle, type StudyCycleQuestion, type StudyCycleState } from '@shared/study-cycle'
import type { StudyQuestion } from '@shared/study-questions'
import { announce } from './a11y'
import { h } from './dom'
import { cleanError, modal } from './modals/common'

type Toast = (text: string, kind?: 'info' | 'ok' | 'err') => void

const originLabel: Record<StudyQuestion['originKind'], string> = {
  enem: 'ENEM',
  concurso: 'Concurso',
  livro: 'Livro',
  web: 'Web',
  ia: 'IA',
}

/** Bonnie's local-only diagnosis surface; every Tutor request is an explicit per-question action. */
export async function openStudyCycle(root: HTMLElement, toast: Toast): Promise<void> {
  let state: StudyCycleState
  let bank: StudyQuestion[]
  try {
    ;[state, { questions: bank }] = await Promise.all([window.office.readStudyCycle(), window.office.readStudyQuestions()])
  } catch (error) {
    toast(cleanError(error), 'err')
    return
  }

  let topic = activeStudyCycle(state)?.topic ?? ''
  const selected = new Set<string>()
  let busy = false
  let startButton: HTMLButtonElement | undefined
  const content = h('div', { class: 'study-cycle-content' })
  const actions = h('div', { class: 'review-actions' })
  const error = h('p', { class: 'study-cycle-error', role: 'alert', hidden: true })
  const tell = (message: string) => {
    error.textContent = message
    error.hidden = !message
  }
  const save = async (action: () => Promise<StudyCycleState>, success?: string) => {
    if (busy) return
    busy = true
    tell('')
    render()
    try {
      state = await action()
      if (success) toast(success, 'ok')
    } catch (err) {
      tell(cleanError(err))
    } finally {
      busy = false
      render()
    }
  }

  const questionForm = (cycle: StudyCycle, item: StudyCycleQuestion): HTMLElement => {
    let dirty = false
    const controls: { verifyButton?: HTMLButtonElement } = {}
    const markDirty = () => {
      dirty = true
      if (controls.verifyButton) controls.verifyButton.disabled = true
    }
    const response = h('textarea', {
      class: 'input study-cycle-answer',
      rows: '3',
      maxlength: '20000',
      'aria-label': `Sua resposta para ${item.id}`,
      value: item.response,
      disabled: busy || cycle.stage !== 'diagnosis' || undefined,
      oninput: markDirty,
    }) as HTMLTextAreaElement
    const uncertain = h(
      'select',
      {
        class: 'input study-cycle-uncertain',
        'aria-label': `Você está em dúvida sobre ${item.id}`,
        disabled: busy || cycle.stage !== 'diagnosis' || undefined,
        onchange: markDirty,
      },
      h('option', { value: '', selected: item.uncertain === null }, 'Marque sua incerteza'),
      h('option', { value: 'false', selected: item.uncertain === false }, 'Não estou em dúvida'),
      h('option', { value: 'true', selected: item.uncertain === true }, 'Estou em dúvida'),
    ) as HTMLSelectElement
    const excerpt = h('textarea', {
      class: 'input study-cycle-evidence',
      rows: '2',
      maxlength: '20000',
      'aria-label': `Trecho de apoio escolhido para ${item.id}`,
      placeholder:
        item.source.answerStatus === 'verified'
          ? 'Trecho opcional escolhido por você'
          : 'Sem gabarito conferido: cole um trecho de apoio escolhido por você',
      value: item.providedExcerpt,
      disabled: busy || cycle.stage !== 'diagnosis' || undefined,
      oninput: markDirty,
    }) as HTMLTextAreaElement
    const assessment = item.assessment
      ? h(
          'p',
          { class: `study-cycle-assessment study-cycle-assessment-${item.assessment.kind}`, role: 'status' },
          item.assessment.kind === 'pending'
            ? `Em verificação · ${item.assessment.rationale}`
            : `${assessmentLabel(item.assessment.kind)} · ${item.assessment.rationale}`,
        )
      : h('p', { class: 'field-hint', role: 'status' }, 'Ainda não verificada pelo Tutor.')
    const saveAnswer = h(
      'button',
      {
        class: 'btn btn-small',
        type: 'button',
        disabled: busy || cycle.stage !== 'diagnosis' || undefined,
        onclick: () => {
          if (!response.value.trim() || uncertain.value === '') {
            tell('Escreva sua resposta e marque se está em dúvida.')
            return
          }
          void save(
            () => window.office.answerStudyCycle(item.id, response.value, uncertain.value === 'true', excerpt.value),
            'Resposta salva localmente.',
          )
        },
      },
      'Salvar resposta',
    )
    controls.verifyButton = h(
      'button',
      {
        class: 'btn btn-small btn-primary',
        type: 'button',
        disabled: busy || cycle.stage !== 'diagnosis' || !item.response || item.uncertain === null || dirty || undefined,
        onclick: () => void save(() => window.office.evaluateStudyAnswer(item.id)),
      },
      'Verificar com Tutor',
    )
    return h(
      'article',
      { class: 'study-cycle-question' },
      h('h4', {}, item.source.topic || cycle.topic),
      h(
        'p',
        { class: 'study-cycle-source' },
        `${originLabel[item.source.originKind]} · ${item.source.sourceTitle}${item.source.answerStatus !== 'verified' ? ' · gabarito não conferido' : ''}`,
      ),
      h('p', { class: 'study-cycle-prompt' }, item.source.question),
      h('label', { class: 'study-cycle-field' }, h('span', { class: 'field-label' }, 'Sua resposta'), response),
      h('label', { class: 'study-cycle-field' }, h('span', { class: 'field-label' }, 'Incerteza'), uncertain),
      h('label', { class: 'study-cycle-field' }, h('span', { class: 'field-label' }, 'Trecho de apoio para o Tutor (opcional)'), excerpt),
      assessment,
      h('div', { class: 'study-cycle-question-actions' }, saveAnswer, controls.verifyButton),
    )
  }

  const cycleBody = (cycle: StudyCycle): HTMLElement[] => {
    const gate = evaluateStudyGate(cycle)
    const status =
      cycle.stage === 'diagnosis'
        ? 'Diagnóstico · Bonnie aguarda resposta, incerteza marcada e evidência do Tutor em cada questão.'
        : cycle.stage === 'review-required'
          ? 'Bonnie pede revisão de erros ou dúvidas antes de liberar outra etapa. A revisão/prática será implementada em outra etapa.'
          : 'Bonnie liberou o reteste. O reteste ainda não está implementado neste ticket.'
    const body: HTMLElement[] = [
      h('p', { class: 'study-cycle-status', role: 'status' }, status),
      h(
        'p',
        { class: 'field-hint' },
        'As respostas ficam neste computador. Somente ao clicar “Verificar com Tutor”, esta questão, sua resposta e o gabarito conferido ou trecho escolhido são enviados ao Claude. A avaliação não salva nem altera o banco.',
      ),
      ...cycle.questions.map((item) => questionForm(cycle, item)),
    ]
    if (cycle.stage === 'diagnosis') {
      if (gate.ready) {
        body.push(
          h(
            'p',
            { class: 'field-hint' },
            gate.nextStage === 'retest-ready'
              ? 'Sem erros nem dúvidas. Bonnie pode pular revisão e prática e liberar o reteste.'
              : 'Há erro ou dúvida. Bonnie exige revisão antes do reteste.',
          ),
        )
        actions.append(
          h(
            'button',
            {
              class: 'btn btn-primary',
              type: 'button',
              disabled: busy || undefined,
              onclick: () => void save(() => window.office.advanceStudyCycle(), 'Bonnie atualizou a etapa do ciclo.'),
            },
            gate.nextStage === 'retest-ready' ? 'Pedir à Bonnie para liberar reteste' : 'Pedir à Bonnie para registrar revisão necessária',
          ),
        )
      } else {
        body.push(
          h(
            'p',
            { class: 'field-hint' },
            gate.reason === 'incomplete'
              ? 'Gate bloqueado: responda todas as questões e marque sim/não para incerteza.'
              : 'Gate bloqueado: respostas sem evidência suficiente ficam Em verificação e não contam como acerto nem erro.',
          ),
        )
      }
    }
    return body
  }

  const pickerBody = (): HTMLElement[] => {
    const topicInput = h('input', {
      class: 'input',
      value: topic,
      maxlength: '200',
      'aria-label': 'Tópico do ciclo',
      placeholder: 'Ex.: Probabilidade',
      disabled: busy || undefined,
      oninput: (event: Event) => {
        topic = (event.currentTarget as HTMLInputElement).value
        if (startButton) startButton.disabled = busy || !topic.trim() || !selected.size
      },
    }) as HTMLInputElement
    const visible = bank.filter((question) => !question.sourceOnly && question.question.trim())
    return [
      h('p', {}, 'Selecione questões já salvas no banco local. Este início não busca nem gera questões.'),
      h(
        'p',
        { class: 'field-hint' },
        'O banco atual é lido localmente. Cada ciclo guarda um snapshot para preservar as questões mesmo se o banco mudar.',
      ),
      h('label', { class: 'study-cycle-field' }, h('span', { class: 'field-label' }, 'Novo tópico'), topicInput),
      ...(visible.length
        ? visible.map((question) => {
            const checkbox = h('input', {
              type: 'checkbox',
              checked: selected.has(question.id),
              disabled: busy || undefined,
              'aria-label': `Selecionar ${question.topic}: ${question.question}`,
              onchange: (event: Event) => {
                const input = event.currentTarget as HTMLInputElement
                if (input.checked) selected.add(question.id)
                else selected.delete(question.id)
                if (startButton) startButton.disabled = busy || !topic.trim() || !selected.size
              },
            })
            return h(
              'label',
              { class: 'study-cycle-bank-row' },
              checkbox,
              h('span', {}, h('strong', {}, `${question.topic} · ${originLabel[question.originKind]}`), h('span', {}, question.question)),
            )
          })
        : [h('p', { class: 'field-hint' }, 'O banco local ainda não tem questões disponíveis.')]),
    ]
  }

  const render = () => {
    actions.replaceChildren()
    const active = activeStudyCycle(state)
    content.replaceChildren(error, ...(active ? cycleBody(active) : pickerBody()))
    if (active) {
      actions.append(
        h(
          'button',
          {
            class: 'btn',
            type: 'button',
            disabled: busy || undefined,
            onclick: () => {
              void save(() => window.office.resetStudyCycle(), 'Ciclo preservado no histórico. Escolha outro tópico quando quiser.')
            },
          },
          'Trocar tópico (preservar ciclo)',
        ),
      )
    } else {
      startButton = h(
        'button',
        {
          class: 'btn btn-primary',
          type: 'button',
          disabled: busy || !topic.trim() || !selected.size || undefined,
          onclick: () => void save(() => window.office.startStudyCycle(topic, [...selected]), 'Diagnóstico iniciado.'),
        },
        busy ? 'Iniciando…' : 'Iniciar diagnóstico com Bonnie',
      )
      actions.append(startButton)
    }
    actions.append(h('div', { class: 'grow' }), h('button', { class: 'btn', type: 'button', onclick: () => el.remove() }, 'Fechar'))
  }

  const el = modal('Ciclo de estudo · Bonnie', [content], [actions], () => el.remove())
  root.append(el)
  render()
  actions.querySelector<HTMLButtonElement>('button')?.focus()
  announce('Diagnóstico de estudo aberto.')
}

function assessmentLabel(kind: 'correct' | 'incorrect' | 'uncertain' | 'pending'): string {
  return {
    correct: 'Tutor encontrou evidência suficiente de acerto',
    incorrect: 'Tutor encontrou evidência de erro',
    uncertain: 'Dúvida marcada · revisão necessária',
    pending: 'Em verificação',
  }[kind]
}
