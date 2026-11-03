import { disciplineIdOf, STUDY_BANK_DEFAULT_PER_TOPIC, type StudyBankJob, type StudyBankRequest } from '@shared/study-bank'
import { studyBankStats, type StudyBankStats } from '@shared/study-bank-stats'
import type { StudySubtopics } from '@shared/study-outline'
import { answeredStudyQuestions, isStudyQuestionAnswered } from '@shared/study-cycle'
import { freshChoiceCount, STUDY_QUESTION_LIMITS, type StudyQuestion } from '@shared/study-questions'
import { h } from './dom'
import { cleanError, confirmDialog, modal } from './modals/common'
import { studyQuestionCard } from './study-bank'
import { dressStudyWindow, STUDY_WHO } from './study-kit'

type Toast = (text: string, kind?: 'info' | 'ok' | 'err') => void
type Remove = (topic: string, ids: string[]) => Promise<void>

/**
 * "Banco de questões" (the question shelf): the bank in numbers, every trail topic with its new
 * questions against the goal, and the questions of a topic as cards. The bank is filled by
 * "Montar banco" (the agent chain); the user does not review questions one by one.
 */
export function openStudyQuestions(root: HTMLElement, toast: Toast, openBuilder: (preset?: StudyBankRequest) => void): void {
  const content = h('div', { class: 'study-bank-body', role: 'status' }, h('p', { class: 'field-hint' }, 'Lendo o banco…'))
  const notice = h('div', { class: 'study-bank-notice' })
  const build = (preset?: StudyBankRequest) => {
    close()
    openBuilder(preset)
  }
  const close = () => el.remove()
  const el = modal(
    'Banco de questões',
    [
      h(
        'div',
        { class: 'study-questions-body' },
        notice,
        content,
        h(
          'p',
          { class: 'field-hint study-note' },
          'As questões são escritas a partir dos seus livros e conferidas por uma cadeia de agentes antes de entrar; você não precisa revisá-las. As que você já respondeu nunca voltam.',
        ),
      ),
    ],
    [h('button', { class: 'btn btn-primary', type: 'button', onclick: () => build() }, 'Montar banco…')],
    close,
  )
  el.querySelector('.modal')?.classList.add('study-popup', 'study-questions-modal')
  dressStudyWindow(
    el.querySelector('.modal') as HTMLElement,
    { who: STUDY_WHO.bank, subtitle: 'Escrito pelos agentes a partir dos seus livros · nenhuma questão se repete' },
    'm',
  )
  el.querySelector('.modal-foot')?.classList.add('study-modal-foot')
  root.append(el)
  el.querySelector<HTMLElement>('.modal-foot .btn')?.focus()

  void window.office
    .studyBankStatus()
    .then((job) => notice.replaceChildren(...jobNotice(job, () => build())))
    .catch(() => {})
  void Promise.all([
    window.office.readStudyQuestions(),
    window.office.readStudyTrail().then(
      (t) => t.topics,
      () => [],
    ),
    window.office.readStudyCycle().catch(() => ({ activeId: null, cycles: [] })),
    window.office.readStudySubtopics().catch((): Record<string, StudySubtopics> => ({})),
  ])
    .then(([bank, topics, cycles, subtopics]) => {
      const answered = answeredStudyQuestions(cycles)
      const isAnswered = (q: StudyQuestion) => isStudyQuestionAnswered(answered, q)
      const stats = studyBankStats(bank.questions, topics, { goal: STUDY_BANK_DEFAULT_PER_TOPIC, isAnswered })
      const byId = new Map(bank.questions.map((q) => [q.id, q]))
      const remove = async (topic: string, ids: string[]) => {
        const ok = await confirmDialog(root, {
          title: ids.length === 1 ? 'Excluir a questão?' : 'Excluir as questões do tópico?',
          text: `${plural(ids.length, 'questão', 'questões')} de “${topic}” saem do banco (fica uma cópia de segurança do arquivo). Isso não apaga o seu progresso; você pode montar o banco de novo depois.`,
          confirm: 'Excluir',
          cancel: 'Cancelar',
        })
        if (!ok) return
        try {
          const n = await window.office.deleteStudyQuestions(ids)
          toast(`${plural(n, 'questão excluída', 'questões excluídas')} de “${topic}”.`, 'ok')
          close()
          openStudyQuestions(root, toast, openBuilder)
        } catch (error) {
          toast(cleanError(error), 'err')
        }
      }
      bankView(content, stats, byId, isAnswered, build, subtopics, remove)
    })
    .catch((error: unknown) =>
      content.replaceChildren(h('p', { class: 'field-hint', role: 'alert' }, `Não foi possível ler o banco: ${cleanError(error)}`)),
    )
}

