import {
  disciplineIdOf,
  isAgentVerified,
  splitStudyRationale,
  studyBankFolders,
  STUDY_BANK_DEFAULT_PER_SUBTOPIC,
  STUDY_BANK_MAX_PER_TOPIC,
  STUDY_BANK_REASON,
  STUDY_BANK_STEPS,
  STUDY_BANK_STEP_LABEL,
  type StudyBankJob,
  type StudyBankRequest,
  type StudyBankTopicResult,
  type StudyBookSuggestion,
} from '@shared/study-bank'
import { studyBankStats } from '@shared/study-bank-stats'
import { isStudyReadinessReady, type StudyReadiness, type StudyReadinessTopic } from '@shared/study-readiness'
import { answeredStudyQuestions, isStudyQuestionAnswered, type StudyCycleState } from '@shared/study-cycle'
import { isChoiceQuestion, STUDY_QUESTION_LIMITS, studyOptionText, type StudyQuestion } from '@shared/study-questions'
import type { StudySubtopics } from '@shared/study-outline'
import type { StudyTrail, StudyTrailTopic } from '@shared/study-trail'
import { announce } from './a11y'
import { h } from './dom'
import { cleanError, confirmDialog, modal } from './modals/common'
import { dressStudyWindow, STUDY_WHO } from './study-kit'
import { studyMath } from './study-math-dom'

type Toast = (text: string, kind?: 'info' | 'ok' | 'err') => void

export interface StudyBankLinks {
  /** Opens Cora's library on a topic (to look for or add a book). */
  openLibrary: (topic: string) => void
  /** Opens the bank in numbers ("Banco de questões"). */
  openBank: () => void
}

const SVG = 'http://www.w3.org/2000/svg'
function svgIcon(shapes: [string, Record<string, string>][], width = '2'): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', width)
  svg.setAttribute('aria-hidden', 'true')
  for (const [tag, attrs] of shapes) {
    const el = document.createElementNS(SVG, tag)
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
    svg.append(el)
  }
  return svg
}

/** The seal of a question: blue, dashed, robot when the agent chain checked it. */
export function studySeal(question: StudyQuestion): HTMLElement {
  if (isAgentVerified(question))
    return h(
      'span',
      { class: 'seal seal-agents', title: 'Conferida por autor, resolvedor cego e verificador; ninguém leu' },
      svgIcon([
        ['rect', { x: '3', y: '5', width: '10', height: '8' }],
        ['path', { d: 'M8 2v3M6 9h0M10 9h0' }],
      ]),
      'Verificada por agentes',
    )
  return h('span', { class: 'seal seal-none' }, 'Sem conferência')
}

/** The page or section of a library reference: "study sources/…/Livro.pdf#Página 231" → "Página 231". */
const placeOf = (ref: string | undefined): string => (ref?.includes('#') ? ref.slice(ref.indexOf('#') + 1).replace(/:\d+$/, '') : '')

/**
 * A bank question: wording, and on demand the answer, rationale, the book's passage and its page.
 * The passage proves the answer, so it stays folded with it until the question is answered.
 */
export function studyQuestionCard(question: StudyQuestion, answered: boolean, discipline?: string): HTMLElement {
  const { rationale, quote } = splitStudyRationale(question.rationale)
  const place = placeOf(question.sourceReference)
  return h(
    'article',
    { class: 'qc' },
    h(
      'div',
      { class: 'qc-top' },
      studySeal(question),
      answered ? h('span', { class: 'bk-reason has' }, 'Já respondida') : null,
      h(
        'span',
        { class: 'qc-topic' },
        [discipline, question.topic, question.originKind === 'livro' ? 'Livro' : question.sourceTitle].filter(Boolean).join(' · '),
      ),
    ),
    question.sourceOnly
      ? h('p', { class: 'qc-q' }, 'Somente a referência da fonte; sem enunciado guardado.')
      : h(
          'div',
          {},
          question.passage ? h('p', { class: 'qc-passage' }, studyMath(question.passage)) : null,
          h('p', { class: 'qc-q' }, studyMath(question.question)),
        ),
    question.options?.length
      ? h('ol', { class: 'qc-choices', type: 'A' }, ...question.options.map((option) => h('li', {}, studyMath(option))))
      : question.sourceOnly
        ? null
        : h('p', { class: 'qc-open' }, 'Questão aberta, de antes da múltipla escolha: não é oferecida e sai na próxima montagem.'),
    question.answer || quote
      ? h(
          'details',
          { class: 'qc-block', open: answered || undefined },
          h('summary', { class: 'qc-label' }, answered ? 'Resposta e trecho' : 'Ver resposta e trecho (revela a resposta)'),
          question.answer
            ? h(
                'p',
                {},
                h('b', {}, 'Resposta: '),
                studyMath(isChoiceQuestion(question) ? studyOptionText(question, question.answer) : question.answer),
              )
            : null,
          rationale ? h('p', {}, h('b', {}, 'Justificativa: '), studyMath(rationale)) : null,
          quote ? h('span', { class: 'qc-label' }, `Trecho do livro${place ? ` · ${place}` : ''}`) : null,
          quote ? h('blockquote', { class: 'qc-quote' }, '“', studyMath(quote), '”') : null,
        )
      : null,
    h(
      'div',
      { class: 'qc-block' },
      h(
        'span',
        { class: 'qc-ref' },
        h('b', {}, question.sourceTitle),
        isAgentVerified(question)
          ? ' · conferida por autor, resolvedor cego e verificador'
          : question.sourceUrl
            ? ` · ${question.sourceUrl}`
            : '',
      ),
    ),
  )
}

