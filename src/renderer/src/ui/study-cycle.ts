import {
  activeStudyCycle,
  evaluateStudyGate,
  practiceScore,
  retestScore,
  studyGaps,
  type StudyCycle,
  type StudyCycleQuestion,
  type StudyCycleState,
  unansweredStudyQuestions,
} from '@shared/study-cycle'
import type { StudyQuestion } from '@shared/study-questions'
import type { StudyLibraryHit, StudyLibrarySearch } from '@shared/study-library'
import type { StudyPracticeQuestion } from '@shared/study-cycle'
import { studyTopicStart, topicName, trailTopicOf, type StudyTrail, type StudyTrailTopic } from '@shared/study-trail'
import { questionsForTopic, studyQueryOfQuestion, type StudySourceRecommendations } from '@shared/study-sources'
import { announce } from './a11y'
import { studySourceList } from './study-library'
import { h } from './dom'
import { cleanError, modal } from './modals/common'

type Toast = (text: string, kind?: 'info' | 'ok' | 'err') => void

const stageLabel: Record<StudyCycle['stage'], string> = {
  diagnosis: 'diagnóstico',
  'review-required': 'erros e dúvidas',
  practice: 'prática e fontes',
  'retest-ready': 'reteste liberado',
  retest: 'reteste',
  completed: 'concluído',
}

/** "tópico 5 de 6 · Estrutura de Dados…" for a topic of the trail. */
const trailPlace = (topic: StudyTrailTopic) => `tópico ${topic.index} de ${topic.total} · ${topic.discipline}`

const originLabel: Record<StudyQuestion['originKind'], string> = {
  enem: 'ENEM',
  concurso: 'Concurso',
  livro: 'Livro',
  web: 'Web',
  ia: 'IA',
}

/**
 * "Começar com este tópico" (the trail board): keeps every earlier cycle. The current topic just
 * opens; a kept cycle of the topic is pinned again where it stopped; otherwise the current cycle
 * is set aside and the picker opens on the topic, with its bank questions already ticked.
 */
export async function startStudyTopic(root: HTMLElement, toast: Toast, topic: string): Promise<void> {
  try {
    const plan = studyTopicStart(await window.office.readStudyCycle(), topic)
    if (plan.kind === 'resume') {
      await window.office.resumeStudyCycle(plan.cycleId)
      toast(`Ciclo de “${topic}” retomado de onde parou.`, 'ok')
    } else if (plan.kind === 'new' && plan.setAside) {
      await window.office.resetStudyCycle()
      toast('O ciclo anterior ficou guardado; escolha as questões do novo tópico.', 'info')
    }
    await openStudyCycle(root, toast, plan.kind === 'new' ? { topic } : {})
  } catch (error) {
    toast(cleanError(error), 'err')
  }
}

