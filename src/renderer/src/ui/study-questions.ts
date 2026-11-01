import { STUDY_BANK_DEFAULT_PER_TOPIC, type StudyBankJob, type StudyBankRequest } from '@shared/study-bank'
import { studyBankStats, type StudyBankStats } from '@shared/study-bank-stats'
import { answeredStudyQuestions, isStudyQuestionAnswered } from '@shared/study-cycle'
import { STUDY_QUESTION_LIMITS, type StudyOriginKind, type StudyQuestion } from '@shared/study-questions'
import { h } from './dom'
import { cleanError, modal } from './modals/common'
import { studyMeter, studyQuestionCard } from './study-bank'
import { dressStudyWindow, STUDY_WHO } from './study-kit'

type Toast = (text: string, kind?: 'info' | 'ok' | 'err') => void

const ORIGIN_LABEL: Record<StudyOriginKind, string> = { enem: 'ENEM', concurso: 'Concurso', livro: 'Livro', web: 'Web', ia: 'IA' }

const chip = (label: string, count: number, kind = ''): HTMLElement =>
  h('span', { class: `study-bank-chip${kind ? ` study-bank-chip-${kind}` : ''}` }, h('b', {}, count.toLocaleString('pt-BR')), ` ${label}`)

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
        h(
          'section',
          { class: 'study-bank-stats', 'aria-label': 'Banco em números' },
          h('h3', { class: 'study-section-title' }, 'Banco em números'),
          content,
        ),
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
  ])
    .then(([bank, topics, cycles]) => {
      const answered = answeredStudyQuestions(cycles)
      const isAnswered = (q: StudyQuestion) => isStudyQuestionAnswered(answered, q)
      const stats = studyBankStats(bank.questions, topics, { goal: STUDY_BANK_DEFAULT_PER_TOPIC, isAnswered })
      const byId = new Map(bank.questions.map((q) => [q.id, q]))
      content.replaceChildren(...bankView(stats, byId, isAnswered, build))
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
      { class: `bk-line${job.status === 'stopped' ? ' warn' : ''}` },
      h('span', {}, text),
      h('button', { class: 'btn btn-small', type: 'button', onclick: open }, job.status === 'running' ? 'Ver andamento' : 'Ver relatório'),
    ),
  ]
}

function bankView(
  stats: StudyBankStats,
  byId: Map<string, StudyQuestion>,
  isAnswered: (q: StudyQuestion) => boolean,
  build: (preset?: StudyBankRequest) => void,
): HTMLElement[] {
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
  return [
    h(
      'div',
      { class: 'study-bank-total' },
      h('b', {}, stats.total.toLocaleString('pt-BR')),
      h(
        'span',
        {},
        `${stats.total === 1 ? 'questão' : 'questões'} no banco · cabem ${STUDY_QUESTION_LIMITS.count.toLocaleString('pt-BR')}`,
      ),
    ),
    h(
      'div',
      { class: 'study-bank-row', role: 'group', 'aria-label': 'Quem conferiu' },
      h('span', { class: 'study-bank-cap' }, 'Selo'),
      chip('verificadas por agentes', stats.byReview.agents, 'agents'),
      stats.byReview.none ? chip('sem conferência', stats.byReview.none, 'missing') : null,
      stats.open ? chip('abertas · saem na próxima montagem', stats.open, 'missing') : null,
    ),
    h(
      'div',
      { class: 'study-bank-row', role: 'group', 'aria-label': 'Por origem' },
      h('span', { class: 'study-bank-cap' }, 'Origem'),
      ...(Object.keys(ORIGIN_LABEL) as StudyOriginKind[])
        .filter((k) => stats.byOrigin[k])
        .map((k) => chip(ORIGIN_LABEL[k], stats.byOrigin[k])),
    ),
    h(
      'div',
      { class: 'study-bank-row', role: 'group', 'aria-label': 'Respondidas' },
      h('span', { class: 'study-bank-cap' }, 'Uso'),
      chip('novas para você', stats.total - stats.answered),
      chip('já respondidas (não voltam)', stats.answered, 'missing'),
    ),
    h(
      'div',
      { class: 'bn-goal' },
      `Meta de ${stats.goal} questões novas por tópico: `,
      h('b', {}, String(stats.below)),
      ` ${stats.below === 1 ? 'tópico abaixo' : 'tópicos abaixo'} da meta`,
      stats.below ? h('button', { class: 'btn btn-small', type: 'button', onclick: () => build() }, 'Completar…') : null,
    ),
    h(
      'div',
      { class: 'study-bank-disciplines' },
      h('span', { class: 'study-bank-cap' }, 'Por disciplina'),
      ...stats.disciplines.map((d) =>
        h(
          'details',
          { class: 'study-bank-discipline' },
          h(
            'summary',
            {},
            h(
              'span',
              { class: 'study-bank-dname' },
              d.discipline,
              d.below ? h('span', { class: 'bk-reason passage' }, `${d.below} abaixo`) : null,
            ),
            h('b', { title: `${d.fresh} novas de ${d.count}` }, `${d.fresh}/${d.count}`),
          ),
          ...d.topics.map((t) => topicRow(t, stats.goal, byId, isAnswered, d.discipline)),
        ),
      ),
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
): HTMLElement {
  const cards = h('div', { class: 'bn-cards' })
  return h(
    'details',
    {
      class: `bn-topic${t.below ? ' short' : ''}`,
      ontoggle: (event: Event) => {
        const open = (event.currentTarget as HTMLDetailsElement).open
        if (!open || cards.childElementCount) return
        const questions = t.ids.map((id) => byId.get(id)).filter((q): q is StudyQuestion => !!q)
        cards.replaceChildren(
          ...(questions.length
            ? questions.map((q) => studyQuestionCard(q, isAnswered(q), discipline))
            : [h('p', { class: 'field-hint' }, 'Nenhuma questão ainda. Use “Montar banco” para este tópico.')]),
        )
      },
    },
    h(
      'summary',
      { class: `bn-topic-row${t.below ? ' short' : ''}` },
      h('span', {}, t.topic),
      t.id !== undefined ? studyMeter(Math.min(t.fresh, goal), goal) : h('span', {}),
      h('b', { title: `${t.fresh} novas de ${t.count}` }, String(t.fresh)),
    ),
    cards,
  )
}