/** A run going on, or the last one stopped: a line that leads to it. */
function jobNotice(job: StudyBankJob | null, open: () => void): HTMLElement[] {
  if (!job) return []
  const text =
    job.status === 'running'
      ? `Montando o banco: ${job.current?.topic ?? 'preparando'} · ${job.done} de ${job.total} tópicos · ${job.added} novas.`
      : job.status === 'done'
        ? `Última montagem: ${job.added} questões novas em ${job.total} tópicos.`
        : `A última montagem parou no tópico ${Math.min(job.done + 1, job.total)} de ${job.total}.`
  return [
    h(
      'div',
      { class: `bq-last${job.status === 'stopped' ? ' warn' : ''}` },
      h('span', {}, text),
      h('button', { class: 'btn btn-small', type: 'button', onclick: open }, job.status === 'running' ? 'Ver andamento' : 'Ver relatório'),
    ),
  ]
}

const plural = (n: number, one: string, many: string): string => `${n.toLocaleString('pt-BR')} ${n === 1 ? one : many}`
const word = (n: number, one: string, many: string): string => (n === 1 ? one : many)

const stat = (n: number, label: string, note: string, tone: string): HTMLElement =>
  h('div', { class: 'bq-stat', style: `--tone: ${tone}` }, h('b', {}, n.toLocaleString('pt-BR')), h('span', {}, label), h('small', {}, note))

/** The overview (numbers + a card per discipline); a discipline opens in place with its topics. */
function bankView(
  content: HTMLElement,
  stats: StudyBankStats,
  byId: Map<string, StudyQuestion>,
  isAnswered: (q: StudyQuestion) => boolean,
  build: (preset?: StudyBankRequest) => void,
  subtopics: Record<string, StudySubtopics>,
  remove: Remove,
): void {
  const show = (name: string | null): void => {
    const d = name === null ? undefined : stats.disciplines.find((item) => item.discipline === name)
    content.replaceChildren(...(d ? disciplineView(d, stats, byId, isAnswered, build, subtopics, remove, () => show(null)) : overview(stats, build, show)))
    if (d) content.querySelector<HTMLElement>('.bq-crumb .btn')?.focus()
  }
  show(null)
}

function overview(stats: StudyBankStats, build: (preset?: StudyBankRequest) => void, open: (name: string) => void): HTMLElement[] {
  if (!stats.total)
    return [
      h(
        'div',
        { class: 'st' },
        h('div', { class: 'st-icon', 'aria-hidden': 'true' }, '?'),
        h(
          'div',
          { class: 'st-body' },
          h('b', {}, 'O banco está vazio'),
          h('p', {}, 'Monte o banco pela trilha: o app escreve questões a partir dos seus livros e confere cada uma antes de guardar.'),
          h(
            'div',
            { class: 'st-actions' },
            h('button', { class: 'btn btn-primary', type: 'button', onclick: () => build() }, 'Montar banco…'),
          ),
        ),
      ),
    ]
  const room = STUDY_QUESTION_LIMITS.count.toLocaleString('pt-BR')
  const notes = [
    stats.byReview.none ? plural(stats.byReview.none, 'questão sem conferência', 'questões sem conferência') : '',
    stats.open ? `${plural(stats.open, 'aberta sai', 'abertas saem')} na próxima montagem` : '',
  ].filter(Boolean)
  return [
    h(
      'div',
      { class: 'bq-stats', role: 'group', 'aria-label': 'Banco em números' },
      stat(stats.total, 'no banco', `cabem ${room}`, 'var(--amber)'),
      stat(stats.byReview.agents, word(stats.byReview.agents, 'verificada', 'verificadas'), 'por agentes', 'var(--green)'),
      stat(stats.total - stats.answered, 'novas para você', 'ainda não respondidas', 'var(--blue)'),
      stat(stats.answered, 'já respondidas', 'não voltam', 'var(--pink)'),
    ),
    notes.length ? h('p', { class: 'field-hint study-note' }, notes.join(' · ')) : null,
    stats.below
      ? h(
          'div',
          { class: 'bq-goal' },
          h(
            'span',
            {},
            h('b', {}, plural(stats.below, 'tópico', 'tópicos')),
            ' abaixo da meta de ',
            h('b', {}, plural(stats.goal, 'questão', 'questões')),
            ' cada',
          ),
          h('button', { class: 'btn btn-primary', type: 'button', onclick: () => build() }, 'Completar…'),
        )
      : null,
    h(
      'div',
      { class: 'bq-head' },
      h('h3', {}, 'Por disciplina'),
      h('span', { class: 'bk-reason' }, plural(stats.disciplines.length, 'disciplina', 'disciplinas')),
    ),
    h(
      'div',
      { class: 'bq-grid' },
      ...stats.disciplines.map((d) => {
        const total = d.topics.filter((t) => t.id !== undefined).length
        const met = total - d.below
        return h(
          'button',
          { class: 'bq-disc', type: 'button', onclick: () => open(d.discipline) },
          h('span', { class: 'name' }, d.discipline),
          h('span', { class: 'count' }, h('b', {}, String(d.fresh)), word(d.fresh, 'questão nova', 'questões novas')),
          h(
            'span',
            { class: 'bq-meter', role: 'img', 'aria-label': `${met} de ${total} tópicos na meta` },
            h('i', { style: `width: ${total ? (met / total) * 100 : 0}%` }),
          ),
          h('span', { class: 'muted' }, `${met} de ${plural(total, 'tópico', 'tópicos')} na meta`),
          d.below ? h('span', { class: 'bq-pill' }, `${d.below} abaixo`) : h('span', { class: 'bq-pill ok' }, 'na meta'),
          h('span', { class: 'go' }, 'ver tópicos ›'),
        )
      }),
    ),
  ].filter((node): node is NonNullable<typeof node> => node !== null)
}