/** One cell per question of the goal; filled up to `n`. */
export function studyMeter(n: number, goal: number, extra = ''): HTMLElement {
  const cells = Math.max(1, goal)
  const kind = n >= goal ? 'done' : n > 0 || goal ? 'short' : ''
  return h(
    'span',
    {
      class: `bk-meter ${kind} ${extra}`.trim(),
      role: 'img',
      'aria-label': `${n} de ${goal}`,
      style: `grid-template-columns: repeat(${cells}, 1fr)`,
    },
    ...Array.from({ length: cells }, (_, i) => h('i', { class: i < n ? 'on' : '' })),
  )
}

const plural = (n: number, one: string, many: string): string => `${n.toLocaleString('pt-BR')} ${n === 1 ? one : many}`

function duration(questions: number): string {
  // Each question takes 3 to 4 calls of 6–10 s; retries add some.
  const low = Math.ceil((questions * 20) / 60)
  const high = Math.ceil((questions * 40) / 60)
  const fmt = (min: number) => (min < 90 ? `${min} min` : `${(min / 60).toFixed(1).replace('.', ',')} h`)
  return questions ? `leva de ${fmt(low)} a ${fmt(high)}` : 'nada a fazer'
}

/** The window opened, if any: the background notice hides while it is on screen. */
let openWindow: HTMLElement | null = null

/**
 * "Montar banco de questões": choose the discipline (and a topic), follow the run, read the report.
 * The run lives in the main process; closing this window does not stop it.
 */
