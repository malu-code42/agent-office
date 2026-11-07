import {
  coveredTopics,
  MAX_TOPICS_PER_REQUEST,
  PROJECT_STATUS_LABEL,
  PROJECT_STATUSES,
  studiedTopics,
  uncoveredTopicsOf,
  type StudyProject,
  type StudyProjectStatus,
} from '@shared/study-ideas'
import { topicName } from '@shared/study-trail'
import { announce } from './a11y'
import { h } from './dom'
import { cleanError, modal } from './modals/common'
import { dressStudyWindow, STUDY_WHO } from './study-kit'

type Toast = (text: string, kind?: 'info' | 'ok' | 'err') => void

const names = (topics: string[]) => topics.map(topicName).join(', ')

/**
 * Janela dos projetos de software: um botão gera várias ideias a partir dos tópicos estudados (sem escolher
 * à mão), o modelo indica a melhor, e cada projeto fica guardado com o estado marcado pela usuária.
 */
export async function openStudyIdeas(root: HTMLElement, toast: Toast): Promise<void> {
  let topics: ReturnType<typeof studiedTopics>
  let projects: StudyProject[]
  try {
    const [state, stored] = await Promise.all([window.office.readStudyCycle(), window.office.readStudyProjects()])
    topics = studiedTopics(state)
    projects = stored
  } catch (error) {
    toast(cleanError(error), 'err')
    return
  }
  root.querySelector('[data-study-ideas]')?.remove()
  // O que está em andamento ('generate' ou 'spec:<id>') e qual projeto pede confirmação para excluir.
  let busy: string | null = null
  let confirming: string | null = null
  const body = h('div', { class: 'study-ideas' })
  const sendTopics = topics.slice(0, MAX_TOPICS_PER_REQUEST).map((t) => t.topic)

  /** Refaz a lista e devolve o foco ao controle (identificado por data-k) que o tinha, pois o repaint o recria. */
  const repaint = (focusKey?: string) => {
    const key = focusKey ?? (document.activeElement instanceof HTMLElement ? document.activeElement.dataset.k : undefined)
    paint()
    if (key) body.querySelector<HTMLElement>(`[data-k="${CSS.escape(key)}"]`)?.focus()
  }

  const generate = async () => {
    if (busy || !sendTopics.length) return
    busy = 'generate'
    repaint('generate')
    try {
      const result = await window.office.generateStudyProjects(sendTopics)
      projects = result.projects
      announce('Projetos gerados.')
      if (result.skipped.length) toast(`${result.skipped.length} tópico(s) ficaram de fora porque ainda não estão prontos.`, 'info')
    } catch (error) {
      toast(cleanError(error), 'err')
    }
    busy = null
    repaint('generate')
  }

  const setStatus = async (project: StudyProject, status: StudyProjectStatus) => {
    if (busy || project.status === status) return
    try {
      projects = await window.office.setStudyProjectStatus(project.id, status)
      announce(`${project.title}: ${PROJECT_STATUS_LABEL[status]}.`)
    } catch (error) {
      toast(cleanError(error), 'err')
    }
    repaint(`status:${project.id}:${status}`)
  }

  const remove = async (project: StudyProject) => {
    if (busy) return
    if (confirming !== project.id) {
      confirming = project.id
      repaint(`delete:${project.id}`)
      announce(`Confirme para excluir ${project.title}.`)
      return
    }
    confirming = null
    try {
      projects = await window.office.deleteStudyProject(project.id)
      announce(`${project.title} excluído.`)
    } catch (error) {
      toast(cleanError(error), 'err')
    }
    repaint('generate')
  }

  const spec = async (project: StudyProject) => {
    if (busy) return
    busy = `spec:${project.id}`
    repaint(`spec:${project.id}`)
    try {
      projects = await window.office.generateStudySpec(project.id)
      announce(`Especificação de ${project.title} gerada.`)
    } catch (error) {
      toast(cleanError(error), 'err')
    }
    busy = null
    repaint(`spec:${project.id}`)
  }

  const exportSpec = async (project: StudyProject) => {
    try {
      const file = await window.office.exportStudySpec(project.id)
      if (file) {
        toast(`Especificação exportada em ${file}`, 'ok')
        announce('Especificação exportada.')
      }
    } catch (error) {
      toast(cleanError(error), 'err')
    }
  }

  const card = (project: StudyProject, covered: ReadonlySet<string>) => {
    const open = uncoveredTopicsOf(project, covered)
    const working = busy === `spec:${project.id}`
    const asking = confirming === project.id
    const deleteButton = h(
      'button',
      { class: `btn btn-small${asking ? ' btn-danger' : ''}`, type: 'button', 'data-k': `delete:${project.id}`, onclick: () => void remove(project) },
      asking ? 'Confirmar exclusão' : 'Excluir',
    )
    // Sair do botão cancela o pedido de confirmação, sem refazer a lista (o foco seguiria o repaint).
    deleteButton.addEventListener('blur', () => {
      if (confirming !== project.id) return
      confirming = null
      deleteButton.textContent = 'Excluir'
      deleteButton.classList.remove('btn-danger')
    })
    return h(
      'section',
      { class: `panelbox${project.best ? ' green' : ''}`, 'aria-label': project.title },
      h(
        'div',
        { class: 'tk-top' },
        h('b', {}, project.title),
        project.best ? h('span', { class: 'sk-chip sk-chip-ok' }, 'Melhor indicada') : null,
        h('span', { class: 'grow' }),
        h('span', { class: `sk-chip ${project.status === 'feito' ? 'sk-chip-ok' : project.status === 'escolhido' ? 'sk-chip-info' : 'sk-chip-mute'}` }, PROJECT_STATUS_LABEL[project.status]),
      ),
      project.best ? h('div', { class: 'tk-sub' }, `Por quê: ${project.best.reason}`) : null,
      h('div', {}, project.description),
      h('div', { class: 'tk-sub' }, `Tópicos usados: ${names(project.topics)}`),
      h(
        'div',
        { class: 'tk-sub' },
        open.length ? `Cobre ${open.length} ${open.length === 1 ? 'tópico' : 'tópicos'} ainda sem projeto feito: ${names(open)}` : 'Todos os tópicos dele já têm projeto feito.',
      ),
      h(
        'div',
        { class: 'tk-top', role: 'group', 'aria-label': `Estado de ${project.title}` },
        ...PROJECT_STATUSES.map((status) =>
          h(
            'button',
            {
              class: `btn btn-small${project.status === status ? ' btn-primary' : ''}`,
              type: 'button',
              'aria-pressed': project.status === status ? 'true' : 'false',
              'data-k': `status:${project.id}:${status}`,
              onclick: () => void setStatus(project, status),
            },
            PROJECT_STATUS_LABEL[status],
          ),
        ),
        h('span', { class: 'grow' }),
        deleteButton,
      ),
      h(
        'div',
        { class: 'tk-top' },
        h(
          'button',
          { class: 'btn btn-small', type: 'button', disabled: busy !== null, 'data-k': `spec:${project.id}`, onclick: () => void spec(project) },
          working ? 'Gerando…' : project.spec ? 'Gerar especificação de novo' : 'Gerar especificação',
        ),
        project.spec ? h('button', { class: 'btn btn-small', type: 'button', onclick: () => void exportSpec(project) }, 'Exportar .md') : null,
      ),
      project.spec ? h('details', {}, h('summary', {}, 'Ver especificação'), h('pre', { class: 'tk-sub tk-spec' }, project.spec.markdown)) : null,
    )
  }

  const paint = () => {
    const covered = coveredTopics(projects)
    const pending = topics.filter((t) => !covered.has(t.topic))
    const ordered = [...projects].sort((a, b) => b.createdAt - a.createdAt)
    body.replaceChildren(
      h(
        'section',
        { class: 'panelbox' },
        h(
          'div',
          { class: 'tk-top' },
          h('b', {}, `${topics.length} ${topics.length === 1 ? 'tópico estudado' : 'tópicos estudados'}`),
          h('span', { class: 'tk-sub' }, `${topics.length - pending.length} com projeto feito`),
          h('span', { class: 'grow' }),
          h(
            'button',
            { class: 'btn btn-small btn-primary', type: 'button', disabled: busy !== null || !sendTopics.length, 'data-k': 'generate', onclick: () => void generate() },
            busy === 'generate' ? 'Gerando…' : projects.length ? 'Gerar mais projetos' : 'Gerar projetos',
          ),
        ),
        pending.length ? h('div', { class: 'tk-sub' }, `Sem projeto feito: ${names(pending.map((t) => t.topic))}`) : null,
        topics.length > MAX_TOPICS_PER_REQUEST ? h('div', { class: 'tk-sub' }, `Cada pedido usa os ${MAX_TOPICS_PER_REQUEST} tópicos mais recentes.`) : null,
      ),
      ...(ordered.length
        ? ordered.map((project) => card(project, covered))
        : [
            h(
              'div',
              { class: 'empty-box panelbox' },
              h('b', {}, topics.length ? 'Nenhum projeto gerado ainda' : 'Nenhum tópico estudado ainda'),
              h(
                'span',
                {},
                topics.length ? 'Gere os projetos: o modelo escolhe quais tópicos combinam em cada um.' : 'Os tópicos vêm do ciclo de estudos: comece um diagnóstico para eles aparecerem aqui.',
              ),
            ),
          ]),
    )
  }

  const close = () => el.remove()
  const el = modal('Ideias de software', [body], [], close)
  el.setAttribute('data-study-ideas', 'true')
  dressStudyWindow(el.querySelector<HTMLElement>('.modal')!, { who: STUDY_WHO.bonnie, subtitle: 'Projetos a partir dos tópicos estudados · estado de cada um' }, 'm')
  root.append(el)
  paint()
}
