import type { TelegramView } from '@shared/telegram'
import { h } from './dom'
import { cleanError, field } from './modals/common'
import type { Toast } from './tasks-complete'

// AO-84: seção "Telegram" dos ajustes da Luna. Mesmos componentes das outras seções (título .bridge-title, .field, .field-hint,
// .check, .input, .btn). O token só sai da tela para o processo principal; o que volta é "configurado: sim/não".

const STATUS_TEXT: Record<TelegramView['status'], string> = {
  off: 'Desligado',
  connecting: 'Conectando…',
  connected: 'Conectado',
  error: 'Erro',
}

/** O texto do indicador de estado. Puro, para os testes. */
export function telegramStatusText(view: Pick<TelegramView, 'status' | 'reason'>): string {
  return view.status === 'error' && view.reason ? `${STATUS_TEXT.error}: ${view.reason}` : STATUS_TEXT[view.status]
}

export function telegramSection(toast: Toast): { el: HTMLElement; dispose(): void } {
  const token = h('input', {
    class: 'input',
    type: 'password',
    autocomplete: 'off',
    spellcheck: 'false',
    maxlength: '200',
    placeholder: 'Cole o token do bot',
  }) as HTMLInputElement
  const chatId = h('input', {
    class: 'input',
    type: 'text',
    inputmode: 'numeric',
    autocomplete: 'off',
    maxlength: '20',
    placeholder: 'Ex.: 123456789',
  }) as HTMLInputElement
  const enabled = h('input', { type: 'checkbox' }) as HTMLInputElement
  const state = h('span', { class: 'field-hint', role: 'status', 'aria-live': 'polite' }, 'Lendo o estado…')
  const tokenHint = h('span', {}, 'Criado no @BotFather. Fica guardado criptografado e nunca é mostrado de novo.')
  const apply = h('button', { class: 'btn', type: 'button', onclick: () => void save() }, 'Salvar e aplicar Telegram') as HTMLButtonElement
  let saving = false

  const show = (view: TelegramView) => {
    const bad = view.status === 'error'
    state.replaceChildren(
      'Estado: ',
      h('span', { class: bad ? 'warn' : '' }, telegramStatusText(view)),
      view.storageAvailable ? '' : ' · este computador não oferece armazenamento criptografado',
    )
    tokenHint.textContent = view.tokenConfigured
      ? 'Token configurado: sim. Deixe em branco para manter; cole outro para trocar.'
      : 'Token configurado: não. Criado no @BotFather; fica guardado criptografado e nunca é mostrado de novo.'
  }
  const fill = (view: TelegramView) => {
    enabled.checked = view.enabled
    chatId.value = view.chatId
    token.value = ''
    show(view)
  }

  const save = async () => {
    if (saving) return
    saving = true
    apply.disabled = true
    try {
      const view = await window.office.saveTelegram({ token: token.value, chatId: chatId.value, enabled: enabled.checked })
      token.value = ''
      show(view)
      toast(view.enabled ? 'Telegram aplicado.' : 'Telegram desligado.', 'ok')
    } catch (err) {
      toast(cleanError(err), 'err')
    } finally {
      saving = false
      apply.disabled = false
    }
  }

  window.office.telegramState().then(fill, (err) => state.replaceChildren(cleanError(err)))
  const stop = window.office.onEvent((e) => {
    if (e.type === 'telegram') show(e.view)
  })

  const el = h(
    'section',
    { 'aria-label': 'Telegram' },
    h('div', { class: 'bridge-title' }, 'Telegram'),
    h(
      'p',
      { class: 'field-hint' },
      'Converse com a Luna pelo celular. Crie um bot com o @BotFather (comando /newbot) e copie o token. Para achar o seu chat_id, mande uma mensagem ao bot e abra https://api.telegram.org/bot<token>/getUpdates: o número em "chat" › "id". Só esse chat é atendido. Ações que pedem permissão continuam sendo aprovadas aqui no Agent Office.',
    ),
    field('Token do bot', token, tokenHint),
    field('chat_id permitido', chatId, 'Número da sua conversa privada com o bot. Mensagens de qualquer outro chat são ignoradas.'),
    h('label', { class: 'check' }, enabled, 'Ligar o Telegram'),
    state,
    apply,
  )
  return { el, dispose: stop }
}