export async function openStudyBankBuilder(
  root: HTMLElement,
  toast: Toast,
  links: StudyBankLinks,
  preset: StudyBankRequest = {},
): Promise<void> {
  let trail: StudyTrail
  let bank: StudyQuestion[]
  let cycles: StudyCycleState
  let job: StudyBankJob | null
  let subtopics: Record<string, StudySubtopics>
  let readiness: Record<string, StudyReadiness>
  try {
    ;[trail, { questions: bank }, cycles, job, subtopics, readiness] = await Promise.all([
      window.office.readStudyTrail(),
      window.office.readStudyQuestions(),
      window.office.readStudyCycle(),
      window.office.studyBankStatus(),
      window.office.readStudySubtopics().catch((): Record<string, StudySubtopics> => ({})),
      // The last report of each discipline, shown as saved; a discipline with none is checked when picked.
      window.office.readStudyReadiness().catch((error: unknown): Record<string, StudyReadiness> => {
        toast(cleanError(error), 'err')
        return {}
      }),
    ])
  } catch (error) {
    toast(cleanError(error), 'err')
    return
  }
  openWindow?.querySelector<HTMLButtonElement>('.icon-btn')?.click()

  let discipline = preset.discipline ?? ''
  let topic = preset.topic ?? ''
  /** Questions per subtopic: each topic's total is this times its subtopics. */
  let perSubtopic = preset.perSubtopic ?? STUDY_BANK_DEFAULT_PER_SUBTOPIC
  /** The form is shown even with a last report, after "Montar outro". */
  let forceForm = false
  let busy = false
  /** A readiness check is running. */
  let checking = false
  /** Topics whose books are being searched in the background. */
  const searching = new Set<string>()
  /** Topics whose book search failed: not asked again in this window, so a failing search does not repeat. */
  const failedSearch = new Set<string>()
  /** Disciplines asked for while a check ran: each is checked after the one running. */
  const waiting: string[] = []

  const disciplines = new Map<string, { name: string; topics: StudyTrailTopic[] }>()
  for (const item of trail.topics) {
    const id = disciplineIdOf(item.id)
    if (!id) continue
    const entry = disciplines.get(id) ?? { name: item.discipline, topics: [] }
    entry.topics.push(item)
    disciplines.set(id, entry)
  }

  const title = h('div', { class: 'modal-title' })
  const body = h('div', { class: 'study-bank-builder' })
  const foot = h('div', { class: 'modal-foot study-modal-foot' })
  const close = () => {
    unsubscribe()
    el.remove()
    if (openWindow === el) openWindow = null
    renderChip()
  }
  const el = modal('Montar banco de questões', [body], [], close)
  const box = el.querySelector<HTMLElement>('.modal')!
  box.classList.add('study-popup', 'study-bank-modal')
  box.querySelector('.modal-title')!.replaceWith(title)
  box.querySelector('.modal-foot')!.replaceWith(foot)
  dressStudyWindow(box, { who: STUDY_WHO.bank, subtitle: 'Cadeia de agentes · roda em segundo plano, uma por vez' }, 'm')

  const start = async (request: StudyBankRequest) => {
    if (busy) return
    // A job with no discipline (from "Todas as disciplinas") cannot be built again: the build needs one.
    if (!request.discipline) {
      toast('Escolha a disciplina antes de montar.', 'err')
      return
    }
    busy = true
    try {
      job = await window.office.startStudyBank(request)
      forceForm = false
      announce('Montagem do banco começou.')
    } catch (error) {
      toast(cleanError(error), 'err')
    } finally {
      busy = false
      render()
    }
  }
  const requestOf = (j: StudyBankJob): StudyBankRequest => ({
    ...(j.discipline ? { discipline: j.discipline } : {}),
    ...(j.topic ? { topic: j.topic } : {}),
    perTopic: j.perTopic,
    ...(j.perSubtopic ? { perSubtopic: j.perSubtopic } : {}),
  })
  const dismiss = async () => {
    await window.office.dismissStudyBank().catch(() => {})
    job = null
    forceForm = true
    render()
  }

  const scopeName = (j: StudyBankJob): string => {
    const name = j.discipline ? (disciplines.get(j.discipline)?.name ?? j.discipline) : 'Todas as disciplinas'
    const one = j.topic ? trail.topics.find((t) => [t.id, t.label, t.title].includes(j.topic!))?.title : undefined
    return one ? `${name} · ${one}` : name
  }

  // ---- A: start ----
  /** Runs a readiness step for a discipline (check or book search) and keeps its report in view. */
  const work = async (name: string, run: () => Promise<StudyReadiness>): Promise<void> => {
    checking = true
    render()
    try {
      readiness = { ...readiness, [name]: await run() }
    } catch (error) {
      toast(cleanError(error), 'err')
    } finally {
      checking = false
      render()
    }
  }
  /** Checks the discipline (no model), then looks for books for its stuck topics in the background. */
  const checkReadiness = (name: string): void => {
    if (checking) {
      if (!waiting.includes(name)) waiting.push(name)
      toast(`Checagem em andamento. ${disciplines.get(name)?.name ?? name} será conferida em seguida.`, 'info')
      return
    }
    // The search runs on the report the check just saved, for the discipline selected now; then the next waiting check.
    void work(name, () => window.office.checkStudyReadiness(name)).then(() => {
      if (discipline) void searchBooks(discipline)
      const next = waiting.shift()
      if (next) checkReadiness(next)
    })
  }
  /** Book search per stuck topic, one at a time, without blocking the window: each list shows when it arrives. */
  const searchBooks = async (name: string): Promise<void> => {
    if (checking) return
    for (const t of readiness[name]?.topics ?? []) {
      const key = `${name}:${t.id ?? t.topic}`
      if (t.state === 'pronto' || t.books || searching.has(key) || failedSearch.has(key)) continue
      searching.add(key)
      render()
      try {
        readiness = { ...readiness, [name]: await window.office.suggestStudyBooks(name, t.id ?? t.topic) }
      } catch (error) {
        failedSearch.add(key)
        toast(cleanError(error), 'err')
      } finally {
        searching.delete(key)
        render()
      }
    }
  }
  const openFolder = (path: string): void => {
    void window.office.openStudyFolder(path).catch((error: unknown) => toast(cleanError(error), 'err'))
  }
  const copyPath = (path: string): void => {
    void navigator.clipboard.writeText(path).then(
      () => toast('Caminho copiado.', 'ok'),
      (error: unknown) => toast(cleanError(error), 'err'),
    )
  }

  const formView = (): void => {
    title.textContent = 'Montar banco de questões'
    const answered = answeredStudyQuestions(cycles)
    const stats = studyBankStats(bank, trail.topics, { isAnswered: (q) => isStudyQuestionAnswered(answered, q) })
    const fresh = new Map<string, number>()
    for (const d of stats.disciplines) for (const t of d.topics) if (t.id) fresh.set(t.id, t.fresh)
    const chosen = discipline ? (disciplines.get(discipline)?.topics ?? []) : [...disciplines.values()].flatMap((d) => d.topics)
    const scope = topic ? chosen.filter((t) => [t.id, t.label, t.title].includes(topic)) : chosen
    // The topic's total is perSubtopic × its subtopics; a topic whose subtopics are not known has no goal yet.
    const goalOf = (t: StudyTrailTopic): number => {
      const entry = subtopics[t.title]
      return entry?.status === 'ok' ? perSubtopic * entry.subtopics.length : 0
    }
    const report = discipline ? readiness[discipline] : undefined
    const ready = isStudyReadinessReady(report, disciplines.get(discipline)?.topics ?? [])
    const complete = scope.filter((t) => goalOf(t) > 0 && (fresh.get(t.id ?? '') ?? 0) >= goalOf(t)).length
    const room = Math.max(0, STUDY_QUESTION_LIMITS.count - bank.length)
    const newMax = Math.min(
      room,
      scope.reduce((sum, t) => sum + Math.max(0, goalOf(t) - (fresh.get(t.id ?? '') ?? 0)), 0),
    )
    const noBook = (id: string, name: string) => studyBankFolders(id, name).fallback

    const disciplineSelect = h(
      'select',
      {
        class: 'input',
        onchange: (event: Event) => {
          discipline = (event.currentTarget as HTMLSelectElement).value
          topic = ''
          if (discipline && !readiness[discipline]) checkReadiness(discipline)
          else {
            render()
            if (discipline && !checking) void searchBooks(discipline)
          }
        },
      },
      h('option', { value: '', selected: !discipline }, `Todas as disciplinas (${disciplines.size} · ${trail.topics.length} tópicos)`),
      ...[...disciplines].map(([id, d]) =>
        h(
          'option',
          { value: id, selected: id === discipline },
          `${d.name} (${plural(d.topics.length, 'tópico', 'tópicos')}${noBook(id, d.name) ? ' · sem livro local' : ''})`,
        ),
      ),
    )
    const topicSelect = h(
      'select',
      {
        class: 'input',
        disabled: !discipline,
        onchange: (event: Event) => {
          topic = (event.currentTarget as HTMLSelectElement).value
          render()
        },
      },
      h('option', { value: '' }, discipline ? 'Todos os tópicos da disciplina' : 'Escolha uma disciplina primeiro'),
      ...(disciplines.get(discipline)?.topics ?? []).map((t) =>
        h('option', { value: t.id ?? t.label, selected: (t.id ?? t.label) === topic }, t.title),
      ),
    )
    const perSub = h('input', {
      class: 'input',
      type: 'number',
      min: '1',
      max: String(STUDY_BANK_MAX_PER_TOPIC),
      value: String(perSubtopic),
      'aria-describedby': 'study-bank-estimate',
      onchange: (event: Event) => {
        const value = Math.round(Number((event.currentTarget as HTMLInputElement).value))
        perSubtopic = Number.isFinite(value) && value > 0 ? Math.min(STUDY_BANK_MAX_PER_TOPIC, value) : STUDY_BANK_DEFAULT_PER_SUBTOPIC
        render()
      },
    })
    const readyRow = (t: StudyReadinessTopic): HTMLElement => {
      if (t.state === 'pronto')
        return h(
          'li',
          { class: 'bk-ready-row' },
          h('span', { class: 'bk-reason has' }, 'Pronto'),
          h('b', {}, t.topic),
          h('span', { class: 'field-hint' }, t.reason),
        )
      return h(
        'li',
        { class: 'bk-ready-row' },
        h('span', { class: 'bk-reason refused' }, 'Travado'),
        h('b', {}, t.topic),
        h('span', { class: 'field-hint' }, t.reason),
        h(
          'ul',
          { class: 'bk-folders', 'aria-label': `Pastas indicadas para ${t.topic}` },
          ...t.folders.map((folder) =>
            h(
              'li',
              {},
              h('code', {}, folder),
              h('button', { class: 'btn', type: 'button', onclick: () => openFolder(folder) }, 'Abrir pasta'),
              h('button', { class: 'btn', type: 'button', onclick: () => copyPath(folder) }, 'Copiar caminho'),
            ),
          ),
        ),
        searching.has(`${discipline}:${t.id ?? t.topic}`) ? h('span', { class: 'field-hint', role: 'status' }, 'Buscando livros…') : null,
        t.books && !t.books.length ? h('span', { class: 'field-hint' }, 'Nenhum livro encontrado na web.') : null,
        bookList(t.books),
      )
    }
    const readinessView = (): HTMLElement[] => {
      if (!discipline) return [h('p', { class: 'field-hint' }, 'Escolha uma disciplina para ver se os tópicos estão prontos para o banco.')]
      if (!report)
        return [h('p', { class: 'field-hint', role: 'status' }, checking ? 'Checagem em andamento…' : 'Sem relatório de prontidão.')]
      const okCount = report.topics.filter((t) => t.state === 'pronto').length
      const stuck = report.topics.some((t) => t.state !== 'pronto')
      return [
        h(
          'div',
          { class: 'bk-ready-head', role: 'status' },
          h('b', {}, `${okCount} de ${report.topics.length} tópicos prontos`),
          h('span', { class: 'grow' }),
          stuck
            ? h(
                'button',
                { class: 'btn', type: 'button', disabled: checking, onclick: () => checkReadiness(discipline) },
                checking ? 'Conferindo…' : 'Reconferir travados',
              )
            : null,
        ),
        ...(stuck ? [h('p', { class: 'field-hint' }, 'Montar banco libera quando todos os tópicos da disciplina estiverem prontos.')] : []),
        h('ul', { class: 'bk-ready-list', 'aria-label': 'Prontidão por tópico' }, ...report.topics.map(readyRow)),
      ]
    }
    body.replaceChildren(
      ...(job && job.status === 'stopped' ? [stopNotice(job)] : []),
      h(
        'p',
        { class: 'field-hint study-note' },
        'Escolha a disciplina. Para cada tópico da trilha, o app lê os livros dessa disciplina em “study sources” e escreve questões só com o que está neles. Questões que você já respondeu não contam: o banco nunca repete uma questão.',
      ),
      trail.topics.length
        ? h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Disciplina'), disciplineSelect)
        : h('p', { class: 'field-hint' }, trail.found ? 'A trilha não tem tópicos.' : 'trilha zettel.md não encontrada no vault.'),
      ...readinessView(),
      h(
        'div',
        { class: 'bk-row' },
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Tópico (opcional)'), topicSelect),
        h('label', { class: 'field bk-narrow' }, h('span', { class: 'field-label' }, 'Questões por subtema'), perSub),
      ),
      h('p', { class: 'field-hint' }, 'Cada subtema recebe esse número; o total de cada tópico é esse número vezes o de seus subtemas.'),
      h(
        'div',
        { class: 'bk-estimate', id: 'study-bank-estimate' },
        h('span', {}, h('b', {}, String(scope.length)), ` ${scope.length === 1 ? 'tópico' : 'tópicos'}`),
        h(
          'span',
          {},
          h('b', {}, String(complete)),
          ` já ${complete === 1 ? 'tem' : 'têm'} as questões e ${complete === 1 ? 'será pulado' : 'serão pulados'}`,
        ),
        h('span', {}, 'até ', h('b', {}, newMax.toLocaleString('pt-BR')), ' questões novas'),
        h('span', {}, duration(newMax)),
        room < STUDY_QUESTION_LIMITS.count / 10
          ? h(
              'span',
              {},
              `cabem mais ${room.toLocaleString('pt-BR')} no banco (limite ${STUDY_QUESTION_LIMITS.count.toLocaleString('pt-BR')})`,
            )
          : null,
      ),
      h('p', { class: 'bk-warn' }, 'As questões entram sem sua revisão; a cadeia de agentes confere cada uma.'),
      h(
        'details',
        { class: 'bk-steps' },
        h('summary', {}, 'Como cada questão é conferida'),
        h(
          'ol',
          {},
          h('li', {}, h('b', {}, 'Autor'), ' escreve pergunta, resposta, justificativa e copia a frase do livro que prova a resposta.'),
          h('li', {}, h('b', {}, 'Conferência da citação'), ': a frase precisa estar no trecho do livro.'),
          h('li', {}, h('b', {}, 'Semelhança'), ': recusa se for quase igual a outra do mesmo tópico, inclusive às que você já respondeu.'),
          h('li', {}, h('b', {}, 'Resolvedor cego'), ' responde sem ver a resposta do autor.'),
          h(
            'li',
            {},
            h('b', {}, 'Verificador'),
            ' compara as duas respostas com o livro e só aprova se a pergunta tiver uma única resposta certa.',
          ),
        ),
        h('p', { class: 'field-hint bk-steps-note' }, 'Ninguém usa a internet. Se uma etapa recusa, o autor tenta de novo (até 3 vezes).'),
      ),
    )
    foot.replaceChildren(
      h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancelar'),
      h(
        'button',
        {
          class: 'btn btn-primary',
          type: 'button',
          disabled: busy || checking || !ready || !newMax,
          onclick: () =>
            // perTopic 1: the topic's total comes from perSubtopic × its subtopics, not from a per-topic count.
            void start({ discipline, ...(topic ? { topic } : {}), perTopic: 1, perSubtopic }),
        },
        busy ? 'Começando…' : 'Montar banco',
      ),
    )
  }

  // ---- B: progress ----
  const progressView = (j: StudyBankJob): void => {
    title.textContent = 'Montando o banco'
    const current = j.current
    const step = current?.step ? STUDY_BANK_STEPS.indexOf(current.step) : -1
    const skipped = j.results.filter((r) => r.reason === 'complete').length
    const short = j.results.filter((r) => r.reason && r.reason !== 'complete').length
    body.replaceChildren(
      h(
        'div',
        { class: 'bk-now', role: 'status', 'aria-live': 'polite' },
        h(
          'div',
          { class: 'bk-now-top' },
          h('span', { class: 'tk-sub' }, `Tópico ${Math.min(j.done + 1, j.total)} de ${j.total}`),
          h('b', {}, current?.topic ?? 'Preparando…'),
          h('span', { class: 'grow' }),
          current ? h('span', { class: 'bk-frac' }, `${current.made}/${current.goal}`) : null,
        ),
        current ? studyMeter(current.made, current.goal) : null,
        current
          ? h(
              'div',
              { class: 'bk-step-chips', 'aria-label': `Questão ${current.made + 1}, etapa atual` },
              ...STUDY_BANK_STEPS.map((s, i) =>
                h(
                  'span',
                  { class: i < step ? 'ok' : i === step ? 'now' : '' },
                  i < step ? `✓ ${STUDY_BANK_STEP_LABEL[s]}` : i === step ? `${STUDY_BANK_STEP_LABEL[s]}…` : STUDY_BANK_STEP_LABEL[s],
                ),
              ),
            )
          : null,
        current?.source ? h('span', { class: 'field-hint' }, `Livro: ${current.source}`) : null,
      ),
      h(
        'div',
        { class: 'qc-block' },
        h('span', { class: 'qc-label' }, `${scopeName(j)} · ${j.done} de ${j.total} tópicos`),
        h('div', { class: 'bk-total-bar' }, h('span', { style: `width: ${j.total ? Math.round((j.done / j.total) * 100) : 0}%` })),
      ),
      h(
        'div',
        { class: 'bk-counts' },
        h('div', { class: 'bk-count acc' }, h('b', {}, j.added.toLocaleString('pt-BR')), h('span', {}, 'questões adicionadas')),
        h('div', { class: 'bk-count' }, h('b', {}, String(skipped)), h('span', {}, 'tópicos pulados (já completos)')),
        h(
          'div',
          { class: 'bk-count warn' },
          h('b', {}, String(short)),
          h('span', {}, short === 1 ? 'tópico com falta' : 'tópicos com falta'),
        ),
      ),
      ...(j.results.length
        ? [
            h(
              'ul',
              { class: 'bk-log', 'aria-label': 'Tópicos já feitos' },
              ...j.results
                .slice(-8)
                .reverse()
                .map((r) =>
                  r.reason === 'complete'
                    ? h('li', { class: 'skip' }, h('b', {}, 'pulado'), h('span', {}, `${r.topic} · já tem ${r.had}`))
                    : h(
                        'li',
                        { class: r.reason ? 'short' : 'ok' },
                        h('b', {}, `${r.had + r.added}/${r.goal}`),
                        h('span', {}, r.reason ? `${r.topic} · ${STUDY_BANK_REASON[r.reason].chip.toLowerCase()}` : r.topic),
                      ),
                ),
            ),
          ]
        : []),
    )
    foot.replaceChildren(
      h(
        'button',
        {
          class: 'btn btn-danger-ghost',
          type: 'button',
          onclick: async () => {
            const ok = await confirmDialog(root, {
              title: 'Parar a montagem?',
              text: 'O que já entrou fica no banco. Você pode continuar depois de onde parou.',
              confirm: 'Parar',
              cancel: 'Continuar montando',
            })
            if (ok) await window.office.cancelStudyBank().catch((error: unknown) => toast(cleanError(error), 'err'))
          },
        },
        'Parar',
      ),
      h('div', { class: 'grow' }),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: close }, 'Continuar em segundo plano'),
    )
  }

  // ---- C: report ----
  const reportView = (j: StudyBankJob): void => {
    title.textContent = j.status === 'done' ? 'Banco montado' : 'Montagem parada'
    const short = j.results.filter((r) => r.reason && r.reason !== 'complete')
    const full = j.results.filter((r) => r.had + r.added >= r.goal).length
    const groups = new Map<string, StudyBankTopicResult[]>()
    for (const r of j.results) groups.set(r.disciplineId || r.discipline, [...(groups.get(r.disciplineId || r.discipline) ?? []), r])
    body.replaceChildren(
      ...(j.status === 'stopped' ? [stopNotice(j)] : []),
      h(
        'div',
        { class: 'bk-counts' },
        h('div', { class: 'bk-count acc' }, h('b', {}, j.added.toLocaleString('pt-BR')), h('span', {}, 'questões adicionadas')),
        h('div', { class: 'bk-count ok' }, h('b', {}, String(full)), h('span', {}, 'tópicos completos')),
        h('div', { class: 'bk-count warn' }, h('b', {}, String(short.length)), h('span', {}, 'tópicos abaixo da meta')),
      ),
      ...[...groups.values()].map((rows) => disciplineReport(rows, j)),
      ...(j.results.length ? [] : [h('p', { class: 'field-hint' }, 'Nenhum tópico terminou nesta montagem.')]),
    )
    foot.replaceChildren(
      ...(short.length && j.status === 'done'
        ? [
            h(
              'button',
              { class: 'btn', type: 'button', disabled: busy, onclick: () => void start(requestOf(j)) },
              `Tentar de novo os tópicos com falta (${short.length})`,
            ),
          ]
        : []),
      h('button', { class: 'btn', type: 'button', onclick: () => void dismiss() }, 'Montar outro'),
      h('div', { class: 'grow' }),
      h(
        'button',
        {
          class: 'btn btn-primary',
          type: 'button',
          onclick: () => {
            close()
            links.openBank()
          },
        },
        'Ver o banco',
      ),
    )
  }

  const disciplineReport = (rows: StudyBankTopicResult[], j: StudyBankJob): HTMLElement => {
    const have = rows.reduce((sum, r) => sum + Math.min(r.goal, r.had + r.added), 0)
    const goal = rows.reduce((sum, r) => sum + r.goal, 0)
    const below = rows.some((r) => r.reason && r.reason !== 'complete')
    const kind = have >= goal ? 'done' : have ? 'short' : 'zero'
    const noBook = rows.every((r) => r.reason === 'no-book')
    return h(
      'details',
      { class: 'bk-disc', open: below },
      h(
        'summary',
        {},
        h('span', { class: 'bk-dname' }, rows[0]!.discipline),
        studyMeter(goal ? Math.round((have / goal) * 20) : 0, 20, 'bk-meter-sm'),
        h('span', { class: `bk-frac ${kind}` }, `${have}/${goal}`),
      ),
      h(
        'ul',
        { class: 'bk-topics' },
        ...(noBook
          ? [h('li', { class: 'bk-topic zero' }, reasonRow(rows[0]!, j))]
          : rows
              .slice()
              .sort((a, b) => a.had + a.added - a.goal - (b.had + b.added - b.goal))
              .map((r) => {
                const n = r.had + r.added
                const cls = n >= r.goal ? 'done' : n ? 'short' : 'zero'
                return h(
                  'li',
                  { class: `bk-topic ${cls}` },
                  h('span', { class: 'bk-topic-name', title: r.topic }, r.topic),
                  studyMeter(Math.min(n, r.goal), r.goal, 'bk-meter-sm'),
                  h('span', { class: `bk-frac ${cls}` }, `${n}/${r.goal}`),
                  r.reason ? reasonRow(r, j) : null,
                )
              })),
      ),
    )
  }

  const reasonRow = (r: StudyBankTopicResult, j: StudyBankJob): HTMLElement => {
    const reason = r.reason!
    const info = STUDY_BANK_REASON[reason]
    const retry = () =>
      void start({
        discipline: r.disciplineId,
        topic: r.id ?? r.topic,
        perTopic: j.perTopic,
        ...(j.perSubtopic ? { perSubtopic: j.perSubtopic } : {}),
      })
    const library = () => links.openLibrary(r.topic)
    const actions: HTMLElement[] =
      reason === 'no-book' || reason === 'no-passage'
        ? [h('button', { class: 'btn', type: 'button', onclick: library }, 'Abrir a Biblioteca')]
        : reason === 'little'
          ? [
              h('button', { class: 'btn', type: 'button', onclick: library }, 'Abrir a Biblioteca'),
              h('button', { class: 'btn', type: 'button', onclick: retry }, 'Tentar de novo'),
            ]
          : reason === 'similar' || reason === 'refused'
            ? [h('button', { class: 'btn', type: 'button', disabled: busy, onclick: retry }, 'Tentar de novo')]
            : []
    const chip =
      reason === 'no-book' ? 'book' : reason === 'complete' ? 'has' : reason === 'no-passage' || reason === 'little' ? 'passage' : 'refused'
    return h(
      'span',
      { class: 'bk-why' },
      h('span', { class: `bk-reason ${chip}` }, info.chip),
      reason === 'no-book' && r.folder ? `${info.text} Coloque o livro em “${r.folder}” e monte de novo.` : info.text,
      h('span', { class: 'grow' }),
      ...actions,
      bookList(r.books),
    )
  }

  // ---- F: why a run stopped ----
  const stopNotice = (j: StudyBankJob): HTMLElement => {
    const at = `tópico ${Math.min(j.done + 1, j.total)} de ${j.total}`
    const kept = j.added
      ? `As ${plural(j.added, 'questão feita', 'questões feitas')} até ali já estão no banco.`
      : 'Nenhuma questão tinha entrado ainda.'
    const resume = h(
      'button',
      { class: 'btn btn-primary', type: 'button', disabled: busy, onclick: () => void start(requestOf(j)) },
      'Continuar de onde parou',
    )
    const discard = h('button', { class: 'btn', type: 'button', onclick: () => void dismiss() }, 'Descartar')
    const notice = (kind: '' | 'warn' | 'err', icon: string, head: string, text: string, actions: HTMLElement[]) =>
      h(
        'div',
        { class: `st ${kind}`.trim(), role: kind === 'err' ? 'alert' : 'status' },
        h('div', { class: 'st-icon', 'aria-hidden': 'true' }, icon),
        h('div', { class: 'st-body' }, h('b', {}, head), h('p', {}, text), h('div', { class: 'st-actions' }, ...actions)),
      )
    switch (j.stop) {
      case 'interrupted':
        return notice(
          'warn',
          '‖',
          `A montagem parou no ${at}`,
          `O app foi fechado no meio. ${kept} Continuar começa de onde parou e pula o que está completo.`,
          [resume, discard],
        )
      case 'cancelled':
        return notice('warn', '‖', `Você parou a montagem no ${at}`, `${kept} Continuar começa de onde parou e pula o que está completo.`, [
          resume,
          discard,
        ])
      case 'unavailable':
        return notice(
          'err',
          '!',
          'O Claude não está respondendo',
          `Não deu para falar com o Claude (sem internet, sem login ou limite de uso). A montagem está pausada no ${at}; nada se perdeu.${j.message ? ` Detalhe: ${j.message}` : ''}`,
          [
            h(
              'button',
              { class: 'btn btn-primary', type: 'button', disabled: busy, onclick: () => void start(requestOf(j)) },
              'Tentar de novo',
            ),
            h('button', { class: 'btn', type: 'button', onclick: close }, 'Continuar mais tarde'),
          ],
        )
      case 'full':
        return notice(
          'warn',
          '▦',
          `O banco está cheio: ${STUDY_QUESTION_LIMITS.count.toLocaleString('pt-BR')} questões`,
          `Parei no ${at} sem gravar mais nada. Para abrir espaço, apague questões no Obsidian (arquivo “questoes-estudo.md”) ou monte uma disciplina por vez.`,
          [discard],
        )
      case 'changed':
        return notice(
          'err',
          '≠',
          'O banco mudou no Obsidian enquanto eu gravava',
          'Sua edição foi mantida. As questões do tópico que estava sendo gravado não entraram, para não sobrescrever nada.',
          [
            h(
              'button',
              { class: 'btn btn-primary', type: 'button', disabled: busy, onclick: () => void start(requestOf(j)) },
              'Gravar de novo',
            ),
            discard,
          ],
        )
      default:
        return notice('err', '!', `A montagem parou no ${at}`, `${j.message ?? 'Erro inesperado.'} ${kept}`, [resume, discard])
    }
  }

  const render = () => {
    if (job?.status === 'running') progressView(job)
    else if (job && !forceForm && (job.status === 'done' || job.results.length)) reportView(job)
    else formView()
  }

  const unsubscribe = window.office.onEvent((event) => {
    if (event.type !== 'study-bank') return
    const finished = job?.status === 'running' && event.job?.status !== 'running'
    job = event.job
    if (finished) {
      // The report counts what is in the bank now.
      void window.office
        .readStudyQuestions()
        .then((b) => (bank = b.questions))
        .catch(() => {})
      announce(job?.status === 'done' ? 'Banco montado.' : 'A montagem parou.')
    }
    if (!busy) render()
  })

  openWindow = el
  root.append(el)
  render()
  if (discipline && !readiness[discipline]) checkReadiness(discipline)
  else if (discipline) void searchBooks(discipline)
  renderChip()
  el.querySelector<HTMLElement>('select, .btn-primary, .btn')?.focus()
}

