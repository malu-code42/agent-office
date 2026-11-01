import {
  activeStudyCycle,
  evaluateStudyGate,
  practiceScore,
  retestScore,
  studyGaps,
  type StudyCycle,
  type StudyCycleQuestion,
  type StudyCycleState,
  type StudyPracticeQuestion,
  unansweredStudyQuestions,
} from '@shared/study-cycle'
import { choiceOf, isChoiceQuestion, studyOptionLetter, studyOptionText, type StudyQuestion } from '@shared/study-questions'
import type { StudyLibrarySearch } from '@shared/study-library'
import { disciplineIdOf, splitStudyRationale, type StudyBankRequest } from '@shared/study-bank'
import { studyTopicStart, topicName, trailTopicOf, type StudyTrail, type StudyTrailTopic } from '@shared/study-trail'
import { questionsForTopic, studyQueryOfQuestion, type StudySourceRecommendations } from '@shared/study-sources'
import { announce } from './a11y'
import { studySourceList } from './study-library'
import { h } from './dom'
import { cleanError, confirmDialog } from './modals/common'
import {
  STUDY_WHO,
  studyBanner,
  studyChip,
  studyGate,
  studyHeading,
  studyInRoom,
  studyLabel,
  studyMeterBar,
  studyPanel,
  studyStat,
  studySteps,
  studyWindow,
  type StudyGateItem,
  type StudyStep,
  type StudyTone,
} from './study-kit'

type Toast = (text: string, kind?: 'info' | 'ok' | 'err') => void

const stageLabel: Record<StudyCycle['stage'], string> = {
  diagnosis: 'Diagnóstico',
  'review-required': 'Erros e dúvidas',
  practice: 'Prática e fontes',
  'retest-ready': 'Reteste',
  retest: 'Reteste',
  completed: 'Concluído',
}

const STEP_NAMES = ['Diagnóstico', 'Erros e dúvidas', 'Prática e fontes', 'Reteste']
const STEP_RULES = [
  'Todas respondidas, incertezas marcadas. Sem nota mínima.',
  'Cada erro ou dúvida com causa, próximo passo e fonte.',
  'Fontes estudadas, ≥1 nota, 80% na prática.',
  '≥10 questões novas, sem ajuda, ≥80%.',
]

/** How many new questions Bonnie picks for a diagnosis and a retest. */
const DIAGNOSIS_SIZE = 12
const RETEST_SIZE = 12
const RETEST_MIN = 10

/** "tópico 5 de 6 · Estrutura de Dados…" for a topic of the trail. */
const trailPlace = (topic: StudyTrailTopic) => `tópico ${topic.index} de ${topic.total} · ${topic.discipline}`

const originLabel: Record<StudyQuestion['originKind'], string> = {
  enem: 'ENEM',
  concurso: 'Concurso',
  livro: 'Livro',
  web: 'Web',
  ia: 'IA',
}

type Kind = 'correct' | 'incorrect' | 'uncertain' | 'pending'
const KIND: Record<Kind, [string, StudyTone]> = {
  correct: ['Certa', 'ok'],
  incorrect: ['Errada', 'err'],
  uncertain: ['Incerta', 'pink'],
  pending: ['Em verificação', 'warn'],
}
const kindChip = (kind: Kind) => studyChip(...KIND[kind])
/** A gap is "Errada" when the answer was wrong, "Incerta" when the user doubted it. */
const gapKind = (q: StudyCycleQuestion): Kind => (q.assessment?.kind === 'incorrect' ? 'incorrect' : 'uncertain')
/**
 * The book's passage that proves the answer, with its page: shown only once the question has been
 * answered and checked (never while answering, never in the retest), because it gives the answer away.
 */
const passageOf = (q: StudyQuestion): HTMLElement | null => {
  const { quote } = splitStudyRationale(q.rationale)
  if (!quote) return null
  const ref = q.sourceReference ?? ''
  const page = ref.includes('#') ? ref.slice(ref.indexOf('#') + 1).replace(/:[0-9]+$/, '') : ''
  return h(
    'div',
    { class: 'sk-passage' },
    h('span', { class: 'sk-label' }, `Trecho do livro · ${q.sourceTitle}${page ? ` · ${page}` : ''}`),
    h('blockquote', {}, `“${quote}”`),
  )
}
/** "C) the text" for a multiple-choice answer; the answer as written for an open one left from before. */
const answerText = (q: StudyQuestion, response: string): string => {
  const letter = isChoiceQuestion(q) ? choiceOf(response) : null
  return letter ? studyOptionText(q, letter) : response
}

/**
 * The five alternatives as a radio group; an open question left from before gets a text box. With
 * `reveal` (after grading) the right alternative and a wrong pick are marked.
 */
function answerControl(
  q: StudyQuestion,
  value: string,
  onChange: (value: string) => void,
  opts: { disabled?: boolean; reveal?: boolean; label: string },
): HTMLElement {
  if (!isChoiceQuestion(q)) {
    const area = h('textarea', {
      class: 'input sk-answer',
      maxlength: '20000',
      'aria-label': opts.label,
      disabled: opts.disabled || undefined,
      oninput: (event: Event) => onChange((event.currentTarget as HTMLTextAreaElement).value),
    })
    area.value = value
    return area
  }
  const picked = choiceOf(value)
  return h(
    'div',
    { class: 'sk-choices', role: 'radiogroup', 'aria-label': opts.label },
    ...q.options!.map((text, i) => {
      const letter = studyOptionLetter(i)
      const mark = opts.reveal ? (letter === q.answer ? ' sk-opt-right' : letter === picked ? ' sk-opt-wrong' : '') : ''
      return h(
        'label',
        { class: `sk-opt${mark}` },
        h('input', {
          type: 'radio',
          name: `opt-${q.id}`,
          value: letter,
          checked: picked === letter || undefined,
          disabled: opts.disabled || undefined,
          onchange: () => onChange(letter),
        }),
        h('span', { class: 'sk-opt-letter' }, letter),
        h('span', { class: 'sk-opt-text' }, text),
      )
    }),
  )
}

/** The question as read: the reading passage it refers to (when it has one), then the statement. */
const promptOf = (q: StudyQuestion): HTMLElement[] => [
  ...(q.passage ? [h('p', { class: 'sk-reading' }, q.passage)] : []),
  h('p', { class: 'sk-prompt' }, q.question),
]

const verifiedQuestion = (q: StudyQuestion) => !q.sourceOnly && !!q.question.trim() && q.answerStatus === 'verified' && !!q.answer

export interface StudyCycleOptions {
  topic?: string
  /** Opens "Montar banco" for a topic that has no new questions left. */
  openBuilder?: (preset: StudyBankRequest) => void
}

/**
 * "Começar com este tópico" (the trail board): keeps every earlier cycle. The current topic just
 * opens; a kept cycle of the topic is pinned again where it stopped; otherwise the current cycle
 * is set aside and the window opens on the topic, with Bonnie's new questions already picked.
 */
export async function startStudyTopic(root: HTMLElement, toast: Toast, topic: string, options: StudyCycleOptions = {}): Promise<void> {
  try {
    const plan = studyTopicStart(await window.office.readStudyCycle(), topic)
    if (plan.kind === 'resume') {
      await window.office.resumeStudyCycle(plan.cycleId)
      toast(`Ciclo de “${topic}” retomado de onde parou.`, 'ok')
    } else if (plan.kind === 'new' && plan.setAside) {
      await window.office.resetStudyCycle()
      toast('O ciclo anterior ficou guardado; a Bonnie separou questões do novo tópico.', 'info')
    }
    await openStudyCycle(root, toast, plan.kind === 'new' ? { ...options, topic } : options)
  } catch (error) {
    toast(cleanError(error), 'err')
  }
}

/**
 * Bonnie's study cycle, one window: the four stages as a strip, the stage's work in the middle and
 * its gate in the foot. Bonnie picks new questions from the bank (never one already answered);
 * every call to a teacher is an explicit click.
 */