function disciplineView(
  d: StudyBankStats['disciplines'][number],
  stats: StudyBankStats,
  byId: Map<string, StudyQuestion>,
  isAnswered: (q: StudyQuestion) => boolean,
  build: (preset?: StudyBankRequest) => void,
  subtopics: Record<string, StudySubtopics>,
  remove: Remove,
  back: () => void,
): HTMLElement[] {
  const total = d.topics.filter((t) => t.id !== undefined).length
  const missing = d.topics.reduce((sum, t) => (t.id !== undefined ? sum + Math.max(0, stats.goal - t.fresh) : sum), 0)
  const id = disciplineIdOf(d.topics.find((t) => t.id)?.id)
  const backButton = () => h('button', { class: 'btn', type: 'button', onclick: back }, '‹ Disciplinas')
  return [
    h('div', { class: 'bq-crumb' }, backButton(), h('h3', {}, d.discipline)),
    h(
      'div',
      { class: 'bq-stats' },
      stat(d.fresh, word(d.fresh, 'questão nova', 'questões novas'), `meta ${(total * stats.goal).toLocaleString('pt-BR')} (${total} × ${stats.goal})`, 'var(--amber)'),
      stat(total - d.below, 'na meta', `de ${plural(total, 'tópico', 'tópicos')}`, 'var(--green)'),
      stat(d.below, 'abaixo da meta', `faltam ${plural(missing, 'questão', 'questões')}`, 'var(--red)'),
    ),
    h('div', { class: 'bq-rows' }, ...d.topics.map((t) => topicRow(t, stats.goal, byId, isAnswered, d.discipline, subtopics[t.topic], remove, (entry) => (subtopics[t.topic] = entry)))),
    h(
      'div',
      { class: 'bq-crumb' },
      backButton(),
      h('span', { style: 'flex: 1' }),
      d.below && id
        ? h('button', { class: 'btn btn-primary', type: 'button', onclick: () => build({ discipline: id }) }, `Completar ${d.discipline}…`)
        : null,
    ),
  ]
}

