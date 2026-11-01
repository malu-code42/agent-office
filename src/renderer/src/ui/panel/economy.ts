import { adviseAgent, type Advice } from '@shared/economy'
import type { AgentSummary, AttachmentInput } from '@shared/types'
import type { State } from '../../state'
import { h, icon } from '../dom'
import { adviceCopy, costLabel, warnTokens } from '../economy-text'
import { modal } from '../modals'

// Token economy in the agent panel: the warning under the badge and the question before
// waking a cold agent (upstream 70ae59f/f5a55b5). Same banner and confirm styles as the rest.

/** The warning under the badge, with the recommended action first. */
export function adviceBanner(a: AgentSummary, advice: Advice, act: { clear(): void; compact(): void }): HTMLElement[] {
  const copy = adviceCopy(advice)
  return [
    h(
      'div',
      { class: 'advice-main' },
      icon(advice.kind === 'cold' ? 'alert' : 'coin', 15),
      h('div', { class: 'advice-text' }, h('b', {}, copy.title), h('span', {}, copy.detail)),
    ),
    h(
      'div',
      { class: 'advice-actions' },
      h(
        'button',
        {
          class: 'btn btn-small',
          title: `${a.name} esquece esta conversa e a próxima mensagem começa do zero (/clear).`,
          onclick: act.clear,
        },
        icon('reset', 13),
        'Limpar',
      ),
      // Compacting a cold agent reads the whole conversation too: only worth it while warm.
      advice.kind === 'big'
        ? h(
            'button',
            {
              class: 'btn btn-small',
              title: 'Resume a conversa até aqui (/compact). Custa uma chamada, depois cada chamada fica mais barata.',
              onclick: act.compact,
            },
            icon('compact', 13),
            'Compactar',
          )
        : null,
    ),
  ]
}

export type ColdChoice = 'clear' | 'send' | 'cancel'

/** Before a message wakes a cold agent: clear first (cheap), send anyway, or cancel. */
export function askCold(root: HTMLElement, a: AgentSummary, advice: Extract<Advice, { kind: 'cold' }>): Promise<ColdChoice> {
  return new Promise((resolve) => {
    let done = false
    const finish = (v: ColdChoice) => {
      if (done) return
      done = true
      el.remove()
      resolve(v)
    }
    const copy = adviceCopy(advice)
    const clear = h('button', { class: 'btn btn-primary', onclick: () => finish('clear') }, icon('reset', 15), 'Limpar e enviar')
    const el = modal(
      `${a.name} está com a memória fria`,
      [
        h('div', { class: 'confirm-warn' }, icon('coin', 16), h('span', {}, copy.title)),
        h(
          'div',
          { class: 'confirm-text' },
          `${copy.detail}\n\nSe a mensagem continua a mesma tarefa, envie assim mesmo. O histórico limpo continua na Central de resume.`,
        ),
        h('div', { class: 'field-hint' }, 'Desligue esta pergunta em Configurações › Economia de tokens.'),
      ],
      [
        h('button', { class: 'btn', onclick: () => finish('cancel') }, 'Cancelar'),
        h('button', { class: 'btn', onclick: () => finish('send') }, `Enviar assim mesmo (~${costLabel(advice.usd)})`),
        clear,
      ],
      () => finish('cancel'),
    )
    el.classList.add('backdrop-confirm')
    root.append(el)
    clear.focus()
  })
}

/**
 * Sends a message to an office agent. A cold one with a big conversation asks first: clear and
 * send, send anyway or cancel. False when cancelled. `attachments` is read only once the message
 * goes; `cleared` runs after a clear, so the panel can restart its view at the cut.
 */
export async function sendChecked(
  root: HTMLElement,
  state: State,
  agentId: string,
  text: string,
  attachments?: () => Promise<AttachmentInput[]>,
  cleared?: () => void,
): Promise<boolean> {
  const a = state.agents.get(agentId)
  const advice = a && state.settings.coldConfirm !== false ? adviseAgent(a, warnTokens(state.settings)) : null
  if (a && advice?.kind === 'cold') {
    const choice = await askCold(root, a, advice)
    if (choice === 'cancel') return false
    if (choice === 'clear') {
      await window.office.clearContext(agentId)
      cleared?.()
    }
  }
  await window.office.send(agentId, text, attachments ? await attachments() : [])
  return true
}
