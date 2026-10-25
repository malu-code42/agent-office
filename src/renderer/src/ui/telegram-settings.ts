import type { TelegramStatus } from '@shared/telegram'
import { h, icon } from './dom'
import { cleanError } from './modals/common'

type Toast = (text: string, kind?: 'info' | 'ok' | 'err') => void

/** Token import uses the native picker; plaintext credentials never enter the renderer. */
export function telegramSettingsSection(toast: Toast): HTMLElement {
  const status = h('p', { class: 'field-hint', role: 'status' }, 'Verificando a vinculação do Telegram…')
  const link = h('button', { class: 'btn', type: 'button' }, icon('link', 14), 'Vincular bot')
  const unlink = h('button', { class: 'btn', type: 'button', hidden: true }, 'Desvincular')
  const refresh = h('button', { class: 'btn', type: 'button' }, 'Atualizar estado')

  const render = (value: TelegramStatus) => {
    status.textContent = value.linked
      ? `Vinculado a ${value.botName ? `@${value.botName}` : 'um bot'} · Telegram user ID ${value.authorizedUserId}${value.polling ? ' · recebendo enquanto o app está aberto' : ' · polling parado'}`
      : (value.warning ?? 'Nenhuma conta Telegram vinculada.')
    unlink.hidden = !value.linked
    link.hidden = value.linked
  }

  void window.office
    .telegramStatus()
    .then(render)
    .catch((error) => {
      status.textContent = cleanError(error)
    })
  refresh.onclick = async () => {
    refresh.disabled = true
    try {
      render(await window.office.telegramStatus())
    } catch (error) {
      status.textContent = cleanError(error)
    } finally {
      refresh.disabled = false
    }
  }
  link.onclick = async () => {
    link.disabled = true
    try {
      const value = await window.office.linkTelegram()
      if (value) {
        render(value)
        toast('Telegram vinculado. O app só recebe mensagens da conta autorizada.', 'ok')
      }
    } catch (error) {
      status.textContent = cleanError(error)
      toast(cleanError(error), 'err')
    } finally {
      link.disabled = false
    }
  }
  unlink.onclick = async () => {
    unlink.disabled = true
    try {
      if (await window.office.unlinkTelegram()) {
        render({ linked: false, polling: false })
        toast('Telegram desvinculado; o long polling foi parado.', 'ok')
      }
    } catch (error) {
      status.textContent = cleanError(error)
      toast(cleanError(error), 'err')
    } finally {
      unlink.disabled = false
    }
  }

  return h(
    'div',
    { class: 'bridge-box' },
    h('div', { class: 'bridge-title' }, icon('link', 16), 'Telegram local'),
    h(
      'div',
      { class: 'field-hint' },
      'Para vincular, escolha no diálogo do sistema um JSON fora do vault, por exemplo {"botToken":"123456:…","userId":123456789}. O token é lido pelo processo principal, validado e guardado criptografado; apague o arquivo de importação depois. O Office nunca grava o token no renderer, vault ou logs.',
    ),
    status,
    h('div', { class: 'bridge-row' }, link, unlink, refresh),
  )
}
