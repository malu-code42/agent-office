import type { ProjectFloor, ProjectWorkflow, ProjectWorkflowDraftKind } from '@shared/types'
import { pendingTickets } from '@shared/squad-tickets'
import type { State } from '../../state'
import { h } from '../dom'
import { cleanError, modal } from './common'

/** The stages of the Elephant-Goldfish Model (EGM) on a project floor, in order. */
type Stage = 'bootstrap' | 'brainstorm' | 'design' | 'review' | 'tickets'

const STAGES: { id: Stage; label: string; done: (w: ProjectWorkflow | undefined) => boolean }[] = [
  { id: 'bootstrap', label: 'Bootstrap', done: (w) => !!w && w.bootstrap !== 'pending' },
  { id: 'brainstorm', label: 'Brainstorm', done: (w) => !!w?.brainstormApprovedAt },
  { id: 'design', label: 'Rascunho do design', done: (w) => !!w?.designApprovedAt },
  { id: 'review', label: 'Revisão Goldfish', done: (w) => !!w?.reviewApprovedAt },
  { id: 'tickets', label: 'Tickets', done: (w) => !!w?.ticketsApprovedAt },
]

const DAY = 24 * 60 * 60 * 1000

/** Emi drafts each stage; saving and approval remain separate user actions. */
export function openProjectWorkflow(root: HTMLElement, state: State, project: ProjectFloor, onReady: (workflow: ProjectWorkflow) => void): void {
  let workflow: ProjectWorkflow | undefined
  let error = ''
  let busy = false
  let closed = false
  const pending = pendingTickets([...state.tickets.values()], state.settings.projects, project.id)
  const el = modal(`Preparar trabalho · ${project.name}`, [], [], () => {
    closed = true
    el.remove()
  })
  el.querySelector('.modal')?.classList.add('mid')
  const body = el.querySelector('.modal-body') as HTMLElement
  const foot = el.querySelector('.modal-foot') as HTMLElement

  const stage = (): Stage | 'ready' => {
    // Bootstrap is optional and once per project: it is offered only before the brainstorm is approved.
    if (workflow?.bootstrap !== 'done' && workflow?.bootstrap !== 'skipped' && !workflow?.brainstormApprovedAt) return 'bootstrap'
    if (!workflow?.brainstormApprovedAt) return 'brainstorm'
    if (!workflow.designApprovedAt) return 'design'
    if (!workflow.reviewApprovedAt) return 'review'
    if (!workflow.ticketsApprovedAt) return 'tickets'
    return 'ready'
  }

  const run = async (action: () => Promise<ProjectWorkflow>) => {
    if (busy) return
    busy = true
    error = ''
    paint()
    try {
      workflow = await action()
    } catch (err) {
      error = cleanError(err)
    } finally {
      busy = false
    }
    if (!closed) paint()
  }
  const draft = (kind: ProjectWorkflowDraftKind, label: string) =>
    h('button', { class: 'btn', type: 'button', disabled: busy, onclick: () => void run(async () => {
      await window.office.generateProjectWorkflowDraft(project.id, kind)
      return window.office.getProjectWorkflow(project.id)
    }) }, busy ? 'Emi está trabalhando…' : label)
  const close = () => h('button', { class: 'btn', type: 'button', disabled: busy, onclick: () => { closed = true; el.remove() } }, 'Agora não')

  /** On demand, suggested weekly: design docs × code. It changes no stage; the user decides doc or code. */
  function driftBox(): HTMLElement {
    const report = workflow?.driftReport
    const stale = !report || Date.now() - report.at > 7 * DAY
    return h('div', { class: 'panelbox' },
      h('div', { class: 'sec-title' }, report ? `Relatório de drift · ${new Date(report.at).toLocaleDateString('pt-BR')}` : 'Relatório de drift'),
      report ? h('div', { class: 'hint' }, report.summary) : h('div', { class: 'hint' }, 'Ainda não há relatório de drift neste andar.'),
      h('div', { class: 'hint' }, `${stale ? 'Sugestão: rode toda semana. ' : ''}A Emi compara o design doc com a documentação; para comparar com o código, peça a ela no chat (/egm:egm-drift-report). Você decide se atualiza o doc ou o código.`),
    )
  }

  function paint(): void {
    const current = stage()
    if (current === 'ready') {
      const proposal = workflow?.redistributionProposal
      const changes = proposal?.changes ?? []
      const parts: HTMLElement[] = [
        h('div', { class: 'modal-sub' }, 'Tickets aprovados e salvos. Opcionalmente, peça à Emi uma proposta de redistribuição entre squads existentes; ela só será aplicada após sua aprovação.'),
        h('div', { class: 'panelbox' }, h('div', { class: 'sec-title' }, `Trabalho aprovado · ${workflow?.ticketIds.length ?? 0} tickets`),
          h('div', {}, workflow?.goal ?? ''),
          workflow?.designPath ? h('div', { class: 'hint' }, `Design doc: ${workflow.designPath}`) : '',
          h('div', { class: 'hint' }, workflow?.criteria.join(' · ') ?? '')),
      ]
      if (changes.length) parts.push(h('div', { class: 'panelbox' }, h('div', { class: 'sec-title' }, proposal?.approvedAt ? 'Redistribuição aprovada' : 'Proposta da Emi · pendente de aprovação'),
        ...changes.map((change) => h('div', { class: 'hint' }, `${change.ticketId}: ${change.fromSquad ?? 'sem squad'} → ${change.toSquad ?? 'sem squad'}`))))
      parts.push(driftBox())
      const buttons: HTMLElement[] = [
        h('span', { class: 'hint grow' }, 'Objetivo e critérios aprovados não mudam.'),
        draft('drift', 'Gerar relatório de drift'),
        draft('redistribution', 'Propor redistribuição'),
      ]
      if (changes.length && !proposal?.approvedAt) buttons.push(h('button', { class: 'btn', type: 'button', disabled: busy, onclick: () => void run(() => window.office.approveProjectWorkflowRedistribution(project.id)) }, 'Aprovar redistribuição'))
      buttons.push(
        h('button', { class: 'btn btn-primary', type: 'button', disabled: busy, onclick: () => {
          closed = true
          el.remove()
          if (workflow) onReady(workflow)
        } }, 'Continuar para squad'),
        close(),
      )
      if (error) parts.push(h('div', { class: 'panelbox red', role: 'alert' }, error))
      body.replaceChildren(...parts)
      foot.replaceChildren(...buttons)
      return
    }
    const parts: HTMLElement[] = [
      h('div', { class: 'modal-sub' }, 'Fluxo do Elephant-Goldfish Model. A Emi pode ler documentação do projeto e enviar o contexto ao Claude. Cada geração salva apenas um rascunho; aprove cada etapa explicitamente. As etapas completas (com os revisores Goldfish) rodam no chat da Emi.'),
      h('div', { class: 'cs-chips' },
        ...STAGES.map((item, index) =>
          h('span', { class: `sbadge ${item.id === current ? 'sb-info' : item.done(workflow) ? 'sb-working' : 'sb-mute'}` },
            `${index + 1}. ${item.label}${item.id === 'bootstrap' && workflow?.bootstrap === 'skipped' ? ' (pulado)' : ''}`,
          ),
        ),
      ),
    ]
    const buttons: HTMLElement[] = [h('span', { class: 'hint grow' }, 'A próxima etapa só abre após aprovação explícita.')]

    if (current === 'bootstrap') {
      parts.push(
        h('div', { class: 'panelbox' }, h('div', { class: 'sec-title' }, 'Bootstrap do projeto (opcional, uma vez)'),
          h('div', { class: 'hint' }, 'Gera ou confere os README.md de cada pasta e o docs/designs/SITEMAP.md, para as próximas etapas terem o contexto do código. Peça à Emi no chat (/egm:egm-bootstrap) e marque aqui quando terminar, ou pule.')),
      )
      buttons.push(
        h('button', { class: 'btn', type: 'button', disabled: busy, onclick: () => void run(() => window.office.setProjectWorkflowBootstrap(project.id, 'skipped')) }, 'Pular bootstrap'),
        h('button', { class: 'btn btn-primary', type: 'button', disabled: busy, onclick: () => void run(() => window.office.setProjectWorkflowBootstrap(project.id, 'done')) }, 'Bootstrap feito'),
      )
    } else if (current === 'brainstorm') {
      const goal = h('input', { class: 'input', maxlength: '1000', placeholder: 'Objetivo aprovado do projeto' }) as HTMLInputElement
      const brainstorm = h('textarea', { class: 'input', rows: 6, maxlength: '20000', placeholder: 'Concepts brief: problema, decisões, escopo, riscos e perguntas em aberto' }) as HTMLTextAreaElement
      goal.value = workflow?.goal ?? ''
      brainstorm.value = workflow?.brainstorm ?? ''
      parts.push(
        h('div', { class: 'panelbox' }, h('label', { class: 'sec-title' }, 'Objetivo'), goal),
        h('div', { class: 'panelbox' }, h('label', { class: 'sec-title' }, 'Brainstorm (concepts brief)'), brainstorm),
      )
      buttons.push(
        h('button', { class: 'btn', type: 'button', disabled: busy, onclick: () => void run(async () => {
          await window.office.saveProjectWorkflowBrainstorm(project.id, goal.value, brainstorm.value)
          return window.office.generateProjectWorkflowDraft(project.id, 'brainstorm')
        }) }, busy ? 'Emi está trabalhando…' : 'Gerar brainstorm com Emi'),
        h('button', { class: 'btn', type: 'button', disabled: busy, onclick: () => void run(() => window.office.saveProjectWorkflowBrainstorm(project.id, goal.value, brainstorm.value)) }, 'Salvar rascunho'),
        h('button', { class: 'btn btn-primary', type: 'button', disabled: busy, onclick: () => void run(async () => {
          await window.office.saveProjectWorkflowBrainstorm(project.id, goal.value, brainstorm.value)
          return window.office.approveProjectWorkflowBrainstorm(project.id)
        }) }, 'Aprovar brainstorm'),
      )
    } else if (current === 'design') {
      const path = h('input', { class: 'input', maxlength: '300', placeholder: 'docs/designs/nome-do-design.md' }) as HTMLInputElement
      const design = h('textarea', { class: 'input', rows: 5, maxlength: '20000', placeholder: 'Design doc: contexto, objetivos, design, alternativas, riscos e plano de implementação' }) as HTMLTextAreaElement
      const criteria = h('textarea', { class: 'input', rows: 5, maxlength: '20000', placeholder: 'Um critério de aceite por linha' }) as HTMLTextAreaElement
      path.value = workflow?.designPath ?? ''
      design.value = workflow?.design ?? ''
      criteria.value = workflow?.criteria.join('\n') ?? ''
      const save = () => window.office.saveProjectWorkflowDesign(project.id, design.value, criteria.value.split(/\r?\n/), path.value)
      parts.push(
        h('div', { class: 'panelbox' }, h('div', { class: 'sec-title' }, `Objetivo: ${workflow?.goal ?? ''}`), h('div', { class: 'hint' }, workflow?.brainstorm ?? '')),
        h('div', { class: 'panelbox' }, h('label', { class: 'sec-title' }, 'Caminho do design doc'), path),
        h('div', { class: 'panelbox' }, h('label', { class: 'sec-title' }, 'Rascunho do design'), design),
        h('div', { class: 'panelbox' }, h('label', { class: 'sec-title' }, 'Critérios de aceite'), criteria),
      )
      buttons.push(
        draft('design', 'Gerar rascunho com Emi'),
        h('button', { class: 'btn', type: 'button', disabled: busy, onclick: () => void run(save) }, 'Salvar rascunho'),
        h('button', { class: 'btn btn-primary', type: 'button', disabled: busy, onclick: () => void run(async () => {
          await save()
          return window.office.approveProjectWorkflowDesign(project.id)
        }) }, 'Aprovar rascunho'),
      )
    } else if (current === 'review') {
      const review = h('textarea', { class: 'input', rows: 8, maxlength: '20000', placeholder: 'Achados dos revisores Goldfish que você escolheu tratar e como foram resolvidos' }) as HTMLTextAreaElement
      review.value = workflow?.review ?? ''
      parts.push(
        h('div', { class: 'panelbox' }, h('div', { class: 'sec-title' }, `Design doc${workflow?.designPath ? ` · ${workflow.designPath}` : ''}`), h('div', { class: 'hint' }, workflow?.design ?? '')),
        h('div', { class: 'panelbox' }, h('label', { class: 'sec-title' }, 'Revisão Goldfish'),
          h('div', { class: 'hint' }, 'Revisores sem memória leem só o design doc e devolvem muitos achados: escolha o que importa. A revisão completa em vários estágios roda no chat da Emi (/egm:egm-review).'),
          review),
      )
      buttons.push(
        draft('review', 'Pedir revisão Goldfish à Emi'),
        h('button', { class: 'btn', type: 'button', disabled: busy, onclick: () => void run(() => window.office.saveProjectWorkflowReview(project.id, review.value)) }, 'Salvar revisão'),
        h('button', { class: 'btn btn-primary', type: 'button', disabled: busy, onclick: () => void run(async () => {
          await window.office.saveProjectWorkflowReview(project.id, review.value)
          return window.office.approveProjectWorkflowReview(project.id)
        }) }, 'Aprovar design revisado'),
      )
    } else {
      const selected = new Set(workflow?.ticketIds.filter((id) => pending.some((ticket) => ticket.id === id)) ?? [])
      const list = h('div', { class: 'cs-tickets' })
      for (const ticket of pending) {
        const checkbox = h('input', { type: 'checkbox' }) as HTMLInputElement
        checkbox.checked = selected.has(ticket.id)
        checkbox.addEventListener('change', () => checkbox.checked ? selected.add(ticket.id) : selected.delete(ticket.id))
        list.append(h('label', { class: 'rev-check' }, checkbox, h('span', {}, h('b', {}, `${ticket.key} · `), ticket.title)))
      }
      const generated = workflow?.ticketDrafts ?? []
      parts.push(
        h('div', { class: 'panelbox' }, h('div', { class: 'sec-title' }, `Design aprovado${workflow?.designPath ? ` · ${workflow.designPath}` : ''}`), h('div', {}, workflow?.design ?? ''),
          h('div', { class: 'hint' }, workflow?.criteria.join(' · ') ?? '')),
        generated.length ? h('div', { class: 'panelbox' }, h('div', { class: 'sec-title' }, `Rascunhos da Emi · ${generated.length}`),
          ...generated.map((ticket) => h('div', { class: 'rev-check' }, h('span', {}, h('b', {}, ticket.title), h('div', { class: 'hint' }, ticket.description))))
        ) : h('div', { class: 'panelbox' }, 'Ainda não há tickets gerados pela Emi.'),
        h('div', { class: 'panelbox' }, h('div', { class: 'sec-title' }, 'Selecione tickets para a distribuição'),
          list.children.length ? list : h('span', { class: 'hint' }, 'Não há tickets abertos neste andar. Crie tickets no quadro e retome esta etapa.'),
        ),
      )
      buttons.push(
        draft('tickets', 'Gerar tickets do design'),
        h('button', { class: 'btn', type: 'button', disabled: busy, onclick: () => void run(() => window.office.saveProjectWorkflowTickets(project.id, [...selected])) }, 'Salvar seleção'),
        h('button', { class: 'btn btn-primary', type: 'button', disabled: busy, onclick: () => void run(async () => {
          if (selected.size) await window.office.saveProjectWorkflowTickets(project.id, [...selected])
          return window.office.approveProjectWorkflowTickets(project.id)
        }) }, 'Aprovar tickets e criar distribuição'),
      )
    }

    if (error) parts.push(h('div', { class: 'panelbox red', role: 'alert' }, error))
    buttons.push(close())
    body.replaceChildren(...parts)
    foot.replaceChildren(...buttons)
  }

  root.append(el)
  body.replaceChildren(h('div', { class: 'panelbox', role: 'status' }, 'Carregando o fluxo salvo…'))
  void window.office.getProjectWorkflow(project.id).then((saved) => {
    if (closed) return
    workflow = saved
    paint()
  }).catch((err) => {
    if (closed) return
    error = cleanError(err)
    body.replaceChildren(h('div', { class: 'panelbox red', role: 'alert' }, error))
  })
}
