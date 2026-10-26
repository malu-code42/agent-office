import { describe, expect, it, vi } from 'vitest'
import type { AttachmentInput } from '../src/shared/types'
import type { IrisPreview, IrisResult } from '../src/shared/iris'
import { LunaChat } from '../src/main/luna-chat'

function setup(result: IrisResult = { kind: 'question', text: 'Qual lista?' }) {
  const desk = {
    prepare: vi.fn((_vault: string, _request: string): IrisPreview => ({ token: 'preview-1', context: 'Contexto exato' })),
    send: vi.fn(async (_token: string) => result),
    cancel: vi.fn(),
  }
  let allow: ((yes: boolean) => void) | undefined
  const host = {
    confirmContext: vi.fn(() => new Promise<boolean>((resolve) => (allow = resolve))),
    log: vi.fn(),
    status: vi.fn(),
    startProfileTask: vi.fn(async () => undefined),
    openMediaDraft: vi.fn(),
    transcribeAudio: vi.fn(async () => undefined),
  }
  const chat = new LunaChat(desk, host, () => 'C:/vault')
  return { chat, desk, host, decide: (yes: boolean) => allow?.(yes) }
}

describe('LunaChat', () => {
  it('devolve o resultado do processamento de áudio para que Telegram mantenha pendências', async () => {
    const { chat, desk, host } = setup()
    const processed = await chat.enqueueTelegramAudio(async () => 'pending')

    expect(processed).toBe('pending')
    expect(host.log).toHaveBeenCalledWith('user', 'Áudio recebido pelo Telegram para transcrição local.')
    expect(desk.prepare).not.toHaveBeenCalled()
  })

  it('envia grupo encaminhado pela captura direto ao fluxo comum com chave idempotente', async () => {
    const { chat, desk, host, decide } = setup()
    const captureId = 'a'.repeat(64)
    const pending = chat.sendDirect('Trecho aprovado para agenda: Dentista às 16', captureId)
    expect(host.log).toHaveBeenCalledWith('user', 'Trecho aprovado para agenda: Dentista às 16')
    expect(desk.prepare).toHaveBeenCalledWith('C:/vault', 'Trecho aprovado para agenda: Dentista às 16', captureId)
    decide(true)
    await expect(pending).resolves.toBe(true)
  })

  it('envia anexos de áudio somente ao transcritor local, sem passar por Iris/Claude', async () => {
    const { chat, desk, host } = setup()
    const audio: AttachmentInput = { name: 'sintetico.wav', mime: 'audio/wav', path: 'C:/synthetic/sintetico.wav' }
    await chat.send('Transcreva este áudio', [audio])

    expect(host.transcribeAudio).toHaveBeenCalledWith(audio, 'Transcreva este áudio')
    expect(desk.prepare).not.toHaveBeenCalled()
    expect(desk.send).not.toHaveBeenCalled()
  })

  it('recusa anexos não-audio do agente built-in sem invocar nenhum interpretador', async () => {
    const { chat, desk, host } = setup()
    const document: AttachmentInput = { name: 'nota.txt', mime: 'text/plain', path: 'C:/synthetic/nota.txt' }
    await chat.send('', [document])

    expect(host.transcribeAudio).not.toHaveBeenCalled()
    expect(host.log).toHaveBeenCalledWith('error', 'A Luna aceita somente um anexo de áudio por vez.')
    expect(desk.prepare).not.toHaveBeenCalled()
  })

  it('exibe a prévia pelo fluxo de pergunta do agente e não envia antes da aprovação', async () => {
    const { chat, desk, host, decide } = setup()
    const pending = chat.send('Organize minhas tarefas')

    expect(desk.prepare).toHaveBeenCalledWith('C:/vault', 'Organize minhas tarefas', undefined)
    expect(host.confirmContext).toHaveBeenCalledWith({ token: 'preview-1', context: 'Contexto exato' })
    expect(desk.send).not.toHaveBeenCalled()

    decide(true)
    await pending
    expect(desk.send).toHaveBeenCalledWith('preview-1')
    expect(host.log).toHaveBeenCalledWith('assistant', 'Qual lista?')
  })

  it('cancela a prévia quando a usuária recusa o envio', async () => {
    const { chat, desk, host, decide } = setup()
    const pending = chat.send('Meu pedido')
    decide(false)
    await pending

    expect(desk.cancel).toHaveBeenCalledWith('preview-1')
    expect(desk.send).not.toHaveBeenCalled()
    expect(host.log).toHaveBeenCalledWith('assistant', 'Envio cancelado. Nenhum dado foi enviado.')
  })

  it('entrega propostas, sugestões de perfil e rascunhos pelos callbacks próprios', async () => {
    const profile = setup({ kind: 'task', profile: 'escrita' })
    const task = profile.chat.send('Revise este texto')
    profile.decide(true)
    await task
    expect(profile.host.startProfileTask).toHaveBeenCalledWith('escrita', 'Revise este texto')

    const media = setup({ kind: 'media-draft', draft: { kind: 'livro', title: 'Livro sintético' } })
    const mediaTask = media.chat.send('Adicione este livro')
    media.decide(true)
    await mediaTask
    expect(media.host.openMediaDraft).toHaveBeenCalledWith({ kind: 'livro', title: 'Livro sintético' })
  })

  it('serializa mensagens para não sobrescrever a prévia pendente', async () => {
    const { chat, desk, decide } = setup()
    const first = chat.send('Primeiro pedido')
    const second = chat.send('Segundo pedido')
    expect(desk.prepare).toHaveBeenCalledTimes(1)
    decide(true)
    await first
    await vi.waitFor(() => expect(desk.prepare).toHaveBeenCalledTimes(2))
    decide(true)
    await second
  })
})
