/** Modo voz: o único acesso do Chromium que o app libera é o microfone, para a própria página. */
export interface MediaRequest {
  permission: string
  /** Página que pediu (requestingUrl ou securityOrigin). */
  url: string
  /** Tipos pedidos: 'audio', 'video'. Vazio quando o Electron não informa. */
  mediaTypes: readonly string[]
}

/**
 * Só `media` com áudio e sem vídeo, e só da página do próprio app (o bundle em file://
 * ou o servidor de desenvolvimento). Qualquer outra origem, como o iframe do rádio, é negada.
 */
export function allowMicrophone(req: MediaRequest, devUrl = process.env.ELECTRON_RENDERER_URL): boolean {
  if (req.permission !== 'media') return false
  if (req.mediaTypes.length === 0 || req.mediaTypes.some((t) => t !== 'audio')) return false
  return isOwnPage(req.url, devUrl)
}

function isOwnPage(url: string, devUrl?: string): boolean {
  let page: URL
  try {
    page = new URL(url)
  } catch {
    return false
  }
  if (devUrl) {
    try {
      return page.origin === new URL(devUrl).origin && page.origin !== 'null'
    } catch {
      return false
    }
  }
  return page.protocol === 'file:'
}