/** The books found on the web for a topic: title (a link), author and access. */
function bookList(books: StudyBookSuggestion[] | undefined): HTMLElement | null {
  if (!books?.length) return null
  return h(
    'ul',
    { class: 'bk-books' },
    ...books.map((b) =>
      h(
        'li',
        {},
        h('a', { href: '#', onclick: (e: Event) => (e.preventDefault(), void window.office.openExternal(b.url)) }, b.title),
        ` ${b.author} · ${b.access === 'open' ? `livre${b.license ? ` (${b.license})` : ''}` : 'pago'}`,
      ),
    ),
  )
}

// ---- background notice ----
let chipRoot: HTMLElement | null = null
let chipJob: StudyBankJob | null = null
let chipOpen: (() => void) | null = null

function renderChip(): void {
  if (!chipRoot) return
  chipRoot.querySelector('[data-study-bank-chip]')?.remove()
  const j = chipJob
  if (!j || openWindow) return
  if (j.status !== 'running' && j.stop !== 'interrupted' && j.stop !== 'unavailable') return
  const label =
    j.status === 'running'
      ? [h('b', {}, 'Banco'), ` ${j.current?.topic ?? 'preparando'} · ${j.done}/${j.total} tópicos `, h('small', {}, `${j.added} novas`)]
      : [h('b', {}, 'Banco'), j.stop === 'interrupted' ? ' montagem interrompida ' : ' Claude sem responder ', h('small', {}, 'abrir')]
  chipRoot.append(
    h(
      'button',
      {
        class: 'bk-hud bk-hud-fixed',
        type: 'button',
        'data-study-bank-chip': 'true',
        title: 'Abrir a montagem do banco de questões',
        onclick: () => chipOpen?.(),
      },
      j.status === 'running' ? h('span', { class: 'bk-dot', 'aria-hidden': 'true' }) : null,
      ...label,
    ),
  )
}

/** The small notice in the corner while a run goes on in the background (or was interrupted). */
export function mountStudyBankChip(root: HTMLElement, open: () => void): void {
  chipRoot = root
  chipOpen = open
  void window.office
    .studyBankStatus()
    .then((j) => {
      chipJob = j
      renderChip()
    })
    .catch(() => {})
  window.office.onEvent((event) => {
    if (event.type !== 'study-bank') return
    chipJob = event.job
    renderChip()
  })
}
