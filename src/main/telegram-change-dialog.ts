// AO-111: confirmação, no PROCESSO PRINCIPAL, de uma mudança de chat_id ou de token do Telegram. O diálogo é nativo
// (dialog.showMessageBox), então um renderer comprometido não consegue respondê-lo. O token nunca aparece aqui: só "será trocado".
// Fechar o diálogo (Esc, X) vale como Cancelar; sem janela ou com erro, também não confirma.

import { dialog, type BrowserWindow } from 'electron'
import type { TelegramChange } from './telegram-settings'

export function describeTelegramChange(change: TelegramChange): string {
  const lines: string[] = []
  if (change.chat) {
    lines.push(`chat_id: ${change.chat.from || '(nenhum)'} → ${change.chat.to || '(nenhum)'}`)
  }
  if (change.token) lines.push('Token do bot: será substituído por um novo (o valor não é mostrado).')
  lines.push(
    '',
    'A Luna passa a responder a esse chat. A ponte só liga depois que você digitar o código de verificação que o bot enviar a ele.',
  )
  return lines.join('\n')
}

export async function confirmTelegramChange(win: BrowserWindow | null, change: TelegramChange): Promise<boolean> {
  if (!win) return false
  try {
    const result = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['Confirmar mudança', 'Cancelar'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      message: 'Mudar o destino do Telegram da Luna?',
      detail: describeTelegramChange(change),
    })
    return result.response === 0
  } catch {
    return false
  }
}
