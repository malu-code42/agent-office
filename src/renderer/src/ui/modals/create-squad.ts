import {
  memberEngineLine,
  proposalCloseAction,
  SQUAD_ROLE_LABELS,
  SQUAD_MODELS,
  ticketAttribution,
  type ProjectFloor,
  type ProposalStep,
  type SquadInfo,
  type SquadProposal,
  type SquadProposalMember,
  type Ticket,
} from '@shared/types'
import { pendingTickets } from '@shared/squad-tickets'
import { isTicketBlocked, unresolvedBlockerIds } from '@shared/ticket-blockers'
import { competencyProfiles } from '@shared/competency-profiles'
import type { State } from '../../state'
import type { SquadRoom } from '../../world/layout'
import { h } from '../dom'
import { cleanError, modal } from './common'
import { openProjectWorkflow } from './project-workflow'
import type { ProjectWorkflow } from '@shared/types/project-orchestration'

// "Criar squad": one window with two steps. The brief (and the tickets it may take)
// and then the composition the model proposed, read only until the player approves it.
// Nothing is created before the approval: the room only shows an amber outline.

/** The id of a proposal. The page names it so it can throw it away while it generates. */
function newId(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export interface CreateSquadOptions {
  /** The floor the room belongs to. */
  project: ProjectFloor
  /** The room of the floor. */
  room: SquadRoom
  /** The proposal already waiting in this room, when the player reopens it. */
  proposal?: SquadProposal
  toast: (t: string, k?: 'info' | 'ok' | 'err') => void
  /** Called after the squad was created. */
  onApproved?: (squad: SquadInfo) => void
}

/**
 * The window of a proposal. It closes with Esc, the X and a click outside; a proposal
 * that is already on the screen stays pending when the window closes (the room keeps
 * its amber outline), and the explicit "Cancelar" throws it away.
 */
export function openCreateSquad(root: HTMLElement, state: State, opts: CreateSquadOptions): void {
  openProjectWorkflow(root, state, opts.project, (approved) => openCreateSquadReady(root, state, opts, approved))
}

function openCreateSquadReady(root: HTMLElement, state: State, opts: CreateSquadOptions, workflow: ProjectWorkflow): void {
  const { project, room, toast } = opts
  const reopened = opts.proposal?.composition ? opts.proposal : undefined
  let step: ProposalStep = reopened ? 'proposal' : 'brief'
  let proposal: SquadProposal | undefined = reopened
  const id = reopened?.id ?? newId()
  let brief = reopened?.brief ?? ''
  const picked = new Set<string>(reopened?.ticketIds ?? workflow.ticketIds)
  let name = reopened?.name ?? `Squad da Sala ${room.index + 1}`
  const manualMembers: SquadProposalMember[] = reopened?.composition?.members.map((member) => ({ ...member })) ?? [
    {
      id: 'implementer',
      name: 'Implementador',
      role: 'implementer',
      engine: 'claude',
      model: '',
      account: '',
      focus: 'Implementa os tickets aprovados.',
    },
    {
      id: 'reviewer',
      name: 'Revisor',
      role: 'reviewer',
      engine: 'claude',
      model: '',
      account: '',
      focus: 'Revisa o código de forma independente e reporta achados.',
    },
  ]
  let adjusting = false
  let adjustment = ''
  let error = ''
  let closed = false
  let focus: HTMLElement | null = null

  const tickets = pendingTickets([...state.tickets.values()], state.settings.projects, project.id).filter((ticket) =>
    workflow.ticketIds.includes(ticket.id),
  )
  const roomName = `Sala ${room.index + 1}`

  const el = modal('Criar squad', [], [], () => close(false))
  // The approved drawing (HANDOFF 3.4.2) gives this window more room than the small popups.
  el.querySelector('.modal')?.classList.add('mid')
  const body = el.querySelector('.modal-body') as HTMLElement
  const foot = el.querySelector('.modal-foot') as HTMLElement

  /** The tickets the player chose, in the order of the board. */
  const pickedTickets = (): Ticket[] => tickets.filter((t) => picked.has(t.id))

  /** The brief and the tickets, echoed on every step. */
  const echo = (): HTMLElement => {
    const chosen = pickedTickets()
    return h(
      'div',
      { class: 'panelbox' },
      h('div', { class: 'sec-title' }, 'Seu brief'),
      h('div', { class: 'cs-echo' }, brief || '(sem texto)'),
      chosen.length
        ? h(
            'div',
            { class: 'cs-chips' },
            ...chosen.map((t) => {
              const blockers = unresolvedBlockerIds(t, [...state.tickets.values()])
              return h(
                'span',
                { class: `sbadge ${blockers.length ? 'sb-error' : 'sb-mute'}` },
                `${t.key} · ${t.title}${blockers.length ? ` · Bloqueado por ${blockers.map((id) => state.tickets.get(id)?.key ?? id).join(', ')}` : ''}`,
              )
            }),
          )
        : h('span', { class: 'hint' }, 'Nenhum ticket escolhido.'),
    )
  }

  /** A card of a member: the name, the role and what it runs with. */
  const memberCard = (title: string, role: string, engine: string, specialty?: string, scope?: string): HTMLElement =>
    h(
      'div',
      { class: 'member' },
      h(
        'div',
        {},
        h('div', { class: 'member-name' }, title),
        h('div', { class: 'member-role' }, role),
        specialty ? h('div', { class: 'member-role' }, `Especialidade: ${specialty}${scope ? ` · ${scope}` : ''}`) : null,
        h('div', { class: 'eng', title: 'Motor, modelo e conta deste integrante' }, engine),
      ),
    )

  /**
   * The name the player edited goes into the proposal: it survives the adjustments,
   * the closing of the window and a new reading of the app.
   */
  const persistName = async (): Promise<void> => {
    const current = name.trim()
    if (!current || !proposal) return
    if (current === proposal.name) return
    try {
      proposal = await window.office.renameSquadProposal(proposal.id, current)
    } catch {
      // The name stays in the field: the approval carries it anyway.
    }
  }

  const close = (discard: boolean) => {
    if (closed) return
    closed = true
    // A displayed proposal stays pending. During generation/error the proposal is
    // discarded, including an adjustment whose old composition was visible before.
    const action = proposalCloseAction({
      discard,
      hasProposal: !!proposal,
      step: error ? 'error' : step,
      assigned: proposal?.status === 'assigned',
    })
    if (action === 'discard') void window.office.discardSquadProposal(proposal!.id).catch(() => undefined)
    else if (action === 'discard-id') void window.office.discardSquadProposal(id).catch(() => undefined)
    else if (action === 'keep') void persistName()
    el.remove()
  }

  const propose = async () => {
    if (!brief.trim()) return
    step = 'loading'
    error = ''
    paint()
    try {
      proposal = await window.office.proposeSquad({
        id,
        projectId: project.id,
        room: room.index,
        brief: brief.trim(),
        ticketIds: pickedTickets().map((t) => t.id),
        members: manualMembers,
      })
      if (closed) return
      step = 'proposal'
      adjusting = false
    } catch (err) {
      if (closed) return
      error = cleanError(err)
      step = 'error'
    }
    paint()
  }

  const adjust = async () => {
    if (!proposal || !adjustment.trim()) return
    step = 'loading'
    error = ''
    paint()
    try {
      // The name the player edited goes with the adjustment: the new composition keeps
      // it.
      await persistName()
      proposal = await window.office.adjustSquadProposal(proposal.id, adjustment.trim(), name.trim() || undefined)
      if (closed) return
      step = 'proposal'
      adjusting = false
      adjustment = ''
    } catch (err) {
      if (closed) return
      error = cleanError(err)
      step = 'proposal'
    }
    paint()
  }

  const approve = async () => {
    if (!proposal || !name.trim()) return
    try {
      // A aprovação cria o squad; ela não roda ciclo nenhum. O squad aparece na sala
      // e no catálogo do popup de squads que já existia (o da sala com squad): é
      // lá que o ciclo começa, quando a pessoa quiser.
      const squad = await window.office.approveSquadProposal(proposal.id, name.trim())
      if (closed) return
      close(false)
      const queue = await window.office.squadQueue(squad.code).catch(() => undefined)
      const active = queue?.active ? state.tickets.get(queue.active) : undefined
      const chosen = pickedTickets()
      toast(
        `${squad.name} criado em ${roomName}.` +
          (active
            ? ` ${active.key} ficou ativo. Tickets bloqueados permanecem na fila e serão pulados até haver PR confirmado.`
            : chosen.length
              ? ' Todos os tickets escolhidos estão bloqueados; o squad aguarda um PR confirmado.'
              : ' Sem ticket ativo: o squad fica disponível.'),
        'ok',
      )
      opts.onApproved?.(squad)
    } catch (err) {
      if (closed) return
      error = cleanError(err)
      paint()
    }
  }

  /** The window, step by step. */
  function paint(): void {
    const subtitle =
      step === 'proposal'
        ? `Sala: ${roomName}. A proposta só vira squad quando você aprovar.`
        : `Sala: ${roomName}. Sem squad atribuído: luz apagada e computadores desligados.`
    const parts: (HTMLElement | null)[] = [h('div', { class: 'modal-sub' }, subtitle)]
    let buttons: HTMLElement[]

    if (step === 'brief') {
      const area = h('textarea', {
        id: 'cs-brief',
        class: 'input',
        rows: 4,
        placeholder: 'O que esta equipe deve fazer? Ex.: refazer a página de busca da loja, com filtros e testes.',
      }) as HTMLTextAreaElement
      area.value = brief
      const go = h('button', { class: 'btn btn-primary', type: 'button' }, 'Propor composição') as HTMLButtonElement
      const sync = () => {
        brief = area.value
        go.disabled = !brief.trim() || manualMembers.some((member) => !member.competencyProfileId)
      }
      area.addEventListener('input', sync)
      go.addEventListener('click', () => void propose())
      sync()
      const memberFields = manualMembers.map((member, index) => {
        const memberName = h('input', { class: 'input', maxlength: '80', value: member.name }) as HTMLInputElement
        const focusArea = h('textarea', { class: 'input', rows: 2, maxlength: '1000' }) as HTMLTextAreaElement
        focusArea.value = member.focus
        const specialty = h(
          'select',
          { class: 'input' },
          h('option', { value: '' }, 'Escolha uma especialidade local'),
          ...competencyProfiles.map((profile) => h('option', { value: profile.id }, profile.label)),
        ) as HTMLSelectElement
        specialty.value = member.competencyProfileId ?? ''
        const getSelectedProfile = () => competencyProfiles.find((profile) => profile.id === specialty.value)
        const selectedProfile = getSelectedProfile()
        const specialtyHint = h(
          'div',
          { class: 'hint' },
          selectedProfile
            ? `${selectedProfile.identity} ${selectedProfile.scope}`
            : 'A especialidade refina o papel; não concede ferramentas, acesso, modelo nem conta.',
        )
        const model = h(
          'select',
          { class: 'input' },
          ...SQUAD_MODELS.map((value) => h('option', { value }, value || 'Padrão Claude Code')),
        ) as HTMLSelectElement
        model.value = member.model
        const account = h(
          'select',
          { class: 'input' },
          h('option', { value: '' }, 'Conta do projeto'),
          ...state.settings.accounts.map((item) => h('option', { value: item.name }, item.name)),
        ) as HTMLSelectElement
        account.value = member.account
        memberName.addEventListener('input', () => {
          member.name = memberName.value
        })
        focusArea.addEventListener('input', () => {
          member.focus = focusArea.value
        })
        specialty.addEventListener('change', () => {
          member.competencyProfileId = specialty.value
            ? (specialty.value as NonNullable<SquadProposalMember['competencyProfileId']>)
            : undefined
          const profile = getSelectedProfile()
          specialtyHint.textContent = profile
            ? `${profile.identity} ${profile.scope}`
            : 'A especialidade refina o papel; não concede ferramentas, acesso, modelo nem conta.'
          sync()
        })
        model.addEventListener('change', () => {
          member.model = model.value
        })
        account.addEventListener('change', () => {
          member.account = account.value
        })
        return h(
          'div',
          { class: 'panelbox' },
          h('div', { class: 'sec-title' }, member.role === 'implementer' ? 'Implementador' : 'Revisor independente'),
          h('label', { class: 'field-label' }, 'Nome'),
          memberName,
          h('label', { class: 'field-label' }, 'Especialidade local'),
          specialty,
          specialtyHint,
          h('label', { class: 'field-label' }, 'Responsabilidade'),
          focusArea,
          h(
            'div',
            { class: 'form-row' },
            h('label', { class: 'grow' }, 'Modelo Claude', model),
            h('label', { class: 'grow' }, 'Conta fixa', account),
          ),
          index === 1
            ? h(
                'div',
                { class: 'hint' },
                'O revisor é uma pessoa diferente do implementador; ele reporta achados e não altera o código revisado.',
              )
            : null,
        )
      })
      const list = h('div', { class: 'cs-tickets' })
      for (const t of tickets) {
        const box = h('input', { type: 'checkbox' }) as HTMLInputElement
        box.checked = picked.has(t.id)
        box.addEventListener('change', () => {
          if (box.checked) picked.add(t.id)
          else picked.delete(t.id)
        })
        const blockers = unresolvedBlockerIds(t, [...state.tickets.values()])
        list.append(
          h(
            'label',
            { class: 'rev-check' },
            box,
            h(
              'span',
              {},
              h('b', {}, `${t.key} · `),
              t.title,
              blockers.length
                ? h(
                    'span',
                    { class: 'cs-ticket-blocked' },
                    `Bloqueado por ${blockers.map((id) => state.tickets.get(id)?.key ?? id).join(', ')}`,
                  )
                : null,
            ),
          ),
        )
      }
      parts.push(
        h(
          'div',
          { class: 'panelbox' },
          h(
            'div',
            { class: 'cs-label' },
            h('label', { for: 'cs-brief', class: 'sec-title grow' }, 'Brief'),
            h('span', { class: 'sbadge sb-info' }, 'obrigatório'),
          ),
          area,
        ),
        h(
          'div',
          { class: 'panelbox' },
          h('div', { class: 'sec-title' }, 'Equipe Claude sob medida'),
          h(
            'div',
            { class: 'hint' },
            'Escolha um perfil local para cada papel. O perfil refina as instruções, mas não concede ferramentas, acesso ou permissões. Não há geração automática nem troca silenciosa de conta/modelo.',
          ),
          ...memberFields,
        ),
        h(
          'div',
          { class: 'panelbox' },
          h('div', { class: 'sec-title' }, 'Tickets (opcional)'),
          h(
            'div',
            { class: 'hint' },
            'Tickets bloqueados continuam selecionáveis e na fila. O squad ativa o próximo ticket sem bloqueios; se todos estiverem bloqueados, aguarda o PR dos bloqueadores.',
          ),
          list.children.length ? list : h('span', { class: 'hint' }, 'Nenhum ticket pendente neste andar.'),
        ),
      )
      buttons = [
        h('span', { class: 'hint grow' }, 'Cada proposta cria no máximo um squad, para esta sala. Nada é criado antes da sua aprovação.'),
        h('button', { class: 'btn', type: 'button', onclick: () => close(true) }, 'Cancelar'),
        go,
      ]
      focus = area
    } else if (step === 'loading') {
      parts.push(
        h(
          'div',
          { class: 'panelbox', role: 'status', 'aria-live': 'polite' },
          h(
            'div',
            { class: 'cs-loading' },
            h('span', { class: 'cs-spin', 'aria-hidden': 'true' }),
            h('b', {}, 'Validando equipe e tickets aprovados…'),
          ),
          h('div', { class: 'hint' }, 'Você pode cancelar a qualquer momento: nada é criado enquanto a proposta não for aprovada.'),
        ),
        echo(),
      )
      buttons = [
        h('span', { class: 'hint grow' }, 'A sala não muda durante a geração.'),
        h('button', { class: 'btn', type: 'button', onclick: () => close(true) }, 'Cancelar'),
      ]
    } else if (step === 'error') {
      parts.push(
        h(
          'div',
          { class: 'panelbox red' },
          h('div', { class: 'sec-title' }, 'Não foi possível preparar a proposta'),
          h('div', {}, error || 'Revise os dados e tente novamente.'),
          h('div', { class: 'hint' }, 'Seu brief e os tickets escolhidos foram preservados.'),
        ),
        echo(),
      )
      buttons = [
        h('span', { class: 'hint grow' }, 'Nada foi criado.'),
        h('button', { class: 'btn', type: 'button', onclick: () => close(true) }, 'Cancelar'),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => void propose() }, 'Tentar novamente'),
      ]
    } else {
      const composition = proposal?.composition
      const members: SquadProposalMember[] = composition?.members ?? []
      const chosen = pickedTickets()
      const nameInput = h('input', { id: 'cs-name', class: 'input', type: 'text', maxlength: '60' }) as HTMLInputElement
      nameInput.value = name
      const approveButton = h('button', { class: 'btn btn-primary', type: 'button' }, 'Aprovar e criar squad') as HTMLButtonElement
      const syncName = () => {
        name = nameInput.value
        approveButton.disabled = !name.trim()
      }
      nameInput.addEventListener('input', syncName)
      // When the field loses the focus the name goes into the proposal: it survives
      // the adjustments and the closing of the window.
      nameInput.addEventListener('change', () => {
        syncName()
        void persistName()
      })
      approveButton.addEventListener('click', () => void approve())
      syncName()
      const allTickets = [...state.tickets.values()]
      const firstReady = chosen.find((ticket) => !isTicketBlocked(ticket, allTickets))
      const waiting = chosen.filter((ticket) => ticket.id !== firstReady?.id)
      const attribution = !chosen.length
        ? ticketAttribution(chosen)
        : firstReady
          ? `${firstReady.key} fica ativo; ${waiting.length ? `${waiting.map((ticket) => ticket.key).join(', ')} ficam na fila e os bloqueados serão pulados até haver PR confirmado.` : 'sem outros tickets na fila.'}`
          : `Todos os tickets escolhidos estão bloqueados (${chosen.map((ticket) => ticket.key).join(', ')}). O squad aguarda e não inicia nenhum até haver PR confirmado.`
      // The field of the adjustment and its button are built together: the button wakes
      // up with the text of the field.
      const adjArea = h('textarea', {
        id: 'cs-adj',
        class: 'input',
        rows: 2,
        placeholder: 'Ex.: incluir mais um testador e trocar o redator.',
      }) as HTMLTextAreaElement
      adjArea.value = adjustment
      const send = h('button', { class: 'btn btn-primary', type: 'button' }, 'Enviar ajustes') as HTMLButtonElement
      send.disabled = !adjustment.trim()
      adjArea.addEventListener('input', () => {
        adjustment = adjArea.value
        send.disabled = !adjustment.trim()
      })
      parts.push(
        h(
          'div',
          { class: 'cs-chips' },
          h('span', { class: 'sbadge sb-waiting' }, 'Equipe proposta'),
          h('span', { class: 'sbadge sb-mute' }, roomName),
          h('span', { class: 'hint' }, 'Somente leitura. Nada foi criado ainda.'),
        ),
        error
          ? h('div', { class: 'panelbox red' }, h('div', { class: 'sec-title' }, 'Não foi possível criar o squad'), h('div', {}, error))
          : null,
        h(
          'div',
          { class: 'panelbox' },
          h('label', { for: 'cs-name', class: 'sec-title' }, 'Nome do squad (editável antes de aprovar)'),
          nameInput,
          h(
            'div',
            { class: 'hint' },
            `${members.length} ${members.length > 1 ? 'membros' : 'membro'}: uma mesa para cada integrante, na ordem abaixo. Coordenador é opcional.`,
          ),
          h(
            'div',
            { class: 'cs-members' },
            ...members.map((m) =>
              memberCard(m.name, SQUAD_ROLE_LABELS[m.role], memberEngineLine(m), m.competencyProfile?.label, m.competencyProfile?.scope),
            ),
          ),
        ),
        echo(),
        h('div', { class: 'hint' }, attribution),
        adjusting ? h('div', { class: 'panelbox' }, h('label', { for: 'cs-adj', class: 'sec-title' }, 'O que ajustar?'), adjArea) : null,
      )
      if (adjusting) {
        send.addEventListener('click', () => void adjust())
        buttons = [
          h('span', { class: 'hint grow' }, 'A IA refaz a proposta com o seu pedido. Você revisa de novo antes de aprovar.'),
          h(
            'button',
            {
              class: 'btn',
              type: 'button',
              onclick: () => {
                adjusting = false
                paint()
              },
            },
            'Voltar à proposta',
          ),
          send,
        ]
      } else {
        buttons = [
          h('span', { class: 'hint grow' }, 'A sala mostra só o contorno âmbar até você aprovar.'),
          h('button', { class: 'btn', type: 'button', onclick: () => close(true) }, 'Cancelar'),
          approveButton,
        ]
      }
      focus = adjusting ? adjArea : approveButton
    }

    body.replaceChildren(...parts.filter((p): p is HTMLElement => p instanceof HTMLElement))
    foot.replaceChildren(...buttons)
    if (focus) focus.focus()
  }

  root.append(el)
  paint()
}