/** A trail topic: new questions against the goal; opening it shows its questions. */
function topicRow(
  t: StudyBankStats['disciplines'][number]['topics'][number],
  goal: number,
  byId: Map<string, StudyQuestion>,
  isAnswered: (q: StudyQuestion) => boolean,
  discipline: string,
  subtopics: StudySubtopics | undefined,
  remove: Remove,
  onBuilt: (entry: StudySubtopics) => void,
): HTMLElement {
  const cards = h('div', { class: 'bn-cards' })
  const inTrail = t.id !== undefined
  return h(
    'details',
    {
      class: `bq-trow${inTrail && !t.below ? ' met' : ''}`,
      ontoggle: (event: Event) => {
        const open = (event.currentTarget as HTMLDetailsElement).open
        if (!open || cards.childElementCount) return
        const questions = t.ids.map((id) => byId.get(id)).filter((q): q is StudyQuestion => !!q)
        cards.replaceChildren(
          ...(questions.length
            ? questions.flatMap((q) => [
                studyQuestionCard(q, isAnswered(q), discipline),
                h('button', { class: 'btn btn-small', type: 'button', onclick: () => void remove(t.topic, [q.id]) }, 'Excluir esta questão'),
              ])
            : [h('p', { class: 'field-hint' }, 'Nenhuma questão ainda. Use “Montar banco” para este tópico.')]),
        )
      },
    },
    h(
      'summary',
      {},
      h('span', { class: 'nm' }, t.topic),
      inTrail
        ? h(
            'span',
            { class: 'bq-meter', role: 'img', 'aria-label': `${t.fresh} de ${goal}` },
            h('i', { style: `width: ${Math.min(100, (t.fresh / goal) * 100)}%${t.below ? '; background: var(--amber)' : ''}` }),
          )
        : h('span', {}),
      h('span', { class: 'num', title: `${t.fresh} novas de ${t.count}` }, inTrail ? `${t.fresh}/${goal}` : String(t.fresh)),
      inTrail ? h('span', { class: `bq-pill${t.below ? '' : ' ok'}` }, t.below ? 'Abaixo' : 'Na meta') : h('span', {}),
    ),
    coverage(subtopics, t.ids.map((id) => byId.get(id)).filter((q): q is StudyQuestion => !!q), isAnswered, onBuilt),
    t.ids.length
      ? h(
          'div',
          { class: 'bq-crumb' },
          h('button', { class: 'btn btn-small', type: 'button', onclick: () => void remove(t.topic, t.ids) }, `Excluir as ${t.ids.length} questões`),
        )
      : null,
    cards,
  )
}

/** The cycle's default questions per subtopic (study-cycle.ts); below it the diagnosis will not start. */
const DIAGNOSIS_PER_SUBTOPIC = 3

/** The parts of a topic and how many new questions each has; a part with none is the gap the diagnosis would miss. */
function coverage(entry: StudySubtopics | undefined, questions: StudyQuestion[], isAnswered: (q: StudyQuestion) => boolean,
  onBuilt: (entry: StudySubtopics) => void,
): HTMLElement | null {
  if (!entry) return null
  if (entry.status !== 'ok') {
    const box = h('div', { class: 'study-note' })
    const show = (message: string) => {
      const retry = h(
        'button',
        {
          class: 'btn btn-small',
          type: 'button',
          onclick: async () => {
            retry.disabled = true
            retry.textContent = 'Refazendo…'
            try {
              // The topic is replaced in place by whatever the new build says (ok or not).
              const built = await window.office.buildStudySubtopics(entry.topic)
              onBuilt(built) // so the discipline view, reopened later, does not show the old entry
              box.replaceWith(coverage(built, questions, isAnswered, onBuilt)!)
            } catch (error) {
              retry.disabled = false
              retry.textContent = 'Refazer subtemas'
              show(`Não consegui refazer: ${cleanError(error)}`)
            }
          },
        },
        'Refazer subtemas',
      )
      box.replaceChildren(h('p', { class: 'field-hint' }, message), retry)
    }
    show(`Sem subtemas: ${entry.reason ?? 'o índice do livro não ajudou'} O diagnóstico sorteia do tópico todo.`)
    return box
  }
  return h(
    'div',
    { class: 'bq-crumb', role: 'group', 'aria-label': 'Cobertura por subtema' },
    ...entry.subtopics.map((sub) => {
      const fresh = freshChoiceCount(questions, sub.name, isAnswered)
      const short = fresh < DIAGNOSIS_PER_SUBTOPIC
      const where = sub.sections.map((x) => `${x.title} (p. ${x.page})`).join('; ')
      return h(
        'span',
        {
          class: `bq-pill${short ? '' : ' ok'}`,
          title: short ? `${where}. O diagnóstico só começa com ${DIAGNOSIS_PER_SUBTOPIC} por subtema: monte o banco para completar.` : where,
        },
        `${sub.name} · ${fresh ? plural(fresh, 'nova', 'novas') : 'sem questões'}${short && fresh ? ` · faltam ${DIAGNOSIS_PER_SUBTOPIC - fresh}` : ''}`,
      )
    }),
  )
}
