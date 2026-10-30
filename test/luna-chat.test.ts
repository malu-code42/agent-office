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
  const host = {
    log: vi.fn(),
    status: vi.fn(),
    startProfileTask: vi.fn(async () => undefined),
    openMediaDraft: vi.fn(),
    transcribeAudio: vi.fn(async () => undefined),
  }
  const chat = new LunaChat(desk, host, () => 'C:/vault')
  return { chat, desk, host }
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
    const { chat, desk, host } = setup()
    const captureId = 'a'.repeat(64)
    const pending = chat.sendDirect('Trecho aprovado para agenda: Dentista às 16', captureId)
    expect(host.log).toHaveBeenCalledWith('user', 'Trecho aprovado para agenda: Dentista às 16')
    expect(desk.prepare).toHaveBeenCalledWith('C:/vault', 'Trecho aprovado para agenda: Dentista às 16', captureId)
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
    await expect(chat.send('', [document])).rejects.toThrow('A Luna não conseguiu concluir esse pedido. Tente novamente.')

    expect(host.transcribeAudio).not.toHaveBeenCalled()
    expect(host.log).toHaveBeenCalledWith('error', 'A Luna aceita somente um anexo de áudio por vez.')
    expect(desk.prepare).not.toHaveBeenCalled()
  })

  it('envia o contexto local preparado ao Claude sem uma aprovação intermediária', async () => {
    const { chat, desk, host } = setup()
    await chat.send('Organize minhas tarefas')
    expect(desk.prepare).toHaveBeenCalledWith('C:/vault', 'Organize minhas tarefas', undefined)
    expect(desk.send).toHaveBeenCalledWith('preview-1')
    expect(host.log).toHaveBeenCalledWith('assistant', 'Qual lista?')
  })

  it('rejeita o envio quando a Luna não consegue responder, permitindo manter a mensagem para nova tentativa', async () => {
    const { chat, desk, host } = setup()
    desk.send.mockRejectedValueOnce(new Error('A Luna demorou para responder. Tente de novo.'))
    await expect(chat.send('Tente de novo')).rejects.toThrow('A Luna não conseguiu concluir esse pedido. Tente novamente.')
    expect(host.log).toHaveBeenCalledWith('error', 'A Luna demorou para responder. Tente de novo.')
  })

  it('entrega propostas, sugestões de perfil e rascunhos pelos callbacks próprios', async () => {
    const profile = setup({ kind: 'task', profile: 'escrita' })
    await profile.chat.send('Revise este texto')
    expect(profile.host.startProfileTask).toHaveBeenCalledWith('escrita', 'Revise este texto')

    const media = setup({ kind: 'media-draft', draft: { kind: 'livro', title: 'Livro sintético' } })
    await media.chat.send('Adicione este livro')
    expect(media.host.openMediaDraft).toHaveBeenCalledWith({ kind: 'livro', title: 'Livro sintético' })
  })

  it('serializa mensagens para não sobrescrever a prévia pendente', async () => {
    const { chat, desk } = setup()
    const first = chat.send('Primeiro pedido')
    const second = chat.send('Segundo pedido')
    expect(desk.prepare).toHaveBeenCalledTimes(1)
    await first
    await vi.waitFor(() => expect(desk.prepare).toHaveBeenCalledTimes(2))
    await second
  })
})
