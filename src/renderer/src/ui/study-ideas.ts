import { studiedTopics, type StudyIdeaSet } from '@shared/study-ideas'
import { announce } from './a11y'
import { h } from './dom'
import { cleanError, modal } from './modals/common'
import { dressStudyWindow, STUDY_WHO } from './study-kit'

type Toast = (text: string, kind?: 'info' | 'ok' | 'err') => void

/** Topics of the study cycles on the left of the list; each one generates software ideas, kept for later. */
export async function openStudyIdeas(root: HTMLElement, toast: Toast): Promise<void> {
  let topics: ReturnType<typeof studiedTopics>
  let sets: Record<string, StudyIdeaSet>
  try {
    const [state, stored] = await Promise.all([window.office.readStudyCycle(), window.office.readStudyIdeas()])
    topics = studiedTopics(state)
    sets = stored
  } catch (error) {
    toast(cleanError(error), 'err')
    return
  }
  root.querySelector('[data-study-ideas]')?.remove()
  let busy: string | null = null
  const body = h('div', { class: 'study-ideas' })

  const generate = async (topic: string) => {
    if (busy) return
    busy = topic
    paint()
    try {
      sets = { ...sets, [topic]: await window.office.generateStudyIdeas(topic) }
      announce(`Ideias de ${topic} geradas.`)
    } catch (error) {
      toast(cleanError(error), 'err')
    }
    busy = null
    paint()
  }

  const paint = () => {
    body.replaceChildren(
      ...(topics.length
        ? topics.map(({ topic, completed }) => {
            const set = sets[topic]
            return h(
              'section',
              { class: 'panelbox' },
              h(
                'div',
                { class: 'tk-top' },
                h('b', {}, topic),
                h('span', { class: 'tk-sub' }, completed ? 'concluído' : 'em estudo'),
                h('span', { class: 'grow' }),
                h(
                  'button',
                  { class: 'btn btn-small', type: 'button', disabled: busy !== null, onclick: () => void generate(topic) },
                  busy === topic ? 'Gerando…' : set ? 'Gerar de novo' : 'Gerar ideias',
                ),
              ),
              ...(set?.ideas.map((idea) => h('div', { class: 'tk-actions' }, h('b', {}, idea.title), h('div', { class: 'tk-sub' }, idea.description))) ?? []),
            )
          })
        : [h('div', { class: 'empty-box panelbox' }, h('b', {}, 'Nenhum tópico estudado ainda'), h('span', {}, 'Os tópicos vêm do ciclo de estudos: comece um diagnóstico para eles aparecerem aqui.'))]),
    )
  }

  const close = () => el.remove()
  const el = modal('Ideias de software', [body], [], close)
  el.setAttribute('data-study-ideas', 'true')
  dressStudyWindow(el.querySelector<HTMLElement>('.modal')!, { who: STUDY_WHO.bonnie, subtitle: 'Tópicos do ciclo de estudos · ideias para praticar na prática' }, 'm')
  root.append(el)
  paint()
}
