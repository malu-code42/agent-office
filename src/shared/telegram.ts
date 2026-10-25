export interface TelegramStatus {
  linked: boolean
  polling: boolean
  botName?: string
  authorizedUserId?: number
  warning?: string
}

export interface TelegramMessageNotice {
  text: string
  receivedAt: number
}

export interface TelegramExpiredNotice {
  receivedAt: number
}