export async function openStudyCycle(root: HTMLElement, toast: Toast, options: StudyCycleOptions = {}): Promise<void> {
  let state: StudyCycleState
  let bank: StudyQuestion[]
  let trail: StudyTrail
  try {
    ;[state, { questions: bank }, trail] = await Promise.all([
      window.office.readStudyCycle(),
      window.office.readStudyQuestions(),
      // The trail only offers topics: without it the topic is typed by hand.
      window.office.readStudyTrail().catch((): StudyTrail => ({ found: false, topics: [] })),
    ])
  } catch (error) {
    toast(cleanError(error), 'err')
    return
  }

  /** The bank without the questions already answered (in any cycle): those are never offered again. */
  const fresh = (): StudyQuestion[] => unansweredStudyQuestions(bank, state).filter(isChoiceQuestion)

  let topic = activeStudyCycle(state)?.topic ?? options.topic ?? ''
  /** The diagnosis questions Bonnie picked for the chosen topic (the user may change them). */
  const selected = new Set<string>()
  const pickForTopic = () => {
    selected.clear()
    if (topic.trim()) for (const q of questionsForTopic(fresh(), topic, DIAGNOSIS_SIZE)) selected.add(q.id)
  }
  if (!activeStudyCycle(state)) pickForTopic()

  // where the user is inside a stage
  let index = 0
  let diagnosisView: 'questions' | 'result' = 'result'
  let gapId = ''
  let practiceId = ''
  let confirmDone = false
  /** Answers typed and not saved yet, so moving between questions keeps them. */
  const drafts = new Map<string, { response: string; excerpt: string; uncertain: boolean | null }>()
  const reviewDrafts = new Map<string, { cause: string; nextStep: string }>()
  const noteDrafts = new Map<string, string>()
  let noteOpen = ''
  /** Cora's passages for each gap (searched with the question), and another term the user tried. */
  const gapHits = new Map<string, StudyLibrarySearch | 'loading' | 'error'>()
  const gapQuery = new Map<string, string>()
  /** Cora's ranked sources (pages) for each gap, asked once per opening. */
  const gapSources = new Map<string, StudySourceRecommendations | 'loading' | 'error'>()
  /** Bonnie's proposals for a practice round and a retest; null until shown. */
  let practicePick: Set<string> | null = null
  let retestPick: Set<string> | null = null
  let busy = false
  let errorText = ''

  const view = h('div', { class: 'sk-view' })
  const foot = h('div', { class: 'sk-row sk-grow' })
  const { el, head } = studyWindow({
    who: STUDY_WHO.bonnie,
    title: 'Ciclo de estudo',
    subtitle: 'Bonnie · diretoria — libera cada etapa quando o critério é cumprido',
    body: [view],
    foot: [foot],
    onClose: () => el.remove(),
    size: 'xl',
  })

  const footBar = el.querySelector('.modal-foot') as HTMLElement
  el.querySelector('.modal')?.classList.add('sk-flush')
  const tell = (message: string) => {
    errorText = message
    render()
  }
  const save = async (action: () => Promise<StudyCycleState>, success?: string | ((state: StudyCycleState) => string | undefined)) => {
    if (busy) return
    busy = true
    errorText = ''
    render()
    try {
      state = await action()
      const message = typeof success === 'function' ? success(state) : success
      if (message) toast(message, 'ok')
    } catch (err) {
      errorText = cleanError(err)
    } finally {
      busy = false
      render()
    }
  }
  const btn = (
    label: string,
    onclick: () => void,
    opts: { primary?: boolean; quiet?: boolean; small?: boolean; disabled?: boolean } = {},
  ) =>
    h(
      'button',
      {
        class: `btn${opts.primary ? ' btn-primary' : ''}${opts.quiet ? ' btn-quiet' : ''}${opts.small ? ' btn-small' : ''}`,
        type: 'button',
        disabled: busy || opts.disabled || undefined,
        onclick,
      },
      label,
    )
  const builderButton = (forTopic: string): HTMLElement | null => {
    if (!options.openBuilder) return null
    const t = trailTopicOf(trail, forTopic)
    return btn('Montar banco deste tópico', () => {
      el.remove()
      options.openBuilder!(t ? { discipline: disciplineIdOf(t.id), topic: t.label } : {})
    })
  }
  const qLabel = (cycle: StudyCycle, id: string) => `Q${cycle.questions.findIndex((q) => q.id === id) + 1}`
  const placeOf = (cycleTopic: string) => {
    const t = trailTopicOf(trail, cycleTopic)
    return t ? `${topicName(cycleTopic)} · ${trailPlace(t)}` : topicName(cycleTopic)
  }

  // ---- stages strip -------------------------------------------------------------------------

  const stepsOf = (cycle: StudyCycle, detailed = false): HTMLElement => {
    const gaps = studyGaps(cycle)
    const at = { diagnosis: 0, 'review-required': 1, practice: 2, 'retest-ready': 3, retest: 3, completed: 4 }[cycle.stage]
    const skipped = at >= 3 && !gaps.length
    const answered = cycle.questions.filter((q) => q.response).length
    const reviewed = gaps.filter((g) => g.review?.cause && g.review.nextStep && g.review.sourceRefs.length).length
    const nowChip = [
      `Em curso · ${answered} de ${cycle.questions.length}`,
      `Em curso · ${reviewed} de ${gaps.length}`,
      `Rodada ${Math.max(1, cycle.practiceRounds.length)}`,
      'Em curso',
    ]
    const steps: StudyStep[] = STEP_NAMES.map((label, i) => ({
      label,
      note: STEP_RULES[i],
      state: i < at ? (skipped && (i === 1 || i === 2) ? 'skipped' : 'done') : i === at ? 'now' : 'locked',
      ...(i === at ? { chip: nowChip[i] } : {}),
    }))
    // the diagnosis gate passed: Bonnie is ready to open the next stage
    const gate = evaluateStudyGate(cycle)
    if (cycle.stage === 'diagnosis' && gate.ready) {
      steps[0] = { ...steps[0]!, state: 'done', chip: 'Gate cumprido' }
      const next = gate.nextStage === 'retest-ready' ? 3 : 1
      steps[next] = { ...steps[next]!, state: 'now', chip: 'Pronto p/ liberar' }
    }
    const attempt = cycle.retests.at(-1)
    const score = cycle.stage === 'retest' && attempt ? retestScore(attempt) : null
    if (score !== null && score >= 80) steps[3] = { ...steps[3]!, chip: 'Concluir' }
    return studySteps(steps, { detailed })
  }

  // ---- no topic: choose one -----------------------------------------------------------------

  const pickerView = (): HTMLElement[] => {
    const chosen = trailTopicOf(trail, topic)
    const kept = state.cycles.filter((cycle) => cycle.id !== state.activeId && cycle.stage !== 'completed').reverse()
    const keptOfTopic = kept.find((cycle) => cycle.topic === topic.trim())
    const trailSelect = h(
      'select',
      {
        class: 'input',
        'aria-label': 'Tópico da trilha de estudos',
        disabled: busy || !trail.topics.length || undefined,
        onchange: (event: Event) => {
          const value = (event.currentTarget as HTMLSelectElement).value
          if (!value) return
          topic = value
          pickForTopic()
          render()
        },
      },
      h(
        'option',
        { value: '' },
        trail.found
          ? trail.topics.length
            ? 'Escolha um tópico da trilha…'
            : 'A trilha não tem tópicos'
          : 'trilha zettel.md não encontrada no vault',
      ),
      ...trail.topics.map((item) =>
        h(
          'option',
          { value: item.label, selected: item.label === topic.trim() || undefined },
          `${item.done ? '✓ ' : ''}${item.title} — ${item.discipline} (${item.index} de ${item.total})`,
        ),
      ),
    )
    const typed = h('input', {
      class: 'input',
      value: chosen ? '' : topic,
      maxlength: '200',
      'aria-label': 'Outro tópico, fora da trilha',
      placeholder: 'ou escreva outro tópico',
      disabled: busy || undefined,
      onchange: (event: Event) => {
        topic = (event.currentTarget as HTMLInputElement).value
        pickForTopic()
        render()
      },
    })
    const all = topic.trim() ? questionsForTopic(fresh(), topic, 60) : []
    const byOrigin = new Map<string, number>()
    for (const q of all.filter((q) => selected.has(q.id)))
      byOrigin.set(originLabel[q.originKind], (byOrigin.get(originLabel[q.originKind]) ?? 0) + 1)
    const questions = !topic.trim()
      ? null
      : all.length
        ? studyPanel(
            'Questões do diagnóstico',
            h(
              'p',
              { class: 'sk-prompt' },
              `A Bonnie separou ${selected.size} ${selected.size === 1 ? 'questão nova' : 'questões novas'} deste tópico.`,
            ),
            h('div', { class: 'sk-row' }, ...[...byOrigin].map(([origin, n]) => studyChip(`${origin} ${n}`))),
            h(
              'p',
              { class: 'sk-small' },
              'Só entram questões que você nunca respondeu. Sem nota mínima: o diagnóstico mostra por onde começar.',
            ),
            h(
              'details',
              { class: 'sk-details' },
              h('summary', {}, `Ver ou trocar as questões (${all.length} novas no banco)`),
              h(
                'ul',
                { class: 'sk-list sk-scroll' },
                ...all.map((q) =>
                  h(
                    'li',
                    {},
                    h(
                      'label',
                      { class: 'sk-item sk-check' },
                      h('input', {
                        type: 'checkbox',
                        checked: selected.has(q.id),
                        disabled: busy || undefined,
                        onchange: (event: Event) => {
                          if ((event.currentTarget as HTMLInputElement).checked) selected.add(q.id)
                          else selected.delete(q.id)
                          render()
                        },
                      }),
                      h(
                        'span',
                        { class: 'sk-item-main' },
                        h('span', { class: 'sk-clip' }, q.question),
                        h('span', {}, `${originLabel[q.originKind]} · ${q.sourceTitle}`),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          )
        : studyPanel(
            'Questões do diagnóstico',
            h('p', { class: 'sk-prompt' }, 'Não há questões novas deste tópico no banco.'),
            h(
              'p',
              { class: 'sk-small' },
              'As que você já respondeu não voltam. Monte o banco do tópico: a cadeia de agentes escreve questões novas a partir dos livros.',
            ),
            builderButton(topic),
          )
    const keptRows = kept.map((cycle) =>
      h(
        'li',
        { class: 'sk-item' },
        h(
          'span',
          { class: 'sk-item-main' },
          h('span', {}, h('b', {}, topicName(cycle.topic))),
          h(
            'span',
            {},
            `${cycle.questions.filter((q) => q.response).length} de ${cycle.questions.length} respondidas · ${new Date(cycle.updatedAt).toLocaleDateString('pt-BR')}`,
          ),
        ),
        studyChip(stageLabel[cycle.stage], 'warn'),
        btn(
          'Retomar',
          () => void save(() => window.office.resumeStudyCycle(cycle.id), `Ciclo de “${topicName(cycle.topic)}” retomado de onde parou.`),
          { small: true },
        ),
      ),
    )
    foot.append(
      h('span', { class: 'sk-small sk-grow' }, 'Um tópico por vez. Trocar de tópico guarda o atual: nada é concluído nem apagado.'),
      btn(
        `Começar diagnóstico${selected.size ? ` (${selected.size})` : ''}`,
        () => {
          const ids = [...selected]
          void save(() => window.office.startStudyCycle(topic, ids), 'Diagnóstico iniciado. O tutor foi chamado para a sala de aula.')
        },
        { primary: true, disabled: !topic.trim() || !selected.size },
      ),
    )
    return [
      h(
        'div',
        { class: 'sk-section' },
        h('h2', { class: 'sk-empty-title' }, topic.trim() ? topicName(topic) : 'Nenhum tópico escolhido'),
        h(
          'p',
          { class: 'sk-small' },
          chosen
            ? `${trailPlace(chosen)}${chosen.done ? ' · marcado como estudado na trilha' : ''}`
            : 'Um tópico por vez. Escolha o próximo na Trilha de estudos; a Bonnie separa questões novas do banco, abre o Diagnóstico e chama o tutor.',
        ),
        studySteps(
          STEP_NAMES.map((label) => ({ label, state: 'locked' })),
          { dashed: true },
        ),
        h(
          'div',
          { class: 'sk-row' },
          h('div', { class: 'sk-grow' }, studyLabel('Tópico da trilha'), trailSelect),
          h('div', { style: 'flex:0 0 280px' }, studyLabel('Fora da trilha'), typed),
        ),
        keptOfTopic
          ? studyBanner(
              'warn',
              'Já há trabalho guardado',
              'Este tópico tem um ciclo guardado: retome-o abaixo para continuar de onde parou.',
            )
          : null,
        questions,
        keptRows.length ? h('div', {}, studyLabel('Com trabalho guardado'), h('ul', { class: 'sk-list' }, ...keptRows)) : null,
      ),
    ]
  }

  // ---- 1 · diagnosis ------------------------------------------------------------------------

  const questionCell = (cycle: StudyCycle, q: StudyCycleQuestion, i: number, current: number, onPick: (i: number) => void) => {
    const kind = q.assessment?.kind
    const cls = !q.response
      ? ''
      : kind === 'pending'
        ? ' sk-cell-pending'
        : q.uncertain || kind === 'uncertain'
          ? ' sk-cell-doubt'
          : ' sk-cell-done'
    const label = `${i + 1}${q.response && q.uncertain ? '?' : ''}`
    return h(
      'button',
      {
        class: `sk-cell${cls}`,
        type: 'button',
        'aria-current': i === current ? 'true' : undefined,
        'aria-label': `Questão ${i + 1}${!q.response ? ', sem resposta' : kind === 'pending' ? ', em verificação' : q.uncertain ? ', respondida com dúvida' : ', respondida'}`,
        onclick: () => onPick(i),
      },
      label,
    )
  }

  const diagnosisQuestions = (cycle: StudyCycle): HTMLElement[] => {
    const total = cycle.questions.length
    index = Math.min(index, total - 1)
    const item = cycle.questions[index]!
    const answered = cycle.questions.filter((q) => q.response).length
    const draft = drafts.get(item.id) ?? { response: item.response, excerpt: item.providedExcerpt, uncertain: item.uncertain }
    const keep = () => drafts.set(item.id, draft)
    const open = cycle.stage === 'diagnosis'
    const response = h('textarea', {
      class: 'input sk-answer',
      maxlength: '20000',
      'aria-label': `Sua resposta para a questão ${index + 1}`,
      disabled: busy || !open || undefined,
      oninput: (event: Event) => {
        draft.response = (event.currentTarget as HTMLTextAreaElement).value
        keep()
      },
    })
    response.value = draft.response
    const excerpt = h('textarea', {
      class: 'input sk-answer',
      maxlength: '20000',
      style: 'min-height:56px',
      'aria-label': `Trecho de apoio para o Tutor na questão ${index + 1}`,
      placeholder:
        item.source.answerStatus === 'verified' ? 'Opcional' : 'Sem gabarito conferido: cole um trecho de apoio escolhido por você',
      disabled: busy || !open || undefined,
      oninput: (event: Event) => {
        draft.excerpt = (event.currentTarget as HTMLTextAreaElement).value
        keep()
      },
    })
    excerpt.value = draft.excerpt
    const choice = (value: boolean, label: string) =>
      h(
        'label',
        { class: `sk-choice${value ? ' sk-choice-doubt' : ''}` },
        h('input', {
          type: 'radio',
          name: `doubt-${item.id}`,
          checked: draft.uncertain === value || undefined,
          disabled: busy || !open || undefined,
          onchange: () => {
            draft.uncertain = value
            keep()
          },
        }),
        label,
      )
    const saveAnswer = (verify: boolean) => {
      if (!draft.response.trim() || draft.uncertain === null) {
        tell('Escreva sua resposta e marque se tem certeza ou está em dúvida.')
        return
      }
      void save(
        async () => {
          const next = await window.office.answerStudyCycle(item.id, draft.response, draft.uncertain!, draft.excerpt)
          drafts.delete(item.id)
          return verify ? window.office.evaluateStudyAnswer(item.id) : next
        },
        verify ? undefined : 'Resposta salva neste computador.',
      )
    }
    const assessment = item.assessment
      ? h('div', { class: 'sk-row' }, kindChip(item.assessment.kind), h('span', { class: 'sk-small' }, item.assessment.rationale))
      : h('p', { class: 'sk-small' }, item.response ? 'Salva. Ainda não verificada pelo Tutor.' : 'Ainda sem resposta.')
    const byOrigin = new Map<string, number>()
    for (const q of cycle.questions)
      byOrigin.set(originLabel[q.source.originKind], (byOrigin.get(originLabel[q.source.originKind]) ?? 0) + 1)
    const pending = cycle.questions.findIndex((q) => q.assessment?.kind === 'pending')
    return [
      h(
        'div',
        { class: 'sk-split' },
        h(
          'div',
          { class: 'sk-col' },
          h(
            'div',
            { class: 'sk-row' },
            h('b', {}, `Questão ${index + 1} de ${total}`),
            h('div', { class: 'sk-grow' }, studyMeterBar(answered, total, undefined, 'Questões respondidas')),
            h('span', { class: 'sk-small sk-mono' }, `${answered} respondidas`),
          ),
          h(
            'div',
            { class: 'sk-card' },
            h(
              'div',
              { class: 'sk-row' },
              studyChip(originLabel[item.source.originKind], 'info'),
              h(
                'span',
                { class: 'sk-small' },
                `${item.source.sourceTitle}${item.source.answerStatus === 'verified' ? ' · gabarito conferido' : ' · gabarito não conferido'}`,
              ),
            ),
            ...promptOf(item.source),
            isChoiceQuestion(item.source)
              ? h(
                  'div',
                  {},
                  studyLabel('Sua resposta'),
                  answerControl(
                    item.source,
                    draft.response,
                    (value) => {
                      draft.response = value
                      keep()
                    },
                    {
                      disabled: busy || !open,
                      reveal: !!item.assessment && item.assessment.kind !== 'pending',
                      label: `Alternativas da questão ${index + 1}`,
                    },
                  ),
                )
              : h('label', {}, studyLabel('Sua resposta'), response),
            isChoiceQuestion(item.source) ? null : h('label', {}, studyLabel('Trecho de apoio para o Tutor (opcional)'), excerpt),
          ),
          studyPanel(
            'Marcar incerteza · obrigatório',
            h(
              'div',
              { class: 'sk-row', role: 'radiogroup', 'aria-label': 'Incerteza' },
              choice(false, 'Tenho certeza'),
              choice(true, 'Estou em dúvida'),
            ),
            h('p', { class: 'sk-small' }, 'A dúvida vai para Erros e dúvidas mesmo se você acertar.'),
          ),
          assessment,
          h(
            'div',
            { class: 'sk-row' },
            btn(
              'Anterior',
              () => {
                index = Math.max(0, index - 1)
                render()
              },
              { disabled: index === 0 },
            ),
            h('span', { class: 'sk-grow' }),
            open ? btn('Salvar', () => saveAnswer(false)) : null,
            open
              ? btn(isChoiceQuestion(item.source) ? 'Salvar e conferir' : 'Salvar e verificar com Tutor', () => saveAnswer(true), {
                  primary: true,
                })
              : null,
            btn(
              'Próxima questão',
              () => {
                index = Math.min(total - 1, index + 1)
                render()
              },
              { disabled: index >= total - 1 },
            ),
          ),
          h(
            'p',
            { class: 'sk-small' },
            'As respostas ficam neste computador. Só ao verificar, esta questão, sua resposta e o gabarito (ou o trecho escolhido) vão ao Claude.',
          ),
        ),
        h(
          'div',
          { class: 'sk-col' },
          studyPanel(
            'Questões',
            h(
              'div',
              { class: 'sk-grid' },
              ...cycle.questions.map((q, i) =>
                questionCell(cycle, q, i, index, (n) => {
                  index = n
                  render()
                }),
              ),
            ),
            h(
              'div',
              { class: 'sk-col', style: 'gap:6px;margin-top:6px' },
              h(
                'span',
                { class: 'sk-row sk-small' },
                h('span', { class: 'sk-cell sk-cell-done', style: 'width:28px;height:22px' }),
                'respondida',
              ),
              h(
                'span',
                { class: 'sk-row sk-small' },
                h('span', { class: 'sk-cell sk-cell-doubt', style: 'width:28px;height:22px' }),
                'respondida com dúvida',
              ),
              h(
                'span',
                { class: 'sk-row sk-small' },
                h('span', { class: 'sk-cell sk-cell-pending', style: 'width:28px;height:22px' }),
                'em verificação',
              ),
            ),
          ),
          pending >= 0
            ? studyPanel(
                null,
                h('div', {}, studyChip('Em verificação', 'warn')),
                h(
                  'p',
                  { class: 'sk-small' },
                  `Questão ${pending + 1}: o tutor não teve evidência para decidir. Verifique de novo; ela não conta como erro nem acerto.`,
                ),
              )
            : null,
          studyPanel('Origem das questões', h('div', { class: 'sk-row' }, ...[...byOrigin].map(([o, n]) => studyChip(`${o} ${n}`)))),
        ),
      ),
    ]
  }

  const diagnosisGate = (cycle: StudyCycle): StudyGateItem[] => {
    const total = cycle.questions.length
    const answered = cycle.questions.filter((q) => q.response).length
    const marked = cycle.questions.filter((q) => q.uncertain !== null).length
    const checked = cycle.questions.filter((q) => q.assessment && q.assessment.kind !== 'pending').length
    return [
      { state: answered === total ? 'ok' : 'todo', text: 'Todas respondidas', note: `${answered} de ${total}` },
      { state: marked === total ? 'ok' : 'todo', text: 'Incertezas marcadas', note: `${marked} de ${total}` },
      {
        state: checked === total ? 'ok' : cycle.questions.some((q) => q.assessment?.kind === 'pending') ? 'pending' : 'todo',
        text: 'Verificadas pelo tutor',
        note: `${checked} de ${total}`,
      },
    ]
  }

  const sourcesFor = (gap: StudyCycleQuestion): HTMLElement => {
    const result = gapSources.get(gap.id)
    if (result === undefined) {
      gapSources.set(gap.id, 'loading')
      window.office
        .recommendStudySources([studyQueryOfQuestion(gap.source)])
        .then((all) => gapSources.set(gap.id, all[0] ?? 'error'))
        .catch(() => gapSources.set(gap.id, 'error'))
        .finally(() => el.isConnected && render())
    }
    if (result === 'loading' || result === undefined)
      return h('p', { class: 'sk-small', role: 'status' }, 'Cora está procurando nas fontes locais…')
    if (result === 'error') return h('p', { class: 'sk-small' }, 'Cora não conseguiu ler a biblioteca local agora.')
    return studySourceList(result, toast, true, 5)
  }

  const diagnosisResult = (cycle: StudyCycle): HTMLElement[] => {
    const gaps = studyGaps(cycle)
    const count = (kind: Kind) => cycle.questions.filter((q) => q.assessment?.kind === kind).length
    const correct = count('correct')
    const counted = correct + count('incorrect')
    const doubts = cycle.questions.filter((q) => q.uncertain || q.assessment?.kind === 'uncertain').length
    if (!gaps.some((g) => g.id === gapId)) gapId = gaps[0]?.id ?? ''
    const gap = gaps.find((g) => g.id === gapId)
    return [
      h(
        'div',
        { class: 'sk-split sk-split-left' },
        h(
          'div',
          { class: 'sk-col' },
          studyPanel(
            'Resultado',
            h(
              'div',
              { class: 'sk-score' },
              h('span', { class: 'sk-score-value' }, `${counted ? Math.round((correct / counted) * 100) : 0}%`),
              h('span', { class: 'sk-small' }, `${correct} de ${counted} contadas`),
            ),
            h(
              'div',
              { class: 'sk-row' },
              studyChip(`${correct} certas`, 'ok'),
              studyChip(`${count('incorrect')} erradas`, 'err'),
              studyChip(`${doubts} incertas`, 'pink'),
            ),
            h('p', { class: 'sk-small' }, 'Sem nota mínima no diagnóstico. Ele só mostra por onde começar.'),
          ),
          gaps.length
            ? h(
                'div',
                {},
                studyLabel(`Para revisar · ${gaps.length}`),
                h(
                  'ul',
                  { class: 'sk-list' },
                  ...gaps.map((g) =>
                    h(
                      'li',
                      {},
                      h(
                        'button',
                        {
                          class: 'sk-item',
                          type: 'button',
                          'aria-current': g.id === gapId ? 'true' : undefined,
                          onclick: () => {
                            gapId = g.id
                            render()
                          },
                        },
                        kindChip(gapKind(g)),
                        h('b', { class: 'sk-mono' }, qLabel(cycle, g.id)),
                        h('span', { class: 'sk-clip sk-grow' }, g.source.question),
                      ),
                    ),
                  ),
                ),
              )
            : null,
        ),
        h(
          'div',
          { class: 'sk-col' },
          gap
            ? h(
                'div',
                { class: 'sk-col' },
                h(
                  'div',
                  { class: 'sk-card' },
                  h(
                    'div',
                    { class: 'sk-row' },
                    kindChip(gapKind(gap)),
                    h('b', { class: 'sk-mono' }, qLabel(cycle, gap.id)),
                    studyChip(originLabel[gap.source.originKind], 'info'),
                  ),
                  ...promptOf(gap.source),
                  h(
                    'p',
                    { class: 'sk-small' },
                    `Sua resposta: ${answerText(gap.source, gap.response)}${gap.uncertain ? ' (com dúvida)' : ''}`,
                    gap.source.answer ? ` · Gabarito: ${answerText(gap.source, gap.source.answer)}` : '',
                  ),
                  passageOf(gap.source),
                ),
                studyHeading(`Fontes da Cora para a ${qLabel(cycle, gap.id)}`, 'biblioteca local · da melhor para a pior'),
                sourcesFor(gap),
              )
            : studyPanel(
                'Sem erros nem dúvidas',
                h('p', { class: 'sk-prompt' }, 'A Bonnie pula Erros e dúvidas e Prática e fontes e libera o Reteste.'),
                h('p', { class: 'sk-small' }, 'Ela não inventa uma lacuna para forçar a prática.'),
              ),
        ),
      ),
    ]
  }

  // ---- 2 · errors and doubts ----------------------------------------------------------------

  const hitsFor = (gap: StudyCycleQuestion): StudyLibrarySearch | 'loading' | 'error' => {
    const found = gapHits.get(gap.id)
    if (found) return found
    gapHits.set(gap.id, 'loading')
    window.office
      .searchStudyLibrary(gapQuery.get(gap.id) ?? studyQueryOfQuestion(gap.source))
      .then((result) => gapHits.set(gap.id, result))
      .catch(() => gapHits.set(gap.id, 'error'))
      .finally(() => el.isConnected && render())
    return 'loading'
  }

  const reviewDone = (g: StudyCycleQuestion) => !!g.review?.cause && !!g.review.nextStep && g.review.sourceRefs.length > 0

  /** The passages Cora found for a gap: tick one to link it; in the practice, write a note on it. */
  const gapSourcesBox = (
    cycle: StudyCycle,
    gap: StudyCycleQuestion,
    mode: 'review' | 'practice',
    beforeLink?: () => Promise<StudyCycleState> | null,
  ): HTMLElement => {
    const hits = hitsFor(gap)
    const linked = gap.review?.sourceRefs ?? []
    const search = h('input', {
      class: 'input',
      maxlength: '200',
      'aria-label': `Buscar outro trecho para a ${qLabel(cycle, gap.id)}`,
      placeholder: 'Buscar outro termo nas fontes locais',
      value: gapQuery.get(gap.id) ?? '',
    })
    const rows: HTMLElement[] = []
    if (hits === 'loading') rows.push(h('p', { class: 'sk-small', role: 'status' }, 'Cora está procurando trechos…'))
    else if (hits === 'error') rows.push(h('p', { class: 'sk-small' }, 'Cora não conseguiu ler a biblioteca local agora.'))
    else {
      if (hits.warning) rows.push(h('p', { class: 'sk-small' }, hits.warning))
      if (!hits.hits.length) rows.push(h('p', { class: 'sk-small' }, 'Nenhum trecho local corresponde. Tente outro termo.'))
      for (const hit of hits.hits.slice(0, 6)) {
        const isLinked = linked.includes(hit.sourceRef)
        const notes = cycle.notes.filter((n) => n.gapQuestionId === gap.id && n.sourceRef === hit.sourceRef).length
        const noteKey = `${gap.id}|${hit.id}`
        const noteBox =
          mode === 'practice' && noteOpen === noteKey
            ? h(
                'div',
                { class: 'sk-col', style: 'gap:6px;margin-top:6px' },
                h('textarea', {
                  class: 'input sk-answer',
                  maxlength: '10000',
                  'aria-label': `Nota sobre ${hit.title}`,
                  placeholder: 'Sua nota durante a leitura (não é um cartão).',
                  oninput: (event: Event) => noteDrafts.set(noteKey, (event.currentTarget as HTMLTextAreaElement).value),
                }),
                h(
                  'div',
                  { class: 'sk-row' },
                  btn(
                    'Salvar nota no Obsidian',
                    () => {
                      const text = noteDrafts.get(noteKey) ?? ''
                      if (!text.trim()) return tell('Escreva a nota antes de salvar.')
                      void save(async () => {
                        const next = await window.office.saveStudyCycleNote(gap.id, hits.token, hit.id, text)
                        noteDrafts.delete(noteKey)
                        noteOpen = ''
                        return next
                      }, 'Nota salva em notas-estudo.md.')
                    },
                    { primary: true, small: true },
                  ),
                  btn(
                    'Cancelar',
                    () => {
                      noteOpen = ''
                      render()
                    },
                    { small: true, quiet: true },
                  ),
                ),
              )
            : null
        rows.push(
          h(
            'li',
            { class: 'sk-item', style: 'flex-wrap:wrap' },
            h(
              'label',
              { class: 'sk-check sk-grow', style: 'min-width:0' },
              h('input', {
                type: 'checkbox',
                checked: isLinked || undefined,
                disabled: busy || isLinked || undefined,
                'aria-label': `Ligar ${hit.title} à ${qLabel(cycle, gap.id)}`,
                onchange: () =>
                  void save(async () => {
                    const first = beforeLink?.()
                    if (first) await first
                    return window.office.attachStudySource(gap.id, hits.token, hit.id)
                  }, 'Fonte ligada ao erro.'),
              }),
              h(
                'span',
                { class: 'sk-item-main' },
                h('span', { class: 'sk-clip' }, h('b', {}, hit.title)),
                h('span', { class: 'sk-clip' }, hit.line ? `${hit.sourceRef} · linha ${hit.line}` : hit.sourceRef),
              ),
            ),
            mode === 'practice'
              ? notes
                ? studyChip(`${notes} ${notes === 1 ? 'nota' : 'notas'}`, 'ok')
                : btn(
                    'Registrar nota',
                    () => {
                      noteOpen = noteKey
                      render()
                    },
                    { small: true },
                  )
              : null,
            noteBox ? h('div', { style: 'flex-basis:100%' }, noteBox) : null,
          ),
        )
      }
    }
    const folded =
      mode === 'practice' && hits !== 'loading' && hits !== 'error'
        ? rows.filter((row) => row.tagName === 'LI' && !row.querySelector('input:checked'))
        : []
    const shown = rows.filter((row) => !folded.includes(row))
    return h(
      'div',
      { class: 'sk-col', style: 'gap:8px' },
      h('ul', { class: 'sk-list' }, ...shown),
      folded.length
        ? h(
            'details',
            { class: 'sk-details' },
            h('summary', {}, `Ligar outro trecho (${folded.length})`),
            h('ul', { class: 'sk-list' }, ...folded),
          )
        : null,
      h(
        'div',
        { class: 'sk-row' },
        h('div', { class: 'sk-grow' }, search),
        btn(
          'Buscar',
          () => {
            gapQuery.set(gap.id, search.value)
            gapHits.delete(gap.id)
            render()
          },
          { small: true },
        ),
      ),
    )
  }

  const reviewView = (cycle: StudyCycle): HTMLElement[] => {
    const gaps = studyGaps(cycle)
    if (!gaps.some((g) => g.id === gapId)) gapId = gaps.find((g) => !reviewDone(g))?.id ?? gaps[0]?.id ?? ''
    const gap = gaps.find((g) => g.id === gapId)!
    const done = gaps.filter(reviewDone).length
    const draft = reviewDrafts.get(gap.id) ?? { cause: gap.review?.cause ?? '', nextStep: gap.review?.nextStep ?? '' }
    const keep = () => reviewDrafts.set(gap.id, draft)
    const field = (label: string, key: 'cause' | 'nextStep') => {
      const area = h('textarea', {
        class: 'input sk-answer',
        style: 'min-height:56px',
        maxlength: '2000',
        'aria-label': label,
        disabled: busy || undefined,
        oninput: (event: Event) => {
          draft[key] = (event.currentTarget as HTMLTextAreaElement).value
          keep()
        },
      })
      area.value = draft[key]
      return h('label', {}, studyLabel(`${label} *`), area)
    }
    const dirty = draft.cause !== (gap.review?.cause ?? '') || draft.nextStep !== (gap.review?.nextStep ?? '')
    /** Linking a source needs the cause and next step saved first. */
    const saveReview = (): Promise<StudyCycleState> | null => {
      if (!dirty && gap.review) return null
      if (!draft.cause.trim() || !draft.nextStep.trim()) throw new Error('Escreva a causa e o próximo passo antes de ligar uma fonte.')
      return window.office.reviewStudyGap(gap.id, draft.cause, draft.nextStep)
    }
    const nextGap = gaps.find((g, i) => i > gaps.indexOf(gap) && !reviewDone(g)) ?? gaps.find((g) => g !== gap && !reviewDone(g))
    return [
      h(
        'div',
        { class: 'sk-split sk-split-left' },
        h(
          'div',
          { class: 'sk-col' },
          studyLabel(`Erradas e incertas · ${done} de ${gaps.length} explicadas`),
          h(
            'ul',
            { class: 'sk-list' },
            ...gaps.map((g) =>
              h(
                'li',
                {},
                h(
                  'button',
                  {
                    class: 'sk-item',
                    type: 'button',
                    style: 'flex-wrap:wrap',
                    'aria-current': g.id === gapId ? 'true' : undefined,
                    onclick: () => {
                      gapId = g.id
                      render()
                    },
                  },
                  kindChip(gapKind(g)),
                  h('b', { class: 'sk-mono sk-grow' }, qLabel(cycle, g.id)),
                  reviewDone(g) ? studyChip('Feito', 'ok') : g.id === gapId ? studyChip('Agora', 'warn') : studyChip('Falta', 'mute'),
                  h(
                    'span',
                    { class: 'sk-small', style: 'flex-basis:100%' },
                    g.review?.cause ? `Causa: ${g.review.cause}` : g.source.question.slice(0, 90),
                  ),
                ),
              ),
            ),
          ),
        ),
        h(
          'div',
          { class: 'sk-col' },
          h(
            'div',
            { class: 'sk-card' },
            h(
              'div',
              { class: 'sk-row' },
              kindChip(gapKind(gap)),
              h('b', { class: 'sk-mono' }, qLabel(cycle, gap.id)),
              studyChip(`${originLabel[gap.source.originKind]} · ${gap.source.sourceTitle}`, 'info'),
            ),
            ...promptOf(gap.source),
            h(
              'p',
              { class: 'sk-small' },
              `Sua resposta: ${answerText(gap.source, gap.response)}${gap.uncertain ? ' · você marcou dúvida' : ''}`,
            ),
            gap.assessment?.rationale ? h('p', { class: 'sk-small' }, `Tutor: ${gap.assessment.rationale}`) : null,
            passageOf(gap.source),
          ),
          field('Causa · por que errou ou ficou em dúvida', 'cause'),
          field('Próximo passo', 'nextStep'),
          h('div', {}, studyLabel('Fontes ligadas (da Cora)'), gapSourcesBox(cycle, gap, 'review', saveReview)),
          h(
            'div',
            { class: 'sk-row' },
            h('span', { class: 'sk-grow' }),
            btn(
              nextGap ? `Salvar e ir para ${qLabel(cycle, nextGap.id)}` : 'Salvar',
              () => {
                if (!draft.cause.trim() || !draft.nextStep.trim()) return tell('Escreva a causa e o próximo passo.')
                void save(async () => {
                  const next = await window.office.reviewStudyGap(gap.id, draft.cause, draft.nextStep)
                  reviewDrafts.delete(gap.id)
                  if (nextGap) gapId = nextGap.id
                  return next
                }, 'Causa e próximo passo salvos.')
              },
              { primary: true },
            ),
          ),
        ),
      ),
    ]
  }

  // ---- 3 · practice and sources -------------------------------------------------------------

  const usedIn = (cycle: StudyCycle) => {
    const ids = new Set(cycle.questions.map((q) => q.id))
    const prompts = new Set(cycle.questions.map((q) => normalizePrompt(q.source.question)))
    for (const set of [...cycle.practiceRounds, ...cycle.retests])
      for (const q of set.questions) {
        ids.add(q.id)
        prompts.add(normalizePrompt(q.source.question))
      }
    return (q: StudyQuestion) => ids.has(q.id) || prompts.has(normalizePrompt(q.question))
  }

  /** New verified questions for the cycle's topic, best match first; the gaps' topics when the cycle's finds few. */
  const proposals = (cycle: StudyCycle, limit: number): StudyQuestion[] => {
    const used = usedIn(cycle)
    const pool = fresh().filter((q) => verifiedQuestion(q) && !used(q))
    const out: StudyQuestion[] = []
    const add = (list: StudyQuestion[]) => list.forEach((q) => !out.some((o) => o.id === q.id) && out.push(q))
    add(questionsForTopic(pool, cycle.topic, limit))
    for (const gap of studyGaps(cycle)) if (out.length < limit) add(questionsForTopic(pool, gap.source.topic, limit))
    return out.slice(0, limit)
  }

  const practiceView = (cycle: StudyCycle): HTMLElement[] => {
    const gaps = studyGaps(cycle)
    const round = cycle.practiceRounds.at(-1)
    const roundDone =
      !!round && round.questions.every((q) => !!q.response && !!q.assessment && !['pending', 'uncertain'].includes(q.assessment.kind))
    const score = round && roundDone ? practiceScore(round) : null
    const needRound = !round || (roundDone && (score ?? 0) < 80)
    const target = Math.min(8, Math.max(4, gaps.length * 2))
    const offer = needRound ? proposals(cycle, 30) : []
    if (needRound && !practicePick) practicePick = new Set(offer.slice(0, target).map((q) => q.id))
    const correct = round?.questions.filter((q) => q.assessment?.kind === 'correct').length ?? 0
    const checked = round?.questions.filter((q) => q.assessment && !['pending', 'uncertain'].includes(q.assessment.kind)).length ?? 0
    if (round && !round.questions.some((q) => q.id === practiceId))
      practiceId = round.questions.find((q) => !q.assessment || q.assessment.kind === 'pending')?.id ?? ''
    const current = round?.questions.find((q) => q.id === practiceId)

    const left = h(
      'div',
      { class: 'sk-col' },
      studyHeading('Fontes ligadas aos erros', 'trechos indicados pela Cora'),
      ...gaps.map((gap) =>
        h(
          'div',
          { class: 'sk-col', style: 'gap:6px' },
          h(
            'div',
            { class: 'sk-row' },
            kindChip(gapKind(gap)),
            h('b', { class: 'sk-mono' }, qLabel(cycle, gap.id)),
            h('span', { class: 'sk-clip sk-grow sk-small' }, gap.review?.nextStep ?? gap.source.question),
          ),
          gapSourcesBox(cycle, gap, 'practice'),
        ),
      ),
      h(
        'p',
        { class: 'sk-small' },
        '“Registrar nota” salva a nota já ligada à questão e à fonte em notas-estudo.md. Não há etapa de notas separada.',
      ),
    )

    const practiceForm = (item: StudyPracticeQuestion): HTMLElement => {
      const draft = drafts.get(item.id) ?? { response: item.response, excerpt: '', uncertain: null }
      const area = h('textarea', {
        class: 'input sk-answer',
        maxlength: '20000',
        'aria-label': 'Sua resposta da prática',
        disabled: busy || undefined,
        oninput: (event: Event) => {
          draft.response = (event.currentTarget as HTMLTextAreaElement).value
          drafts.set(item.id, draft)
        },
      })
      area.value = draft.response
      const send = (verify: boolean) => {
        if (!draft.response.trim()) return tell('Escreva sua resposta.')
        void save(
          async () => {
            const next = await window.office.answerStudyPractice(item.id, draft.response)
            drafts.delete(item.id)
            return verify ? window.office.evaluateStudyPractice(item.id) : next
          },
          verify ? undefined : 'Resposta da prática salva.',
        )
      }
      return h(
        'div',
        { class: 'sk-card' },
        h(
          'div',
          { class: 'sk-row' },
          h('b', { class: 'sk-mono' }, `P${round!.questions.indexOf(item) + 1}`),
          h(
            'span',
            { class: 'sk-small' },
            `ligada a ${item.gapQuestionIds.map((id) => qLabel(cycle, id)).join(', ')} · gabarito conferido`,
          ),
        ),
        ...promptOf(item.source),
        isChoiceQuestion(item.source)
          ? h(
              'div',
              {},
              studyLabel('Sua resposta'),
              answerControl(
                item.source,
                draft.response,
                (value) => {
                  draft.response = value
                  drafts.set(item.id, draft)
                },
                { disabled: busy, reveal: !!item.assessment && item.assessment.kind !== 'pending', label: 'Alternativas da prática' },
              ),
            )
          : h('label', {}, studyLabel('Sua resposta'), area),
        item.assessment
          ? h('div', { class: 'sk-row' }, kindChip(item.assessment.kind), h('span', { class: 'sk-small' }, item.assessment.rationale))
          : null,
        item.assessment && item.assessment.kind !== 'pending' ? passageOf(item.source) : null,
        h(
          'div',
          { class: 'sk-row' },
          h('span', { class: 'sk-grow' }),
          btn('Salvar', () => send(false)),
          btn(isChoiceQuestion(item.source) ? 'Salvar e conferir' : 'Salvar e verificar com Curador', () => send(true), { primary: true }),
        ),
      )
    }

    const proposal = needRound
      ? studyPanel(
          round ? `Rodada ${cycle.practiceRounds.length + 1} · questões novas` : 'Questões de prática',
          round
            ? h(
                'p',
                { class: 'sk-small' },
                `A rodada ${cycle.practiceRounds.length} ficou em ${score}%. A Bonnie revisa os erros e propõe questões novas.`,
              )
            : null,
          offer.length
            ? h(
                'div',
                { class: 'sk-col', style: 'gap:8px' },
                h('p', { class: 'sk-prompt' }, `A Bonnie propõe ${practicePick!.size} questões novas, ligadas aos erros.`),
                h(
                  'ul',
                  { class: 'sk-list sk-scroll' },
                  ...offer.map((q) =>
                    h(
                      'li',
                      {},
                      h(
                        'label',
                        { class: 'sk-item sk-check' },
                        h('input', {
                          type: 'checkbox',
                          checked: practicePick!.has(q.id) || undefined,
                          onchange: (event: Event) => {
                            if ((event.currentTarget as HTMLInputElement).checked) practicePick!.add(q.id)
                            else practicePick!.delete(q.id)
                            render()
                          },
                        }),
                        h(
                          'span',
                          { class: 'sk-item-main' },
                          h('span', { class: 'sk-clip' }, q.question),
                          h('span', {}, `${originLabel[q.originKind]} · ${q.sourceTitle}`),
                        ),
                      ),
                    ),
                  ),
                ),
                btn(
                  `Começar rodada com ${practicePick!.size} ${practicePick!.size === 1 ? 'questão' : 'questões'}`,
                  () => {
                    const ids = [...practicePick!]
                    const links = ids.map((id, i) => ({ id, gapQuestionIds: [gaps[i % gaps.length]!.id] }))
                    practicePick = null
                    void save(() => window.office.startStudyPractice(links), 'Rodada de prática planejada. O curador foi chamado.')
                  },
                  { primary: true, disabled: !practicePick!.size },
                ),
              )
            : h(
                'div',
                { class: 'sk-col', style: 'gap:8px' },
                h('p', { class: 'sk-prompt' }, 'Não há questões novas deste tópico no banco.'),
                h('p', { class: 'sk-small' }, 'As já respondidas não voltam. Monte o banco do tópico para continuar a prática.'),
                builderButton(cycle.topic),
              ),
        )
      : null

    const right = h(
      'div',
      { class: 'sk-col' },
      round
        ? studyPanel(
            `Questões de prática · rodada ${cycle.practiceRounds.length}`,
            h(
              'div',
              { class: 'sk-score' },
              h('span', { class: 'sk-score-value' }, `${checked ? Math.round((correct / checked) * 100) : 0}%`),
              h(
                'span',
                { class: 'sk-small' },
                `${correct} de ${checked} certas · meta 80% · ${round.questions.filter((q) => q.response).length} de ${round.questions.length} feitas`,
              ),
            ),
            studyMeterBar(checked ? Math.round((correct / checked) * 100) : 0, 100, 80, 'Acertos na prática'),
          )
        : null,
      round
        ? h(
            'ul',
            { class: 'sk-list' },
            ...round.questions.map((q, i) =>
              h(
                'li',
                {},
                h(
                  'button',
                  {
                    class: 'sk-item',
                    type: 'button',
                    'aria-current': q.id === practiceId ? 'true' : undefined,
                    onclick: () => {
                      practiceId = q.id
                      render()
                    },
                  },
                  h('b', { class: 'sk-mono' }, `P${i + 1}`),
                  h('span', { class: 'sk-clip sk-grow' }, q.source.question),
                  h('span', { class: 'sk-small sk-mono' }, q.gapQuestionIds.map((id) => qLabel(cycle, id)).join(' ')),
                  q.assessment ? kindChip(q.assessment.kind) : q.response ? studyChip('Salva', 'mute') : studyChip('Responder', 'now'),
                ),
              ),
            ),
          )
        : null,
      current && !needRound ? practiceForm(current) : null,
      proposal,
    )
    return [h('div', { class: 'sk-split', style: 'grid-template-columns:minmax(0,1fr) minmax(0,1fr)' }, left, right)]
  }

  const practiceGate = (cycle: StudyCycle): StudyGateItem[] => {
    const gaps = studyGaps(cycle)
    const round = cycle.practiceRounds.at(-1)
    const roundDone =
      !!round && round.questions.every((q) => !!q.response && !!q.assessment && !['pending', 'uncertain'].includes(q.assessment.kind))
    const score = round && roundDone ? practiceScore(round) : null
    const missing = round ? round.questions.filter((q) => !q.assessment || ['pending', 'uncertain'].includes(q.assessment.kind)).length : 0
    return [
      {
        state: gaps.every((g) => g.review?.sourceRefs.length) ? 'ok' : 'todo',
        text: 'Fontes ligadas',
        note: `${gaps.filter((g) => g.review?.sourceRefs.length).length} de ${gaps.length}`,
      },
      { state: cycle.notes.length ? 'ok' : 'todo', text: `Notas: ${cycle.notes.length}` },
      {
        state: score !== null && score >= 80 ? 'ok' : round?.questions.some((q) => q.assessment?.kind === 'pending') ? 'pending' : 'todo',
        text: score === null ? (round ? `80% · falta${missing === 1 ? '' : 'm'} ${missing}` : '80% · sem rodada') : `${score}% · meta 80%`,
      },
    ]
  }

  // ---- 4 · retest ---------------------------------------------------------------------------

  const retestPicker = (cycle: StudyCycle, again: boolean): HTMLElement => {
    const offer = proposals(cycle, 40)
    if (!retestPick) retestPick = new Set(offer.slice(0, RETEST_SIZE).map((q) => q.id))
    return studyPanel(
      again ? 'Novo reteste · questões novas' : 'Questões do reteste',
      offer.length >= RETEST_MIN
        ? h(
            'div',
            { class: 'sk-col', style: 'gap:8px' },
            h(
              'p',
              { class: 'sk-prompt' },
              `A Bonnie separou ${retestPick.size} questões novas, com gabarito conferido. Mínimo ${RETEST_MIN}.`,
            ),
            h(
              'details',
              { class: 'sk-details' },
              h('summary', {}, `Ver ou trocar as questões (${offer.length} novas)`),
              h(
                'ul',
                { class: 'sk-list sk-scroll' },
                ...offer.map((q) =>
                  h(
                    'li',
                    {},
                    h(
                      'label',
                      { class: 'sk-item sk-check' },
                      h('input', {
                        type: 'checkbox',
                        checked: retestPick!.has(q.id) || undefined,
                        onchange: (event: Event) => {
                          if ((event.currentTarget as HTMLInputElement).checked) retestPick!.add(q.id)
                          else retestPick!.delete(q.id)
                          render()
                        },
                      }),
                      h(
                        'span',
                        { class: 'sk-item-main' },
                        h('span', { class: 'sk-clip' }, q.question),
                        h('span', {}, `${originLabel[q.originKind]} · ${q.sourceTitle}`),
                      ),
                    ),
                  ),
                ),
              ),
            ),
            h(
              'div',
              { class: 'sk-row' },
              btn(
                `Começar reteste (${retestPick.size})`,
                () => {
                  const ids = [...retestPick!]
                  retestPick = null
                  index = 0
                  void save(() => window.office.startStudyRetest(ids), 'Reteste iniciado. O verificador foi chamado.')
                },
                { primary: true, disabled: retestPick.size < RETEST_MIN },
              ),
            ),
          )
        : h(
            'div',
            { class: 'sk-col', style: 'gap:8px' },
            h(
              'p',
              { class: 'sk-prompt' },
              `Há ${offer.length} ${offer.length === 1 ? 'questão nova' : 'questões novas'} deste tópico no banco; o reteste pede ${RETEST_MIN}.`,
            ),
            h('p', { class: 'sk-small' }, 'Nenhuma do diagnóstico ou da prática entra: o reteste só usa questões nunca vistas.'),
            builderButton(cycle.topic),
          ),
    )
  }

  const retestView = (cycle: StudyCycle): HTMLElement[] => {
    const attempt = cycle.retests.at(-1)
    const banner = studyBanner(
      'warn',
      'Sem ajuda',
      'Tutor, Cora, notas e fontes ficam fechados até você entregar. Questões novas, nenhuma do diagnóstico ou da prática.',
    )
    if (cycle.stage === 'retest-ready' || !attempt)
      return [banner, h('div', { class: 'sk-section' }, retestPicker(cycle, cycle.retests.length > 0))]
    const score = retestScore(attempt)
    const pending = attempt.questions.some((q) => q.assessment?.kind === 'pending' || q.assessment?.kind === 'uncertain')
    if (score !== null && score >= 80) return conclusionView(cycle, score)
    const total = attempt.questions.length
    index = Math.min(index, total - 1)
    const item = attempt.questions[index]!
    const answered = attempt.questions.filter((q) => q.response).length
    const locked = score !== null || (answered === total && attempt.questions.every((q) => q.assessment))
    const draft = drafts.get(item.id) ?? { response: item.response, excerpt: '', uncertain: null }
    const area = h('textarea', {
      class: 'input sk-answer',
      maxlength: '20000',
      'aria-label': `Sua resposta, questão ${index + 1} do reteste`,
      disabled: busy || locked || undefined,
      oninput: (event: Event) => {
        draft.response = (event.currentTarget as HTMLTextAreaElement).value
        drafts.set(item.id, draft)
      },
    })
    area.value = draft.response
    const saveAndGo = (step: number) => {
      const go = () => {
        index = Math.max(0, Math.min(total - 1, index + step))
      }
      if (locked || draft.response === item.response) {
        go()
        return render()
      }
      if (!draft.response.trim()) {
        go()
        return render()
      }
      void save(async () => {
        const next = await window.office.answerStudyRetest(item.id, draft.response)
        drafts.delete(item.id)
        go()
        return next
      })
    }
    const result =
      score !== null
        ? studyPanel(
            'Resultado do reteste',
            h(
              'div',
              { class: 'sk-score' },
              h('span', { class: 'sk-score-value' }, `${score}%`),
              h('span', { class: 'sk-small' }, 'meta 80%'),
            ),
            h('p', { class: 'sk-small' }, 'Abaixo de 80%. A Bonnie pede outra revisão e um conjunto novo de questões.'),
            h(
              'div',
              { class: 'sk-row' },
              ...attempt.questions.map((q, i) =>
                studyChip(`${i + 1} ${KIND[q.assessment?.kind ?? 'pending'][0]}`, KIND[q.assessment?.kind ?? 'pending'][1]),
              ),
            ),
          )
        : null
    return [
      banner,
      h(
        'div',
        { class: 'sk-split' },
        h(
          'div',
          { class: 'sk-col' },
          h(
            'div',
            { class: 'sk-row' },
            h('b', {}, `Questão ${index + 1} de ${total}`),
            h('span', { class: 'sk-grow' }),
            h('span', { class: 'sk-small sk-mono' }, `mínimo ${RETEST_MIN}`),
          ),
          studyMeterBar(answered, total, undefined, 'Respondidas no reteste'),
          h('p', { class: 'sk-small' }, `${answered} respondidas. O placar só aparece na entrega, para não influenciar as próximas.`),
          h(
            'div',
            { class: 'sk-card' },
            h(
              'div',
              { class: 'sk-row' },
              studyChip(originLabel[item.source.originKind], 'info'),
              h('span', { class: 'sk-small' }, `${item.source.sourceTitle} · gabarito conferido`),
            ),
            ...promptOf(item.source),
            isChoiceQuestion(item.source)
              ? h(
                  'div',
                  {},
                  studyLabel('Sua resposta'),
                  answerControl(
                    item.source,
                    draft.response,
                    (value) => {
                      draft.response = value
                      drafts.set(item.id, draft)
                    },
                    { disabled: busy || locked, reveal: score !== null, label: `Alternativas da questão ${index + 1} do reteste` },
                  ),
                )
              : h('label', {}, studyLabel('Sua resposta'), area),
          ),
          h(
            'div',
            { class: 'sk-row' },
            btn('Anterior', () => saveAndGo(-1), { disabled: index === 0 }),
            h('span', { class: 'sk-grow' }),
            locked ? null : btn('Salvar', () => saveAndGo(0)),
            btn('Próxima questão', () => saveAndGo(1), { primary: !locked, disabled: index >= total - 1 }),
          ),
          result,
          score !== null || (answered === total && pending) ? retestPicker(cycle, true) : null,
        ),
        h(
          'div',
          { class: 'sk-col' },
          studyPanel(
            'Gate 4 · conclusão',
            studyGate([
              { state: total >= RETEST_MIN ? 'ok' : 'todo', text: `Pelo menos ${RETEST_MIN} questões novas`, note: `${total} planejadas` },
              { state: 'ok', text: 'Sem ajuda', note: 'nenhum acesso aberto' },
              {
                state: attempt.questions.every((q) => q.assessment && ['correct', 'incorrect'].includes(q.assessment.kind))
                  ? 'ok'
                  : pending
                    ? 'pending'
                    : 'todo',
                text: 'Gabaritos conferidos',
                note: `${attempt.questions.filter((q) => q.assessment && ['correct', 'incorrect'].includes(q.assessment.kind)).length} de ${total}`,
              },
              {
                state: score !== null && score >= 80 ? 'ok' : 'todo',
                text: '80% ou mais',
                note: score === null ? 'aparece na entrega' : `${score}%`,
              },
            ]),
          ),
          pending && score === null
            ? studyPanel(
                null,
                h('div', {}, studyChip('Em verificação', 'warn')),
                h(
                  'p',
                  { class: 'sk-small' },
                  'Se o verificador não validar uma resposta, ela sai da conta. Entregue de novo ou comece um conjunto novo.',
                ),
              )
            : null,
        ),
      ),
    ]
  }

  const statsOf = (cycle: StudyCycle) => {
    const gaps = studyGaps(cycle)
    const correct = cycle.questions.filter((q) => q.assessment?.kind === 'correct').length
    const counted = correct + cycle.questions.filter((q) => q.assessment?.kind === 'incorrect').length
    const refs = new Set(gaps.flatMap((g) => g.review?.sourceRefs ?? []))
    return h(
      'div',
      { class: 'sk-stats' },
      studyStat('Diagnóstico', `${counted ? Math.round((correct / counted) * 100) : 0}%`),
      studyStat('Revisados', String(gaps.filter((g) => g.review?.cause).length)),
      studyStat('Notas', String(cycle.notes.length)),
      studyStat('Fontes', String(refs.size)),
    )
  }

  const nextInTrail = (cycle: StudyCycle): StudyTrailTopic | undefined => {
    const t = trailTopicOf(trail, cycle.topic)
    if (!t) return undefined
    const i = trail.topics.indexOf(t)
    return trail.topics.slice(i + 1).find((x) => !x.done)
  }

  const conclusionView = (cycle: StudyCycle, score: number): HTMLElement[] => {
    const attempt = cycle.retests.at(-1)!
    const correct = attempt.questions.filter((q) => q.assessment?.kind === 'correct').length
    const next = nextInTrail(cycle)
    return [
      h(
        'div',
        { class: 'sk-split', style: 'grid-template-columns:minmax(0,1fr) minmax(0,1fr)' },
        h(
          'div',
          { class: 'sk-col' },
          studyPanel(
            'Reteste',
            h(
              'div',
              { class: 'sk-score' },
              h('span', { class: 'sk-score-value' }, `${score}%`),
              h('span', { class: 'sk-small' }, `${correct} de ${attempt.questions.length} certas`),
            ),
            studyMeterBar(score, 100, 80, 'Nota do reteste'),
            studyGate([
              { state: 'ok', text: `${attempt.questions.length} questões novas (mínimo ${RETEST_MIN})` },
              { state: 'ok', text: 'Sem ajuda durante o reteste' },
              { state: 'ok', text: `Gabaritos conferidos · ${attempt.questions.length} de ${attempt.questions.length}` },
              { state: 'ok', text: '80% ou mais' },
            ]),
          ),
          statsOf(cycle),
          h('p', { class: 'sk-small' }, 'Evidência = suas respostas. O trabalho dos agentes não conta como aprendizado.'),
          next ? studyPanel('Próximo na trilha', h('p', { class: 'sk-prompt' }, h('b', {}, next.title), ` · ${trailPlace(next)}`)) : null,
        ),
        h(
          'div',
          { class: 'sk-col' },
          h(
            'div',
            { class: 'sk-confirm' },
            h(
              'label',
              { class: 'sk-check' },
              h('input', {
                type: 'checkbox',
                checked: confirmDone || undefined,
                onchange: (event: Event) => {
                  confirmDone = (event.currentTarget as HTMLInputElement).checked
                  render()
                },
              }),
              h(
                'span',
                {},
                h('b', {}, 'Confirmo que concluí este tópico.'),
                h('br'),
                h('span', { class: 'sk-small' }, 'Só você conclui. Nada é apagado.'),
              ),
            ),
            h(
              'div',
              { class: 'sk-row' },
              btn('Ainda não', () => el.remove()),
              h('span', { class: 'sk-grow' }),
              btn(
                'Concluir tópico',
                () =>
                  void save(
                    () => window.office.completeStudyRetest(),
                    (n) => (activeStudyCycle(n)?.stage === 'completed' ? 'Tópico concluído com sua confirmação.' : undefined),
                  ),
                { primary: true, disabled: !confirmDone },
              ),
            ),
          ),
          h(
            'p',
            { class: 'sk-small' },
            'Cartões são um fluxo separado, feito a partir das notas na estante de cartões; não bloqueiam a conclusão.',
          ),
        ),
      ),
    ]
  }

  const completedView = (cycle: StudyCycle): HTMLElement[] => {
    const attempt = cycle.retests.at(-1)
    const score = attempt ? retestScore(attempt) : null
    const next = nextInTrail(cycle)
    foot.append(
      h('span', { class: 'sk-small sk-grow' }, 'O histórico deste tópico fica guardado.'),
      btn(
        next ? `Começar “${next.title}”` : 'Escolher próximo tópico',
        () => {
          topic = next?.label ?? ''
          void save(async () => {
            const s = await window.office.resetStudyCycle()
            state = s
            pickForTopic()
            return s
          })
        },
        { primary: true },
      ),
    )
    return [
      h(
        'div',
        { class: 'sk-section' },
        studyPanel(
          'Ciclo concluído',
          h(
            'div',
            { class: 'sk-score' },
            h('span', { class: 'sk-score-value' }, `${score ?? 0}%`),
            h('span', { class: 'sk-small' }, 'no reteste, concluído com sua confirmação'),
          ),
        ),
        statsOf(cycle),
        next ? studyPanel('Próximo na trilha', h('p', { class: 'sk-prompt' }, h('b', {}, next.title), ` · ${trailPlace(next)}`)) : null,
      ),
    ]
  }

  // ---- the window ---------------------------------------------------------------------------

  const switchTopic = async (cycle: StudyCycle) => {
    const answered = cycle.questions.filter((q) => q.response).length
    const ok = await confirmDialog(root, {
      title: 'Trocar de tópico?',
      text: `“${topicName(cycle.topic)}” fica guardado como está: ${stageLabel[cycle.stage]}, ${answered} de ${cycle.questions.length} respondidas, ${cycle.notes.length} ${cycle.notes.length === 1 ? 'nota' : 'notas'}. Nada é concluído nem apagado; você retoma de onde parou.`,
      confirm: 'Guardar e trocar de tópico',
      cancel: 'Cancelar',
    })
    if (!ok) return
    topic = ''
    selected.clear()
    practicePick = null
    retestPick = null
    void save(() => window.office.resetStudyCycle(), 'Ciclo guardado. Escolha o próximo tópico.')
  }

  const render = () => {
    foot.replaceChildren()
    const cycle = activeStudyCycle(state)
    const error = errorText ? h('p', { class: 'sk-error', role: 'alert' }, errorText) : null
    if (!cycle) {
      head.setTitle('Ciclo de estudo')
      head.setSubtitle('Bonnie · diretoria — libera cada etapa quando o critério é cumprido')
      head.setTags([])
      view.replaceChildren(...([error].filter(Boolean) as HTMLElement[]), ...pickerView())
      footBar.hidden = !foot.childElementCount
      return
    }
    const gate = evaluateStudyGate(cycle)
    const gaps = studyGaps(cycle)
    const attempt = cycle.retests.at(-1)
    const retestDone = cycle.stage === 'retest' && attempt ? retestScore(attempt) : null
    const room =
      cycle.stage === 'diagnosis' || cycle.stage === 'review-required'
        ? STUDY_WHO.tutor
        : cycle.stage === 'practice'
          ? STUDY_WHO.curator
          : cycle.stage === 'completed'
            ? null
            : STUDY_WHO.verifier
    const diagnosisDone = cycle.stage === 'diagnosis' && gate.ready && diagnosisView === 'result'
    head.setTitle(
      cycle.stage === 'diagnosis'
        ? diagnosisDone
          ? 'Diagnóstico concluído'
          : 'Diagnóstico'
        : cycle.stage === 'retest' && retestDone !== null && retestDone >= 80
          ? 'Critério cumprido. Concluir o tópico?'
          : cycle.stage === 'completed'
            ? 'Tópico concluído'
            : stageLabel[cycle.stage],
    )
    head.setSubtitle(placeOf(cycle.topic))
    head.setTags([
      ...(room ? [studyInRoom(room)] : []),
      ...(cycle.stage !== 'completed' ? [btn('Trocar tópico', () => void switchTopic(cycle))] : []),
    ])

    let body: HTMLElement[]
    let gateItems: StudyGateItem[] | null = null
    let gateN = 1
    let primary: HTMLElement | null = null
    const advance = (label: string, ok: boolean, message: string) =>
      btn(
        label,
        () => {
          gapId = ''
          index = 0
          void save(() => window.office.advanceStudyCycle(), message)
        },
        { primary: true, disabled: !ok },
      )

    if (cycle.stage === 'diagnosis') {
      if (diagnosisDone) {
        body = diagnosisResult(cycle)
        foot.append(
          h('span', { class: 'sk-small sk-grow' }, gaps.length ? 'As fontes ficam ligadas às questões e voltam na Prática e fontes.' : ''),
          btn('Rever questões', () => {
            diagnosisView = 'questions'
            render()
          }),
          advance(
            gate.ready && gate.nextStage === 'retest-ready'
              ? 'Pedir à Bonnie para liberar o Reteste'
              : 'Pedir à Bonnie para liberar Erros e dúvidas',
            true,
            'Bonnie liberou a próxima etapa.',
          ),
        )
      } else {
        body = diagnosisQuestions(cycle)
        gateItems = diagnosisGate(cycle)
        primary = gate.ready
          ? btn(
              'Ver resultado',
              () => {
                diagnosisView = 'result'
                render()
              },
              { primary: true },
            )
          : advance('Pedir à Bonnie para liberar a próxima etapa', false, '')
      }
    } else if (cycle.stage === 'review-required') {
      body = reviewView(cycle)
      gateN = 2
      const causes = gaps.filter((g) => g.review?.cause && g.review.nextStep).length
      const sourced = gaps.filter((g) => g.review?.sourceRefs.length).length
      gateItems = [
        { state: causes === gaps.length ? 'ok' : 'todo', text: 'Causa e próximo passo', note: `${causes} de ${gaps.length}` },
        { state: sourced === gaps.length ? 'ok' : 'todo', text: 'Fonte ligada', note: `${sourced} de ${gaps.length}` },
      ]
      primary = advance('Pedir à Bonnie para liberar Prática e fontes', gaps.every(reviewDone), 'Bonnie liberou a Prática e fontes.')
    } else if (cycle.stage === 'practice') {
      body = practiceView(cycle)
      gateN = 3
      gateItems = practiceGate(cycle)
      primary = advance(
        'Pedir à Bonnie para liberar Reteste',
        gateItems.every((g) => g.state === 'ok'),
        'Bonnie liberou o Reteste.',
      )
    } else if (cycle.stage === 'retest-ready' || cycle.stage === 'retest') {
      body = retestView(cycle)
      if (cycle.stage === 'retest' && attempt && retestDone === null) {
        const all = attempt.questions.every((q) => q.response)
        foot.append(
          h(
            'span',
            { class: 'sk-small sk-grow' },
            all
              ? 'Tudo respondido: o verificador confere as respostas.'
              : `Entrega libera com ${attempt.questions.length} de ${attempt.questions.length} respondidas.`,
          ),
          btn('Entregar reteste', () => void save(() => window.office.verifyStudyRetest(), 'Conferência do reteste concluída.'), {
            primary: true,
            disabled: !all,
          }),
        )
      }
    } else body = completedView(cycle)

    if (gateItems)
      foot.append(
        h('span', { class: 'sk-foot-label' }, `Gate ${gateN}`),
        h('div', { class: 'sk-grow' }, studyGate(gateItems, true)),
        ...(primary ? [primary] : []),
      )
    view.replaceChildren(...([error].filter(Boolean) as HTMLElement[]), h('div', { class: 'sk-strip' }, stepsOf(cycle)), ...body)
    footBar.hidden = !foot.childElementCount
  }

  root.append(el)
  render()
  el.querySelector<HTMLElement>('.modal-body button, .modal-body select, .modal-foot button')?.focus()
  announce('Ciclo de estudo aberto.')
}

function normalizePrompt(prompt: string): string {
  return prompt.toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ').trim()
}
