import type { StudyCycleState } from '@shared/study-cycle'
import {
  STUDY_TRAIL_STATE_LABEL,
  studyTopicStart,
  studyTrailBoard,
  type StudyTrail,
  type StudyTrailCard,
  type StudyTrailList,
} from '@shared/study-trail'
import { announce, asDialog, FocusReturn, isTyping, rove } from './a11y'
import { h, icon } from './dom'
import { cleanError } from './modals/common'

type Toast = (text: string, kind?: 'info' | 'ok' | 'err') => void

/** The list shown on the right, remembered between openings, as the Tarefas board does. */
let chosenList: string | undefined

const STAGE: Record<string, string> = {
  diagnosis: 'diagnóstico',
  'review-required': 'erros e dúvidas',
  practice: 'prática e fontes',
  'retest-ready': 'reteste liberado',
  retest: 'reteste',
  completed: 'concluído',
}

/**
 * The "Trilha de estudos" board in Bonnie's office: the lists of trilha zettel.md (one per
 * discipline) on the left with their open topics, the topics of the chosen list on the right
 * with their state. A topic shows its details and "Começar com este tópico", which hands it to
 * `onStart` (the study cycle keeps every earlier cycle). Read only: the trail file is the user's.
 */
export async function openStudyTrailBoard(root: HTMLElement, toast: Toast, onStart: (topic: string) => void): Promise<void> {
  let trail: StudyTrail
  let state: StudyCycleState
  try {
    ;[trail, state] = await Promise.all([window.office.readStudyTrail(), window.office.readStudyCycle()])
  } catch (error) {
    toast(cleanError(error), 'err')
    return
  }
  root.querySelector('[data-study-trail-board]')?.remove()
  const lists = studyTrailBoard(trail, state)
  if (!lists.some((list) => list.key === chosenList)) chosenList = (lists.find((list) => list.current) ?? lists[0])?.key
  const nav = h('nav', { class: 'tk-lists', 'aria-label': 'Disciplinas da trilha' }, h('div', { class: 'tk-lists-cap' }, 'Disciplinas'))
  const panel = h('section', { class: 'tk-panel', tabindex: '-1' })
  const focusBack = new FocusReturn()

  const close = () => board.remove()
  const start = (card: StudyTrailCard) => {
    close()
    onStart(card.topic.label)
  }

  const card = (item: StudyTrailCard): HTMLElement => {
    const { topic } = item
    const plan = studyTopicStart(state, topic.label)
    const action =
      plan.kind === 'open' ? 'Abrir o ciclo atual' : plan.kind === 'resume' ? 'Retomar com este tópico' : 'Começar com este tópico'
    const detail =
      plan.kind === 'open'
        ? 'Este é o ciclo atual: abre onde você parou.'
        : plan.kind === 'resume'
          ? 'Há um ciclo guardado deste tópico: ele volta exatamente onde parou.'
          : plan.setAside
            ? 'O ciclo atual fica guardado (nada se perde) e o diagnóstico deste tópico começa com as questões do banco.'
            : 'Abre o diagnóstico deste tópico com as questões do banco que falam dele.'
    return h(
      'li',
      {
        class: `tcard tk-card trail-card trail-${item.state}`,
        tabindex: '0',
        'data-focus-key': topic.label,
        'aria-label': `${topic.label}. ${STUDY_TRAIL_STATE_LABEL[item.state]}. Tópico ${topic.index} de ${topic.total}.`,
        onkeydown: (event: Event) => {
          if ((event as KeyboardEvent).key === 'Enter' && event.target === event.currentTarget) {
            event.preventDefault()
            start(item)
          }
        },
      },
      h(
        'div',
        { class: 'tk-top' },
        h('span', { class: 'tk-pos', title: 'Posição na disciplina' }, `#${topic.index}`),
        h('span', { class: `tk-state trail-state-${item.state}` }, STUDY_TRAIL_STATE_LABEL[item.state]),
        item.cycleStage && item.state !== 'completed' ? h('span', { class: 'tk-sub' }, STAGE[item.cycleStage] ?? item.cycleStage) : null,
        h('span', { class: 'grow' }),
        topic.id ? h('span', { class: 'tk-sub trail-id' }, topic.id) : null,
      ),
      h('div', { class: 'tcard-title tk-title' }, topic.title),
      h(
        'div',
        { class: 'tk-actions trail-detail' },
        h('div', { class: 'tk-sub' }, `${topic.discipline} · ${topic.period} · tópico ${topic.index} de ${topic.total}`),
        h('div', { class: 'tk-sub' }, detail),
        h(
          'button',
          {
            class: `btn btn-small${plan.kind === 'open' ? '' : ' btn-primary'}`,
            type: 'button',
            onclick: (event: Event) => {
              event.stopPropagation()
              start(item)
            },
          },
          action,
        ),
      ),
    )
  }

  const paint = () => {
    const list = lists.find((item) => item.key === chosenList)
    panel.replaceChildren(
      ...(list
        ? [
            h(
              'div',
              { class: 'tk-panel-head' },
              h('h3', {}, list.discipline),
              h('span', { class: 'tk-sub' }, `${list.period} · ${list.open} em aberto de ${list.cards.length}`),
            ),
            h('ul', { class: 'tk-cards', 'aria-label': `Tópicos de ${list.discipline}` }, ...list.cards.map(card)),
          ]
        : []),
    )
    for (const btn of nav.querySelectorAll<HTMLElement>('.tk-lbtn')) {
      const on = btn.dataset.list === chosenList
      btn.classList.toggle('on', on)
      btn.setAttribute('aria-current', String(on))
    }
    const cards = [...panel.querySelectorAll<HTMLElement>('.tk-card')]
    const current = cards.findIndex((el) => el.classList.contains('trail-current'))
    if (cards.length) rove(cards, Math.max(0, current))
    if (current >= 0) cards[current]!.classList.add('tk-sel')
  }

  const listButton = (list: StudyTrailList) =>
    h(
      'button',
      { class: 'tk-lbtn', type: 'button', 'data-list': list.key, onclick: () => ((chosenList = list.key), paint()) },
      h('span', { class: 'grow trail-lname' }, h('span', {}, list.discipline), h('span', { class: 'tk-sub' }, list.period)),
      list.current ? h('span', { class: 'tk-lbadge today' }, 'atual') : null,
      h('span', { class: 'tk-lcount', title: 'Tópicos em aberto' }, String(list.open)),
    )
  nav.append(...lists.map(listButton))

  const openTotal = lists.reduce((sum, list) => sum + list.open, 0)
  const board = h(
    'div',
    { class: 'board tasks-board study-trail-board', tabindex: '-1', 'data-study-trail-board': 'true' },
    h(
      'div',
      { class: 'board-head' },
      h('div', { class: 'board-title' }, icon('list', 18), 'Trilha de estudos'),
      h('span', { class: 'board-count' }, `${openTotal} tópico${openTotal === 1 ? '' : 's'} em aberto`),
      h('span', { class: 'grow' }),
      h('button', { class: 'icon-btn', type: 'button', title: 'Fechar (Esc)', onclick: close }, icon('x', 16)),
    ),
    lists.length
      ? h('div', { class: 'board-body tk-board' }, nav, panel)
      : h(
          'div',
          { class: 'board-body tk-board' },
          h(
            'div',
            { class: 'empty-box panelbox' },
            h('b', {}, trail.found ? 'A trilha não tem tópicos' : 'trilha zettel.md não encontrada'),
            h('span', {}, 'Os tópicos são as caixas de seleção sob cada disciplina (### …) do arquivo trilha zettel.md do vault.'),
          ),
        ),
  ) as HTMLElement
  asDialog(board, { label: 'Trilha de estudos' })

  // The selected card shows its details and the start button, as on the Tarefas board.
  const select = (event: Event) => {
    const el = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('.tk-card') : null
    if (!el) return
    for (const other of board.querySelectorAll('.tk-card.tk-sel')) if (other !== el) other.classList.remove('tk-sel')
    el.classList.add('tk-sel')
  }
  board.addEventListener('focusin', select)
  board.addEventListener('click', select)
  const onKey = (event: KeyboardEvent) => {
    if (!board.isConnected || isTyping() || event.altKey || event.metaKey || event.ctrlKey) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
      return
    }
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown' && event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    event.stopPropagation()
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const buttons = [...nav.querySelectorAll<HTMLElement>('.tk-lbtn')]
    const cards = [...panel.querySelectorAll<HTMLElement>('.tk-card')]
    if (active && nav.contains(active)) {
      if (event.key === 'ArrowRight') return void cards[0]?.focus()
      if (event.key === 'ArrowLeft') return
      const at = Math.max(0, Math.min(buttons.length - 1, buttons.indexOf(active) + (event.key === 'ArrowDown' ? 1 : -1)))
      buttons[at]?.focus()
      chosenList = buttons[at]?.dataset.list
      paint()
      return
    }
    if (event.key === 'ArrowLeft') return void buttons.find((b) => b.dataset.list === chosenList)?.focus()
    if (event.key === 'ArrowRight') return
    const at = cards.indexOf(active?.closest<HTMLElement>('.tk-card') ?? cards[0]!)
    cards[Math.max(0, Math.min(cards.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus()
  }
  // Capture on window, like the Tarefas board: the game listens on window and would move the player.
  window.addEventListener('keydown', onKey, true)
  const observer = new MutationObserver(() => {
    if (board.isConnected) return
    observer.disconnect()
    window.removeEventListener('keydown', onKey, true)
    focusBack.restore(board)
  })
  focusBack.save(board)
  root.append(board)
  observer.observe(root, { childList: true })
  paint()
  ;(panel.querySelector<HTMLElement>('.tk-card.tk-sel') ?? nav.querySelector<HTMLElement>('.tk-lbtn.on') ?? board).focus({
    preventScroll: true,
  })
  announce(`Trilha de estudos aberta: ${lists.length} disciplina${lists.length === 1 ? '' : 's'}.`)
}
