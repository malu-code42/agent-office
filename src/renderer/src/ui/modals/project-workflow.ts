import type { ProjectFloor, ProjectWorkflow } from '@shared/types'
import { pendingTickets } from '@shared/squad-tickets'
import type { State } from '../../state'
import { h } from '../dom'
import { cleanError, modal } from './common'

type Stage = 'grill' | 'spec' | 'tickets'

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
    if (!workflow?.grillApprovedAt) return 'grill'
    if (!workflow.specApprovedAt) return 'spec'
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

  function paint(): void {
    const current = stage()
    if (current === 'ready') {
      const proposal = workflow?.redistributionProposal
      const changes = proposal?.changes ?? []
      const parts: HTMLElement[] = [
        h('div', { class: 'modal-sub' }, 'Tickets aprovados e salvos. Opcionalmente, peça à Emi uma proposta de redistribuição entre squads existentes; ela só será aplicada após sua aprovação.'),
        h('div', { class: 'panelbox' }, h('div', { class: 'sec-title' }, `Trabalho aprovado · ${workflow?.ticketIds.length ?? 0} tickets`),
          h('div', {}, workflow?.goal ?? ''), h('div', { class: 'hint' }, workflow?.criteria.join(' · ') ?? '')),
      ]
      if (changes.length) parts.push(h('div', { class: 'panelbox' }, h('div', { class: 'sec-title' }, proposal?.approvedAt ? 'Redistribuição aprovada' : 'Proposta da Emi · pendente de aprovação'),
        ...changes.map((change) => h('div', { class: 'hint' }, `${change.ticketId}: ${change.fromSquad ?? 'sem squad'} → ${change.toSquad ?? 'sem squad'}`))))
      const buttons: HTMLElement[] = [
        h('span', { class: 'hint grow' }, 'Objetivo e critérios aprovados não mudam.'),
        h('button', { class: 'btn', type: 'button', disabled: busy, onclick: () => void run(async () => {
          await window.office.generateProjectWorkflowDraft(project.id, 'redistribution')
          return window.office.getProjectWorkflow(project.id)
        }) }, busy ? 'Emi está trabalhando…' : 'Propor redistribuição'),
      ]
      if (changes.length && !proposal?.approvedAt) buttons.push(h('button', { class: 'btn', type: 'button', disabled: busy, onclick: () => void run(() => window.office.approveProjectWorkflowRedistribution(project.id)) }, 'Aprovar redistribuição'))
      buttons.push(
        h('button', { class: 'btn btn-primary', type: 'button', disabled: busy, onclick: () => {
          closed = true
          el.remove()
          if (workflow) onReady(workflow)
        } }, 'Continuar para squad'),
        h('button', { class: 'btn', type: 'button', disabled: busy, onclick: () => { closed = true; el.remove() } }, 'Agora não'),
      )
      if (error) parts.push(h('div', { class: 'panelbox red', role: 'alert' }, error))
      body.replaceChildren(...parts)
      foot.replaceChildren(...buttons)
      return
    }
    const parts: HTMLElement[] = [
      h('div', { class: 'modal-sub' }, 'A Emi pode ler documentação do projeto e enviar o contexto ao Claude. Cada geração salva apenas um rascunho; aprove cada etapa explicitamente.'),
      h('div', { class: 'cs-chips' },
        ...(['grill', 'spec', 'tickets'] as const).map((item, index) =>
          h('span', { class: `sbadge ${item === current ? 'sb-info' : (index === 0 ? workflow?.grillApprovedAt : index === 1 ? workflow?.specApprovedAt : workflow?.ticketsApprovedAt) ? 'sb-ok' : 'sb-mute'}` },
            `${index + 1}. ${item === 'grill' ? 'Grill' : item === 'spec' ? 'Especificação' : 'Tickets'}`,
          ),
        ),
      ),
    ]
    const buttons: HTMLElement[] = [h('span', { class: 'hint grow' }, 'A próxima etapa só abre após aprovação explícita.')]

    if (current === 'grill') {
      const goal = h('input', { class: 'input', maxlength: '1000', placeholder: 'Objetivo aprovado do projeto' }) as HTMLInputElement
      const grill = h('textarea', { class: 'input', rows: 6, maxlength: '20000', placeholder: 'Perguntas, decisões e limites esclarecidos com Emi' }) as HTMLTextAreaElement
      goal.value = workflow?.goal ?? ''
      grill.value = workflow?.grill ?? ''
      parts.push(
        h('div', { class: 'panelbox' }, h('label', { class: 'sec-title' }, 'Objetivo'), goal),
        h('div', { class: 'panelbox' }, h('label', { class: 'sec-title' }, 'Grill com documentação'), grill),
      )
      buttons.push(
        h('button', { class: 'btn', type: 'button', disabled: busy, onclick: () => void run(async () => {
          await window.office.saveProjectWorkflowGrill(project.id, goal.value, grill.value)
          return window.office.generateProjectWorkflowDraft(project.id, 'grill')
        }) }, busy ? 'Emi está trabalhando…' : 'Gerar grill com Emi'),
        h('button', { class: 'btn', type: 'button', disabled: busy, onclick: () => void run(() => window.office.saveProjectWorkflowGrill(project.id, goal.value, grill.value)) }, 'Salvar rascunho'),
        h('button', { class: 'btn btn-primary', type: 'button', disabled: busy, onclick: () => void run(async () => {
          await window.office.saveProjectWorkflowGrill(project.id, goal.value, grill.value)
          return window.office.approveProjectWorkflowGrill(project.id)
        }) }, 'Aprovar grill'),
      )
    } else if (current === 'spec') {
      const spec = h('textarea', { class: 'input', rows: 5, maxlength: '20000', placeholder: 'Especificação aprovada' }) as HTMLTextAreaElement
      const criteria = h('textarea', { class: 'input', rows: 5, maxlength: '20000', placeholder: 'Um critério de aceite por linha' }) as HTMLTextAreaElement
      spec.value = workflow?.spec ?? ''
      criteria.value = workflow?.criteria.join('\n') ?? ''
      parts.push(
        h('div', { class: 'panelbox' }, h('div', { class: 'sec-title' }, `Objetivo: ${workflow?.goal ?? ''}`), h('div', { class: 'hint' }, workflow?.grill ?? '')),
        h('div', { class: 'panelbox' }, h('label', { class: 'sec-title' }, 'Spec'), spec),
        h('div', { class: 'panelbox' }, h('label', { class: 'sec-title' }, 'Critérios de aceite'), criteria),
      )
      buttons.push(
        h('button', { class: 'btn', type: 'button', disabled: busy, onclick: () => void run(async () => {
          await window.office.generateProjectWorkflowDraft(project.id, 'spec')
          return window.office.getProjectWorkflow(project.id)
        }) }, busy ? 'Emi está trabalhando…' : 'Gerar spec com Emi'),
        h('button', { class: 'btn', type: 'button', disabled: busy, onclick: () => void run(() => window.office.saveProjectWorkflowSpec(project.id, spec.value, criteria.value.split(/\r?\n/))) }, 'Salvar rascunho'),
        h('button', { class: 'btn btn-primary', type: 'button', disabled: busy, onclick: () => void run(async () => {
          await window.office.saveProjectWorkflowSpec(project.id, spec.value, criteria.value.split(/\r?\n/))
          return window.office.approveProjectWorkflowSpec(project.id)
        }) }, 'Aprovar spec'),
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
        h('div', { class: 'panelbox' }, h('div', { class: 'sec-title' }, 'Escopo aprovado'), h('div', {}, workflow?.spec ?? ''),
          h('div', { class: 'hint' }, workflow?.criteria.join(' · ') ?? '')),
        generated.length ? h('div', { class: 'panelbox' }, h('div', { class: 'sec-title' }, `Rascunhos da Emi · ${generated.length}`),
          ...generated.map((ticket) => h('div', { class: 'rev-check' }, h('span', {}, h('b', {}, ticket.title), h('div', { class: 'hint' }, ticket.description))))
        ) : h('div', { class: 'panelbox' }, 'Ainda não há tickets gerados pela Emi.'),
        h('div', { class: 'panelbox' }, h('div', { class: 'sec-title' }, 'Selecione tickets para a distribuição'),
          list.children.length ? list : h('span', { class: 'hint' }, 'Não há tickets abertos neste andar. Crie tickets no quadro e retome esta etapa.'),
        ),
      )
      buttons.push(
        h('button', { class: 'btn', type: 'button', disabled: busy, onclick: () => void run(async () => {
          await window.office.generateProjectWorkflowDraft(project.id, 'tickets')
          return window.office.getProjectWorkflow(project.id)
        }) }, busy ? 'Emi está trabalhando…' : 'Gerar tickets com Emi'),
        h('button', { class: 'btn', type: 'button', disabled: busy, onclick: () => void run(() => window.office.saveProjectWorkflowTickets(project.id, [...selected])) }, 'Salvar seleção'),
        h('button', { class: 'btn btn-primary', type: 'button', disabled: busy, onclick: () => void run(async () => {
          if (selected.size) await window.office.saveProjectWorkflowTickets(project.id, [...selected])
          return window.office.approveProjectWorkflowTickets(project.id)
        }) }, 'Aprovar tickets e criar distribuição'),
      )
    }

    if (error) parts.push(h('div', { class: 'panelbox red', role: 'alert' }, error))
    buttons.push(h('button', { class: 'btn', type: 'button', disabled: busy, onclick: () => { closed = true; el.remove() } }, 'Agora não'))
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