/** Bonnie's local-only diagnosis surface; every Tutor request is an explicit per-question action. */
export async function openStudyCycle(root: HTMLElement, toast: Toast, options: { topic?: string } = {}): Promise<void> {
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
  const fresh = (): StudyQuestion[] => unansweredStudyQuestions(bank, state)

  let topic = activeStudyCycle(state)?.topic ?? options.topic ?? ''
  // A topic chosen on the trail board comes with its bank questions ticked; the user can change them.
  const selected = new Set<string>(
    !activeStudyCycle(state) && options.topic ? questionsForTopic(fresh(), options.topic).map((question) => question.id) : [],
  )
  /** Cora's sources for each wrong question (by question id), asked once per opening. */
  const gapSources = new Map<string, StudySourceRecommendations | 'loading' | 'error'>()
  const selectedRetest = new Set<string>()
  const gapDrafts = new Map<string, { cause: string; nextStep: string }>()
  const selectedPracticeGaps = new Map<string, string>()
  const notesByHit = new Map<string, string>()
  let libraryQuery = topic
  let libraryResult: StudyLibrarySearch | null = null
  let libraryBusy = false
  let busy = false
  let startButton: HTMLButtonElement | undefined
  const content = h('div', { class: 'study-cycle-content' })
  const actions = h('div', { class: 'review-actions' })
  const error = h('p', { class: 'study-cycle-error', role: 'alert', hidden: true })
  const tell = (message: string) => {
    error.textContent = message
    error.hidden = !message
  }
  const save = async (action: () => Promise<StudyCycleState>, success?: string | ((state: StudyCycleState) => string | undefined)) => {
    if (busy) return
    busy = true
    tell('')
    render()
    try {
      state = await action()
      const message = typeof success === 'function' ? success(state) : success
      if (message) toast(message, 'ok')
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
      h('h4', {}, topicName(item.source.topic) || topicName(cycle.topic)),
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
          ? 'Erros e dúvidas · registre causa e próximo passo para cada lacuna antes de abrir a prática.'
          : cycle.stage === 'practice'
            ? 'Prática e fontes · vincule materiais às lacunas, escreva uma nota e alcance 80% nas questões planejadas.'
            : cycle.stage === 'retest-ready'
              ? 'Reteste liberado · selecione ao menos dez questões novas com gabaritos conferidos. Sem dicas durante as respostas.'
              : cycle.stage === 'retest'
                ? 'Reteste em andamento · responda todas as questões sem consulta. O resultado só aparece depois da conferência final.'
                : 'Ciclo concluído com sua confirmação. O histórico permanece salvo.'
    const inTrail = trailTopicOf(trail, cycle.topic)
    const body: HTMLElement[] = [
      h(
        'div',
        { class: 'study-cycle-topic' },
        h('span', { class: 'field-label' }, 'Tópico atual'),
        h('b', {}, topicName(cycle.topic)),
        inTrail ? h('span', { class: 'field-hint' }, `${trailPlace(inTrail)} · trilha zettel`) : null,
      ),
      h('p', { class: 'study-cycle-status', role: 'status' }, status),
      h(
        'p',
        { class: 'field-hint' },
        'As respostas ficam neste computador. Somente ao clicar “Verificar”, esta questão, sua resposta e o gabarito conferido ou trecho escolhido são enviados ao Claude. A avaliação não salva nem altera o banco.',
      ),
      ...cycle.questions.map((item) => questionForm(cycle, item)),
    ]
    if ((cycle.stage === 'diagnosis' && evaluateStudyGate(cycle).ready) || cycle.stage === 'review-required')
      body.push(...gapSourcesBody(cycle))
    if (cycle.stage === 'review-required') body.push(...reviewBody(cycle))
    if (cycle.stage === 'practice') body.push(...practiceBody(cycle))
    if (cycle.stage === 'retest-ready') body.push(...retestPickerBody(cycle))
    if (cycle.stage === 'retest') body.push(...retestBody(cycle))
    if (cycle.stage === 'completed') {
      const finalAttempt = cycle.retests.at(-1)
      const finalScore = finalAttempt ? retestScore(finalAttempt) : null
      body.push(
        h(
          'p',
          { class: 'study-cycle-status', role: 'status' },
          `Bonnie registrou o ciclo como concluído após sua confirmação · ${finalScore ?? 0}% no reteste.`,
        ),
      )
    }
    if (cycle.stage === 'diagnosis') {
      if (gate.ready) {
        body.push(
          h(
            'p',
            { class: 'field-hint' },
            gate.nextStage === 'retest-ready'
              ? 'Sem erros nem dúvidas. Bonnie pode pular revisão e prática e liberar o reteste.'
              : 'Há erro ou dúvida. Bonnie exige revisão e prática antes do reteste.',
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
    if (cycle.stage === 'review-required') {
      const gaps = studyGaps(cycle)
      const ready = gaps.length > 0 && gaps.every((gap) => !!gap.review?.cause && !!gap.review.nextStep && gap.review.sourceRefs.length > 0)
      body.push(
        h(
          'p',
          { class: 'field-hint' },
          ready
            ? 'Cada erro ou dúvida tem causa, próximo passo e fonte local vinculada. Bonnie pode liberar a prática.'
            : 'Gate bloqueado: registre a causa e o próximo passo, e vincule ao menos uma fonte local para cada erro ou dúvida.',
        ),
      )
      if (ready)
        actions.append(
          h(
            'button',
            {
              class: 'btn btn-primary',
              type: 'button',
              disabled: busy || undefined,
              onclick: () => void save(() => window.office.advanceStudyCycle(), 'Bonnie liberou a etapa de prática e fontes.'),
            },
            'Pedir à Bonnie para liberar prática',
          ),
        )
    }
    if (cycle.stage === 'practice') {
      const currentRound = cycle.practiceRounds.at(-1)
      const completed =
        !!currentRound?.questions.length &&
        currentRound.questions.every(
          (question) => !!question.response && !!question.assessment && !['pending', 'uncertain'].includes(question.assessment.kind),
        )
      const score = currentRound ? practiceScore(currentRound) : null
      const ready = !!currentRound && completed && score! >= 80 && cycle.notes.length > 0
      if (ready)
        actions.append(
          h(
            'button',
            {
              class: 'btn btn-primary',
              type: 'button',
              disabled: busy || undefined,
              onclick: () => void save(() => window.office.advanceStudyCycle(), 'Bonnie liberou o reteste.'),
            },
            'Pedir à Bonnie para liberar reteste',
          ),
        )
      else
        body.push(h('p', { class: 'field-hint', role: 'status' }, practiceGateMessage(currentRound, completed, score, cycle.notes.length)))
    }
    return body
  }

  /**
   * The end of the diagnosis: for each question the user got wrong (or marked as a doubt), Cora's
   * local sources for its concept, best to worst, with the pages to read. Built from the question's
   * topic, tags and words here; nothing goes to Claude.
   */
  const gapSourcesBody = (cycle: StudyCycle): HTMLElement[] => {
    const gaps = studyGaps(cycle)
    if (!gaps.length) return []
    const missing = gaps.filter((gap) => !gapSources.has(gap.id))
    if (missing.length) {
      for (const gap of missing) gapSources.set(gap.id, 'loading')
      window.office
        .recommendStudySources(missing.map((gap) => studyQueryOfQuestion(gap.source)))
        .then((all) => missing.forEach((gap, i) => gapSources.set(gap.id, all[i] ?? 'error')))
        .catch(() => missing.forEach((gap) => gapSources.set(gap.id, 'error')))
        .finally(() => {
          if (el.isConnected) render()
        })
    }
    const sources = (result: StudySourceRecommendations | 'loading' | 'error' | undefined): HTMLElement => {
      if (result === 'loading' || result === undefined) return h('p', { class: 'field-hint', role: 'status' }, 'Cora está procurando…')
      if (result === 'error') return h('p', { class: 'field-hint' }, 'Cora não conseguiu ler a biblioteca local agora.')
      return studySourceList(result, toast, true, 5)
    }
    return [
      h(
        'section',
        { class: 'study-gap-sources', 'aria-label': 'Fontes da Cora para o que você errou' },
        h('h3', {}, 'Fontes da Cora para o que você errou'),
        h(
          'p',
          { class: 'field-hint' },
          'Para cada erro ou dúvida, a Cora ordena as fontes locais da mais para a menos relevante, com a página de início e a de fim. A busca é local; nada vai ao Claude.',
        ),
        ...gaps.map((gap) =>
          h(
            'article',
            { class: 'study-cycle-gap' },
            h('h4', {}, `${gap.assessment?.kind === 'incorrect' ? 'Erro' : 'Dúvida'} · ${topicName(gap.source.topic) || topicName(cycle.topic)}`),
            h('p', { class: 'study-cycle-prompt' }, gap.source.question),
            sources(gapSources.get(gap.id)),
          ),
        ),
      ),
    ]
  }

  const reviewBody = (cycle: StudyCycle): HTMLElement[] => {
    const gaps = studyGaps(cycle)
    const gapCards = gaps.map((gap) => {
      const draft = gapDrafts.get(gap.id) ?? { cause: gap.review?.cause ?? '', nextStep: gap.review?.nextStep ?? '' }
      const cause = h('textarea', {
        class: 'input study-cycle-answer',
        rows: '2',
        maxlength: '2000',
        'aria-label': `Causa da lacuna ${gap.id}`,
        value: draft.cause,
        disabled: busy || undefined,
        oninput: (event: Event) => {
          const latest = gapDrafts.get(gap.id) ?? draft
          gapDrafts.set(gap.id, { ...latest, cause: (event.currentTarget as HTMLTextAreaElement).value })
        },
      }) as HTMLTextAreaElement
      const nextStep = h('textarea', {
        class: 'input study-cycle-answer',
        rows: '2',
        maxlength: '2000',
        'aria-label': `Próximo passo para ${gap.id}`,
        value: draft.nextStep,
        disabled: busy || undefined,
        oninput: (event: Event) => {
          const latest = gapDrafts.get(gap.id) ?? draft
          gapDrafts.set(gap.id, { ...latest, nextStep: (event.currentTarget as HTMLTextAreaElement).value })
        },
      }) as HTMLTextAreaElement
      return h(
        'article',
        { class: 'study-cycle-gap' },
        h('h4', {}, `Erro ou dúvida · ${topicName(gap.source.topic) || topicName(cycle.topic)}`),
        h('p', { class: 'study-cycle-prompt' }, gap.source.question),
        h('p', { class: 'study-cycle-source' }, `Sua resposta: ${gap.response}${gap.uncertain ? ' · Você marcou dúvida' : ''}`),
        h('label', { class: 'study-cycle-field' }, h('span', { class: 'field-label' }, 'O que causou a dificuldade?'), cause),
        h('label', { class: 'study-cycle-field' }, h('span', { class: 'field-label' }, 'Qual é o próximo passo?'), nextStep),
        gap.review?.sourceRefs.length
          ? h('ul', { class: 'study-cycle-source-list' }, ...gap.review.sourceRefs.map((ref) => h('li', {}, ref)))
          : h('p', { class: 'field-hint' }, 'Nenhuma fonte local vinculada ainda.'),
        h(
          'button',
          {
            class: 'btn btn-small',
            type: 'button',
            disabled: busy || !cause.value.trim() || !nextStep.value.trim() || undefined,
            onclick: () =>
              void save(() => window.office.reviewStudyGap(gap.id, cause.value, nextStep.value), 'Causa e próximo passo salvos.'),
          },
          'Salvar revisão da lacuna',
        ),
      )
    })
    return [h('h3', {}, 'Erros e dúvidas'), ...gapCards, ...coraSection(cycle)]
  }

  const coraSection = (cycle: StudyCycle): HTMLElement[] => {
    const currentResult = libraryResult?.query === libraryQuery.trim() ? libraryResult : null
    const query = h('input', {
      class: 'input',
      maxlength: '200',
      value: libraryQuery,
      'aria-label': 'Pesquisar na biblioteca local com Cora',
      placeholder: 'Pesquisar tópico ou conceito nas fontes locais',
      disabled: busy || libraryBusy || undefined,
      oninput: (event: Event) => (libraryQuery = (event.currentTarget as HTMLInputElement).value),
    }) as HTMLInputElement
    const results = currentResult
      ? [
          ...(currentResult.warning ? [h('p', { class: 'field-hint', role: 'status' }, currentResult.warning)] : []),
          ...currentResult.hits.map((hit) => coraHit(cycle, hit, currentResult.token)),
          ...(!currentResult.hits.length ? [h('p', { class: 'field-hint' }, 'Cora não encontrou trechos locais correspondentes.')] : []),
        ]
      : []
    return [
      h('h3', {}, 'Cora · consulta local de fontes'),
      h('p', { class: 'field-hint' }, 'A busca lê apenas os arquivos locais em “study sources”. O conteúdo não é enviado ao Claude.'),
      h(
        'div',
        { class: 'study-cycle-library-search' },
        query,
        h(
          'button',
          {
            class: 'btn btn-small',
            type: 'button',
            disabled: busy || libraryBusy || !query.value.trim() || undefined,
            onclick: () => void searchLibrary(query.value),
          },
          libraryBusy ? 'Buscando…' : 'Pesquisar com Cora',
        ),
      ),
      ...results,
    ]
  }

  const coraHit = (cycle: StudyCycle, hit: StudyLibraryHit, token: string): HTMLElement => {
    const gaps = studyGaps(cycle)
    const gapSelect = h(
      'select',
      { class: 'input', 'aria-label': `Vincular fonte ${hit.title} a uma lacuna` },
      ...gaps.map((gap) =>
        h(
          'option',
          { value: gap.id, selected: (selectedPracticeGaps.get(hit.id) ?? gaps[0]?.id) === gap.id },
          `${topicName(gap.source.topic)}: ${gap.id}`,
        ),
      ),
    ) as HTMLSelectElement
    const note = h('textarea', {
      class: 'input study-cycle-answer',
      rows: '3',
      maxlength: '10000',
      'aria-label': `Nota autoral da fonte ${hit.title}`,
      placeholder: 'Escreva uma nota própria durante a consulta (não é um cartão).',
      value: notesByHit.get(hit.id) ?? '',
      oninput: (event: Event) => notesByHit.set(hit.id, (event.currentTarget as HTMLTextAreaElement).value),
    }) as HTMLTextAreaElement
    gapSelect.onchange = () => selectedPracticeGaps.set(hit.id, gapSelect.value)
    const gapId = () => selectedPracticeGaps.get(hit.id) ?? gaps[0]?.id ?? ''
    return h(
      'article',
      { class: 'study-cycle-source-hit' },
      h('h4', {}, hit.title),
      h('p', { class: 'study-cycle-source' }, hit.line ? `${hit.sourceRef} · linha ${hit.line}` : hit.sourceRef),
      h('p', { class: 'study-cycle-prompt' }, hit.excerpt),
      gapSelect,
      h(
        'div',
        { class: 'study-cycle-question-actions' },
        h(
          'button',
          {
            class: 'btn btn-small',
            type: 'button',
            disabled: busy || libraryBusy || !gapId() || undefined,
            onclick: () => {
              if (libraryResult?.token !== token || libraryResult.query !== libraryQuery.trim()) return
              void save(() => window.office.attachStudySource(gapId(), token, hit.id), 'Fonte local vinculada à lacuna.')
            },
          },
          'Vincular à lacuna',
        ),
      ),
      h('label', { class: 'study-cycle-field' }, h('span', { class: 'field-label' }, 'Nota de estudo'), note),
      h(
        'button',
        {
          class: 'btn btn-small btn-primary',
          type: 'button',
          disabled: busy || libraryBusy || !note.value.trim() || !gapId() || undefined,
          onclick: () => {
            if (libraryResult?.token !== token || libraryResult.query !== libraryQuery.trim()) return
            void save(() => window.office.saveStudyCycleNote(gapId(), token, hit.id, note.value), 'Nota salva em notas-estudo.md.')
          },
        },
        'Salvar nota no Obsidian',
      ),
    )
  }

  const searchLibrary = async (query: string) => {
    libraryBusy = true
    libraryResult = null
    render()
    try {
      libraryResult = await window.office.searchStudyLibrary(query)
    } catch (err) {
      tell(cleanError(err))
    } finally {
      libraryBusy = false
      render()
    }
  }

  const practiceBody = (cycle: StudyCycle): HTMLElement[] => {
    const gaps = studyGaps(cycle)
    const round = cycle.practiceRounds.at(-1)
    const used = new Set(cycle.questions.map((question) => question.id))
    for (const previous of cycle.practiceRounds) for (const question of previous.questions) used.add(question.id)
    const roundComplete =
      !!round &&
      round.questions.every(
        (question) => !!question.response && !!question.assessment && !['pending', 'uncertain'].includes(question.assessment.kind),
      )
    const canPlan = !round || !roundComplete || practiceScore(round) < 80
    const rows = canPlan
      ? fresh()
          .filter((question) => !question.sourceOnly && !used.has(question.id) && question.answerStatus === 'verified' && !!question.answer)
          .map((question) => {
            const selectedGap = selectedPracticeGaps.get(question.id) ?? gaps[0]?.id ?? ''
            return h(
              'div',
              { class: 'study-cycle-bank-row' },
              h('input', {
                type: 'checkbox',
                checked: selected.has(question.id),
                'aria-label': `Adicionar questão nova de prática ${question.id}`,
                onchange: (event: Event) => {
                  const input = event.currentTarget as HTMLInputElement
                  if (input.checked) selected.add(question.id)
                  else selected.delete(question.id)
                },
              }),
              h('span', {}, h('strong', {}, `${topicName(question.topic)} · ${originLabel[question.originKind]}`), h('span', {}, question.question)),
              h(
                'select',
                {
                  class: 'input',
                  'aria-label': `Vincular ${question.id} ao erro ou dúvida`,
                  onchange: (event: Event) => selectedPracticeGaps.set(question.id, (event.currentTarget as HTMLSelectElement).value),
                },
                ...gaps.map((gap) => h('option', { value: gap.id, selected: selectedGap === gap.id }, `${topicName(gap.source.topic)}: ${gap.id}`)),
              ),
            )
          })
      : []
    const currentRound = round ? round.questions.map((item) => practiceQuestionForm(item)) : []
    return [
      h('h3', {}, 'Prática e fontes'),
      h('p', { class: 'field-hint' }, `Notas de estudo salvas: ${cycle.notes.length}. Cartões permanecem fora do ciclo.`),
      ...gaps.map((gap) =>
        h(
          'article',
          { class: 'study-cycle-gap' },
          h('h4', {}, `Lacuna · ${topicName(gap.source.topic) || topicName(cycle.topic)}`),
          h('p', {}, `Causa: ${gap.review?.cause ?? '—'}`),
          h('p', {}, `Próximo passo: ${gap.review?.nextStep ?? '—'}`),
          h('p', { class: 'study-cycle-source' }, `Fontes: ${gap.review?.sourceRefs.join(' · ') || 'nenhuma'}`),
        ),
      ),
      ...(currentRound.length ? currentRound : []),
      ...(canPlan
        ? [
            h(
              'p',
              { class: 'field-hint' },
              !round
                ? 'Selecione questões novas do banco com gabarito conferido e vincule cada uma a uma lacuna.'
                : roundComplete
                  ? 'O resultado ficou abaixo de 80%. Revise as lacunas e selecione questões novas.'
                  : 'Há questão sem avaliação suficiente. Você pode substituí-la por uma questão nova, sem contar a pendente.',
            ),
            ...(rows.length
              ? rows
              : [
                  h(
                    'p',
                    { class: 'field-hint' },
                    'Não há questões novas com gabarito conferido no banco. Monte mais questões na estante de questões (“Montar banco”).',
                  ),
                ]),
            h(
              'button',
              {
                class: 'btn btn-small btn-primary',
                type: 'button',
                disabled: busy || !selected.size || !rows.length || undefined,
                onclick: () => {
                  const links = [...selected].map((id) => ({ id, gapQuestionIds: [selectedPracticeGaps.get(id) ?? gaps[0]?.id ?? ''] }))
                  void save(() => window.office.startStudyPractice(links), 'Questões de prática planejadas.')
                  selected.clear()
                },
              },
              'Planejar questões de prática',
            ),
          ]
        : []),
      ...coraSection(cycle),
    ]
  }

  const practiceQuestionForm = (item: StudyPracticeQuestion): HTMLElement => {
    let dirty = false
    const controls: { verifyButton?: HTMLButtonElement } = {}
    const response = h('textarea', {
      class: 'input study-cycle-answer',
      rows: '3',
      maxlength: '20000',
      'aria-label': `Resposta da prática ${item.id}`,
      value: item.response,
      disabled: busy || undefined,
      oninput: () => {
        dirty = true
        if (controls.verifyButton) controls.verifyButton.disabled = true
      },
    }) as HTMLTextAreaElement
    const saveButton = h(
      'button',
      {
        class: 'btn btn-small',
        type: 'button',
        disabled: busy || undefined,
        onclick: () => void save(() => window.office.answerStudyPractice(item.id, response.value), 'Resposta de prática salva localmente.'),
      },
      'Salvar resposta',
    )
    controls.verifyButton = h(
      'button',
      {
        class: 'btn btn-small btn-primary',
        type: 'button',
        disabled: busy || !item.response || dirty || undefined,
        onclick: () => void save(() => window.office.evaluateStudyPractice(item.id)),
      },
      'Verificar com Curador',
    )
    return h(
      'article',
      { class: 'study-cycle-question' },
      h('h4', {}, `${topicName(item.source.topic)} · prática nova`),
      h('p', { class: 'study-cycle-prompt' }, item.source.question),
      h('p', { class: 'study-cycle-source' }, `Gabarito conferido · vinculado a ${item.gapQuestionIds.join(', ')}`),
      h('label', { class: 'study-cycle-field' }, h('span', { class: 'field-label' }, 'Sua resposta'), response),
      item.assessment
        ? h(
            'p',
            { class: 'study-cycle-assessment', role: 'status' },
            `${assessmentLabel(item.assessment.kind)} · ${item.assessment.rationale}`,
          )
        : null,
      h('div', { class: 'study-cycle-question-actions' }, saveButton, controls.verifyButton),
    )
  }

  const retestPickerBody = (cycle: StudyCycle): HTMLElement[] => {
    const usedIds = new Set(cycle.questions.map((question) => question.id))
    const usedPrompts = new Set(cycle.questions.map((question) => normalizePrompt(question.source.question)))
    for (const round of cycle.practiceRounds) {
      for (const question of round.questions) {
        usedIds.add(question.id)
        usedPrompts.add(normalizePrompt(question.source.question))
      }
    }
    for (const attempt of cycle.retests) {
      for (const question of attempt.questions) {
        usedIds.add(question.id)
        usedPrompts.add(normalizePrompt(question.source.question))
      }
    }
    const candidates = fresh().filter(
      (question) =>
        !question.sourceOnly &&
        question.question.trim() &&
        question.answerStatus === 'verified' &&
        question.answer &&
        !usedIds.has(question.id) &&
        !usedPrompts.has(normalizePrompt(question.question)),
    )
    const rows = candidates.map((question) =>
      h(
        'label',
        { class: 'study-cycle-bank-row' },
        h('input', {
          type: 'checkbox',
          checked: selectedRetest.has(question.id),
          'aria-label': `Selecionar para reteste: ${topicName(question.topic)} · ${question.question}`,
          onchange: (event: Event) => {
            const input = event.currentTarget as HTMLInputElement
            if (input.checked) selectedRetest.add(question.id)
            else selectedRetest.delete(question.id)
          },
        }),
        h(
          'span',
          {},
          h('strong', {}, `${topicName(question.topic)} · ${originLabel[question.originKind]} · gabarito conferido`),
          h('span', {}, question.question),
        ),
      ),
    )
    return [
      h('h3', {}, cycle.retests.length ? 'Planejar novo reteste' : 'Planejar reteste'),
      h(
        'p',
        { class: 'field-hint' },
        'Escolha pelo menos dez questões novas. Durante o reteste, o app não mostra gabaritos nem avaliações até você responder tudo e pedir a conferência.',
      ),
      ...(rows.length
        ? rows
        : [
            h(
              'p',
              { class: 'field-hint' },
              'Não há dez questões novas com gabarito conferido no banco. Monte mais questões na estante de questões (“Montar banco”).',
            ),
          ]),
      h(
        'button',
        {
          class: 'btn btn-small btn-primary',
          type: 'button',
          disabled: busy || selectedRetest.size < 10 || undefined,
          onclick: () => {
            const ids = [...selectedRetest]
            selectedRetest.clear()
            void save(() => window.office.startStudyRetest(ids), 'Reteste iniciado com questões novas.')
          },
        },
        `Iniciar reteste (${selectedRetest.size}/10)`,
      ),
    ]
  }

  const retestBody = (cycle: StudyCycle): HTMLElement[] => {
    const attempt = cycle.retests.at(-1)
    if (!attempt)
      return [h('p', { class: 'field-hint', role: 'alert' }, 'O reteste ativo não tem um conjunto salvo. Inicie um reteste novo.')]
    const score = retestScore(attempt)
    const allAnswered = attempt.questions.every((question) => !!question.response)
    const result =
      score === null
        ? null
        : h(
            'section',
            { class: 'study-cycle-retest-result', role: 'status' },
            h('h3', {}, `Resultado do reteste: ${score}%`),
            h(
              'p',
              {},
              score >= 80
                ? 'O gate de nota foi cumprido. A conclusão ainda exige sua confirmação.'
                : 'A nota ficou abaixo de 80%. Bonnie pede outra revisão e um conjunto novo.',
            ),
            ...attempt.questions.map((question) =>
              h(
                'p',
                { class: `study-cycle-assessment study-cycle-assessment-${question.assessment?.kind ?? 'pending'}` },
                `${topicName(question.source.topic)} · ${assessmentLabel(question.assessment?.kind ?? 'pending')}`,
              ),
            ),
          )
    const pending = attempt.questions.some(
      (question) => question.assessment?.kind === 'pending' || question.assessment?.kind === 'uncertain',
    )
    const body: HTMLElement[] = [
      h(
        'p',
        { class: 'field-hint' },
        'Responda sem abrir fontes, ver gabaritos ou receber dicas. O Verificador confere somente depois que todas as respostas forem salvas.',
      ),
      ...attempt.questions.map((question) => retestQuestionForm(question, score !== null)),
      ...(result ? [result] : []),
      ...(!result && pending
        ? [
            h(
              'p',
              { class: 'field-hint', role: 'status' },
              'Há resposta Em verificação. Você pode tentar a conferência novamente ou planejar um conjunto novo; ela não conta como acerto nem erro.',
            ),
          ]
        : []),
    ]
    if (score === null) {
      actions.append(
        h(
          'button',
          {
            class: 'btn btn-primary',
            type: 'button',
            disabled: busy || !allAnswered || undefined,
            onclick: () => void save(() => window.office.verifyStudyRetest(), 'Conferência do reteste concluída.'),
          },
          'Conferir reteste com Verificador',
        ),
      )
      if (allAnswered && pending) body.push(...retestPickerBody(cycle))
    } else if (score >= 80) {
      actions.append(
        h(
          'button',
          {
            class: 'btn btn-primary',
            type: 'button',
            disabled: busy || undefined,
            onclick: () =>
              void save(
                () => window.office.completeStudyRetest(),
                (next) => (activeStudyCycle(next)?.stage === 'completed' ? 'Ciclo de estudo concluído com sua confirmação.' : undefined),
              ),
          },
          'Confirmar conclusão do ciclo',
        ),
      )
    } else body.push(...retestPickerBody(cycle))
    return body
  }

  const retestQuestionForm = (item: StudyCycleQuestion, locked: boolean): HTMLElement => {
    const response = h('textarea', {
      class: 'input study-cycle-answer',
      rows: '3',
      maxlength: '20000',
      'aria-label': `Resposta do reteste ${item.id}`,
      value: item.response,
      disabled: busy || locked || undefined,
    }) as HTMLTextAreaElement
    return h(
      'article',
      { class: 'study-cycle-question' },
      h('h4', {}, `${topicName(item.source.topic)} · ${originLabel[item.source.originKind]}`),
      h('p', { class: 'study-cycle-prompt' }, item.source.question),
      h('label', { class: 'study-cycle-field' }, h('span', { class: 'field-label' }, 'Sua resposta, sem consulta'), response),
      ...(locked
        ? []
        : [
            h(
              'button',
              {
                class: 'btn btn-small',
                type: 'button',
                disabled: busy || !response.value.trim() || undefined,
                onclick: () =>
                  void save(() => window.office.answerStudyRetest(item.id, response.value), 'Resposta do reteste salva localmente.'),
              },
              'Salvar resposta',
            ),
          ]),
    )
  }

  const pickerBody = (): HTMLElement[] => {
    const place = h('span', { class: 'field-hint', 'aria-live': 'polite' })
    const showPlace = () => {
      const chosen = trailTopicOf(trail, topic)
      const kept = state.cycles.find((cycle) => cycle.topic === topic.trim() && cycle.stage !== 'completed')
      place.textContent = [
        chosen ? `${trailPlace(chosen)}${chosen.done ? ' · marcado como estudado na trilha' : ''}` : '',
        kept ? 'Já há um ciclo guardado deste tópico: retome-o abaixo para continuar de onde parou.' : '',
      ]
        .filter(Boolean)
        .join(' · ')
    }
    const trailSelect = h(
      'select',
      {
        class: 'input',
        'aria-label': 'Escolher o tópico na trilha zettel',
        disabled: busy || !trail.topics.length || undefined,
        onchange: (event: Event) => {
          const value = (event.currentTarget as HTMLSelectElement).value
          if (!value) return
          topic = value
          topicInput.value = value
          showPlace()
          if (startButton) startButton.disabled = busy || !topic.trim() || !selected.size
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
          `${item.done ? '✓ ' : ''}${item.id ? `${item.id} · ` : ''}${item.title} — ${item.discipline} (${item.index} de ${item.total})`,
        ),
      ),
    ) as HTMLSelectElement
    const kept = state.cycles.filter((cycle) => cycle.id !== state.activeId && cycle.stage !== 'completed').reverse()
    const keptRows = kept.map((cycle) =>
      h(
        'div',
        { class: 'study-cycle-kept-row' },
        h(
          'span',
          {},
          h('strong', {}, topicName(cycle.topic)),
          h(
            'span',
            {},
            `${stageLabel[cycle.stage]} · ${cycle.questions.filter((q) => q.response).length} de ${cycle.questions.length} respondidas · ${new Date(cycle.updatedAt).toLocaleDateString('pt-BR')}`,
          ),
        ),
        h(
          'button',
          {
            class: 'btn btn-small',
            type: 'button',
            disabled: busy || undefined,
            onclick: () => void save(() => window.office.resumeStudyCycle(cycle.id), `Ciclo de “${topicName(cycle.topic)}” retomado de onde parou.`),
          },
          'Retomar',
        ),
      ),
    )
    const topicInput = h('input', {
      class: 'input',
      value: topic,
      maxlength: '200',
      'aria-label': 'Tópico do ciclo',
      placeholder: 'Ex.: Probabilidade',
      disabled: busy || undefined,
      oninput: (event: Event) => {
        topic = (event.currentTarget as HTMLInputElement).value
        if (trailSelect.value !== topic.trim())
          trailSelect.value = trail.topics.some((item) => item.label === topic.trim()) ? topic.trim() : ''
        showPlace()
        if (startButton) startButton.disabled = busy || !topic.trim() || !selected.size
      },
    }) as HTMLInputElement
    showPlace()
    const visible = fresh().filter((question) => !question.sourceOnly && question.question.trim())
    return [
      h('p', {}, 'Selecione questões do banco local. As que você já respondeu não aparecem: nenhuma questão se repete.'),
      h(
        'p',
        { class: 'field-hint' },
        'O banco atual é lido localmente. Cada ciclo guarda um snapshot para preservar as questões mesmo se o banco mudar.',
      ),
      h(
        'div',
        { class: 'study-cycle-field' },
        h('span', { class: 'field-label' }, 'Tópico da trilha zettel'),
        trailSelect,
        h('label', { class: 'study-cycle-field' }, h('span', { class: 'field-hint' }, 'ou escreva outro tópico'), topicInput),
        place,
      ),
      ...(keptRows.length
        ? [
            h(
              'section',
              { class: 'study-cycle-kept', 'aria-label': 'Ciclos guardados' },
              h('h4', {}, 'Ciclos guardados'),
              h('p', { class: 'field-hint' }, 'Trocar de tópico não apaga nada: cada ciclo fica guardado com respostas, notas e fontes.'),
              ...keptRows,
            ),
          ]
        : []),
      ...(visible.length
        ? visible.map((question) => {
            const checkbox = h('input', {
              type: 'checkbox',
              checked: selected.has(question.id),
              disabled: busy || undefined,
              'aria-label': `Selecionar ${topicName(question.topic)}: ${question.question}`,
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
              h('span', {}, h('strong', {}, `${topicName(question.topic)} · ${originLabel[question.originKind]}`), h('span', {}, question.question)),
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
              selected.clear()
              selectedRetest.clear()
              selectedPracticeGaps.clear()
              libraryResult = null
              topic = ''
              void save(
                () => window.office.resetStudyCycle(),
                'Ciclo guardado. Escolha o próximo tópico na trilha ou retome um ciclo guardado.',
              )
            },
          },
          'Trocar tópico',
        ),
      )
    } else {
      startButton = h(
        'button',
        {
          class: 'btn btn-primary',
          type: 'button',
          disabled: busy || !topic.trim() || !selected.size || undefined,
          onclick: () => {
            const ids = [...selected]
            selected.clear()
            void save(() => window.office.startStudyCycle(topic, ids), 'Diagnóstico iniciado.')
          },
        },
        busy ? 'Iniciando…' : 'Iniciar diagnóstico com Bonnie',
      )
      actions.append(startButton)
    }
    actions.append(h('div', { class: 'grow' }), h('button', { class: 'btn', type: 'button', onclick: () => el.remove() }, 'Fechar'))
  }

  const el = modal('Ciclo de estudo · Bonnie', [content], [actions], () => el.remove())
  el.querySelector('.modal-foot')?.classList.add('study-modal-foot')
  root.append(el)
  render()
  actions.querySelector<HTMLButtonElement>('button')?.focus()
  announce('Diagnóstico de estudo aberto.')
}

function assessmentLabel(kind: 'correct' | 'incorrect' | 'uncertain' | 'pending'): string {
  return {
    correct: 'Evidência suficiente de acerto',
    incorrect: 'Evidência de erro',
    uncertain: 'Dúvida marcada · revisão necessária',
    pending: 'Em verificação',
  }[kind]
}

function normalizePrompt(prompt: string): string {
  return prompt.toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ').trim()
}

function practiceGateMessage(
  round: StudyCycle['practiceRounds'][number] | undefined,
  completed: boolean,
  score: number | null,
  noteCount: number,
): string {
  if (!round) return 'Gate bloqueado: planeje um conjunto não vazio de questões ligadas às lacunas.'
  if (!completed) return 'Gate bloqueado: responda e verifique todas as questões da rodada.'
  if ((score ?? 0) < 80) return `Resultado ${score ?? 0}%. Bonnie pede revisão e questões novas antes de avançar.`
  if (!noteCount) return 'Gate bloqueado: salve ao menos uma nota autoral durante a consulta de fonte.'
  return `Resultado ${score}%. Bonnie pode liberar o reteste.`
}
