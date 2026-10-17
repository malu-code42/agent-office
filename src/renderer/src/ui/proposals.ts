import { describeProposal } from '@shared/proposals'
import type { ProposalReview } from '@shared/types'
import { h } from './dom'
import { cleanError, modal } from './modals/common'

type Toast = (text: string, kind?: 'info' | 'ok' | 'err') => void

/**
 * The review of a proposal (AO-10): its exact operations, read from the files now. Nothing is written until
 * "Aplicar", which applies all of them or none. Esc and "Fechar" leave it pending. "Recusar" takes it off the
 * list and changes no file. A confirmation that stopped is reopened, so the failure shows on the proposal.
 */
export async function openProposalReview(root: HTMLElement, toast: Toast, id: string): Promise<void> {
  let review: ProposalReview
  try {
    review = await window.office.openProposal(id)
  } catch (err) {
    toast(cleanError(err), 'err')
    return
  }
  const { proposal, titles } = review
  const ops = describeProposal(proposal, (task) => titles[task.toLowerCase()])
  const count = `${ops.length} ${ops.length === 1 ? 'operação' : 'operações'}`

  const body: HTMLElement[] = [
    h('p', { class: 'hint' }, 'Nada muda até você confirmar. Estas são todas as operações, na ordem em que rodam:'),
    h('ol', { class: 'proposal-ops' }, ...ops.map((text) => h('li', {}, text))),
  ]
  if (proposal.failure)
    body.push(h('div', { class: 'field-hint', role: 'alert' }, `Falhou na última tentativa: ${proposal.failure.message}`))
  if (!review.agendaFound && proposal.operations.some((op) => op.kind === 'move-commitment')) {
    body.push(
      h(
        'div',
        { class: 'field-hint', role: 'alert' },
        'Não encontrei o agenda.md no vault, então os compromissos desta proposta não podem ser aplicados.',
      ),
    )
  }

  const close = () => el.remove()
  const applyBtn = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => void apply() }, `Aplicar ${count}`)
  const apply = async () => {
    applyBtn.setAttribute('disabled', '')
    try {
      await window.office.applyProposal(id)
      toast('Proposta aplicada.', 'ok')
      close()
    } catch (err) {
      toast(cleanError(err), 'err')
      close()
      void openProposalReview(root, toast, id)
    }
  }
  const refuse = async () => {
    try {
      await window.office.rejectProposal(id)
      toast('Proposta recusada. Nenhum arquivo foi alterado.', 'info')
      close()
    } catch (err) {
      toast(cleanError(err), 'err')
    }
  }
  const fechar = h('button', { class: 'btn', type: 'button', onclick: close }, 'Fechar')
  const el = modal(
    `Proposta: ${proposal.source}`,
    body,
    [
      fechar,
      h('button', { class: 'btn btn-danger-soft', type: 'button', onclick: () => void refuse() }, 'Recusar'),
      h('div', { class: 'grow' }),
      applyBtn,
    ],
    close,
  )
  root.append(el)
  fechar.focus()
}
