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

/** AO-112: o texto do passo de verificação. Puro, para os testes. */
export function telegramVerifyText(view: Pick<TelegramView, 'verified' | 'codePending' | 'tokenConfigured' | 'chatId'>): string {
  if (view.verified) return 'Chat verificado: sim.'
  if (!view.tokenConfigured || !view.chatId) return 'Chat verificado: não. Salve o token e o chat_id para poder pedir o código.'
  if (view.codePending) return 'Chat verificado: não. Enviei um código ao chat; digite os 6 números aqui (vale 5 minutos, 3 tentativas).'
  return 'Chat verificado: não. Peça um código: o bot o envia ao chat e a ponte só liga depois que você o digitar aqui.'
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
  // AO-112: verificação de posse do chat_id (mesmos componentes: .field, .input, .btn).
  const code = h('input', {
    class: 'input',
    type: 'text',
    inputmode: 'numeric',
    autocomplete: 'off',
    spellcheck: 'false',
    maxlength: '6',
    placeholder: '6 números',
    'aria-label': 'Código de verificação',
  }) as HTMLInputElement
  const verifyHint = h('span', {}, '')
  const askCode = h('button', { class: 'btn', type: 'button', onclick: () => void ask() }, 'Enviar código ao chat') as HTMLButtonElement
  const sendCode = h('button', { class: 'btn', type: 'button', onclick: () => void submit() }, 'Verificar código') as HTMLButtonElement
  const verifyRow = field('Verificação do chat', h('div', {}, code, askCode, sendCode), verifyHint)
  let saving = false
  let busy = false

  const show = (view: TelegramView) => {
    const bad = view.status === 'error'
    state.replaceChildren(
      'Estado: ',
      h('span', { class: bad ? 'warn' : '' }, telegramStatusText(view)),
      view.storageAvailable ? '' : ' · este computador não oferece armazenamento criptografado',
    )
    verifyHint.textContent = telegramVerifyText(view)
    verifyRow.hidden = view.verified
    askCode.disabled = !view.tokenConfigured || !view.chatId
    sendCode.disabled = !view.codePending
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
      if (view.enabled && !view.verified) toast('Salvo. Falta verificar o chat_id para a ponte ligar.', 'ok')
      else toast(view.enabled ? 'Telegram aplicado.' : 'Telegram desligado.', 'ok')
    } catch (err) {
      toast(cleanError(err), 'err')
    } finally {
      saving = false
      apply.disabled = false
    }
  }

  const verify = async (job: () => Promise<TelegramView>, done: string) => {
    if (busy) return
    busy = true
    askCode.disabled = sendCode.disabled = true
    try {
      show(await job())
      code.value = ''
      toast(done, 'ok')
    } catch (err) {
      toast(cleanError(err), 'err')
      void window.office.telegramState().then(show, () => undefined)
    } finally {
      busy = false
    }
  }
  const ask = () => verify(() => window.office.requestTelegramCode(), 'Código enviado ao chat do Telegram.')
  const submit = () => verify(() => window.office.submitTelegramCode(code.value), 'Chat verificado.')

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
    verifyRow,
  )
  return { el, dispose: stop }
}
