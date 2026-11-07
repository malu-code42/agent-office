import type { IrisPreview, IrisResult } from '@shared/iris'
import type { AgentStatus, AttachmentInput, LogEntry } from '@shared/types'
import { profileById, type ProfileId } from '@shared/profiles'
import { isAudioFile } from '@shared/audio'
import type { AudioDisposition } from './audio-capture'

export interface LunaDesk {
  prepare(vault: string, request: string, captureId?: string, channelRules?: string): IrisPreview
  send(token: string): Promise<IrisResult>
  cancel(token: string): void
}

export interface LunaChatHost {
  log(kind: LogEntry['kind'], text: string): void
  status(status: AgentStatus, activity: string): void
  startProfileTask(profile: ProfileId, request: string): Promise<void>
  openMediaDraft(draft: Extract<IrisResult, { kind: 'media-draft' }>['draft']): void
  transcribeAudio(attachment: AttachmentInput, caption: string): Promise<void>
}

/** Routes normal Luna chat through locally prepared context and sends it to Claude without an intermediate approval. */
export class LunaChat {
  private readonly queue: {
    request: string
    attachments: AttachmentInput[]
    resolve: (disposition: AudioDisposition) => void
  }[] = []
  private running = false

  constructor(
    private readonly desk: LunaDesk,
    private readonly host: LunaChatHost,
    private readonly vault: () => string,
  ) {}

  send(request: string, attachments: AttachmentInput[] = []): Promise<void> {
    const done = new Promise<AudioDisposition>((resolve) => this.queue.push({ request, attachments, resolve }))
    if (!this.running) this.host.status('working', 'Preparando seu pedido')
    void this.drain()
    return done.then((disposition) => {
      if (disposition !== 'complete') throw new Error('A Luna não conseguiu concluir esse pedido. Tente novamente.')
    })
  }

  /**
   * AO-84: a request that came through Telegram. Same desk as the window chat (the same context, the same Claude call, the same
   * pending proposal that only the app confirms), plus the channel rules in the prompt. Nothing is started or opened here:
   * a suggested profile task or a media draft only becomes a pointer to the app. Returns the text for the user and whether a
   * card/proposal is now waiting in the app.
   */
  async askRemote(request: string, channelRules: string): Promise<{ text: string; needsAppCard: boolean }> {
    let preview: IrisPreview | undefined
    try {
      this.host.log('user', `Telegram: ${request}`)
      preview = this.desk.prepare(this.vault(), request, undefined, channelRules)
      const result = await this.desk.send(preview.token)
      const turn = describeRemote(result)
      this.host.log('assistant', turn.text)
      return turn
    } catch (error) {
      if (preview) this.desk.cancel(preview.token)
      throw error
    }
  }

  /** Direct subflow used by an approved audio group; bypasses the current chat queue item that invoked it. */
  async sendDirect(request: string, captureId: string): Promise<boolean> {
    this.host.log('user', request)
    this.host.status('working', 'Preparando o trecho aprovado')
    return this.handle(request, [], captureId)
  }

  private async drain(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      while (this.queue.length) {
        const next = this.queue.shift()!
        let disposition: AudioDisposition = 'complete'
        try {
          disposition = (await this.handle(next.request, next.attachments)) ? 'complete' : 'pending'
        } catch (error) {
          disposition = 'retry'
          this.host.log('error', error instanceof Error ? error.message : 'Não consegui processar essa mensagem localmente.')
        } finally {
          next.resolve(disposition)
        }
      }
    } finally {
      this.running = false
      this.host.status('idle', 'Pronta para ajudar')
    }
  }

  private async handle(request: string, attachments: AttachmentInput[], captureId?: string): Promise<boolean> {
    if (attachments.length) {
      if (attachments.length !== 1 || !isAudioFile(attachments[0]!.name, attachments[0]!.mime)) {
        this.host.log('error', 'A Luna aceita somente um anexo de áudio por vez.')
        return false
      }
      try {
        await this.host.transcribeAudio(attachments[0]!, request)
      } catch (error) {
        this.host.log('error', error instanceof Error ? error.message : 'Não consegui processar esse áudio localmente.')
        return false
      }
      return true
    }
    let preview: IrisPreview | undefined
    try {
      preview = this.desk.prepare(this.vault(), request, captureId)
      this.host.status('working', 'A Luna está pensando…')
      await this.present(await this.desk.send(preview.token), request)
      return true
    } catch (error) {
      if (preview) this.desk.cancel(preview.token)
      this.host.log('error', error instanceof Error ? error.message : 'Não consegui concluir esse pedido.')
      return false
    }
  }

  private async present(result: IrisResult, request: string): Promise<void> {
    switch (result.kind) {
      case 'question':
        this.host.log('assistant', result.text)
        return
      case 'proposal':
        this.host.log(
          'assistant',
          result.profile
            ? `A proposta está pronta para sua revisão na caixa de entrada. A Luna também sugere o perfil ${profileById(result.profile)?.name ?? result.profile} para uma tarefa separada.`
            : 'A proposta está pronta para sua revisão na caixa de entrada. Nada foi alterado ainda.',
        )
        return
      case 'task':
        this.host.log('assistant', `Vou preparar uma conversa nova com o perfil ${profileById(result.profile)?.name ?? result.profile}.`)
        await this.host.startProfileTask(result.profile, request)
        return
      case 'media-draft':
        this.host.log('assistant', `Preparei um rascunho de ${result.draft.kind} para você revisar. Nada foi salvo ainda.`)
        this.host.openMediaDraft(result.draft)
    }
  }
}

/** What a Telegram user reads for each kind of answer. Only a proposal leaves something waiting in the app. */
function describeRemote(result: IrisResult): { text: string; needsAppCard: boolean } {
  switch (result.kind) {
    case 'question':
      return { text: result.text, needsAppCard: false }
    case 'proposal': {
      const n = result.proposal.operations.length
      return {
        text: `Preparei uma proposta com ${n} ${n === 1 ? 'operação' : 'operações'}. Nada foi alterado ainda.`,
        needsAppCard: true,
      }
    }
    case 'task':
      return {
        text: `A Luna sugere o perfil ${profileById(result.profile)?.name ?? result.profile} para uma tarefa separada. Abra o Agent Office para começar.`,
        needsAppCard: false,
      }
    case 'media-draft':
      return { text: `Preparei um rascunho de ${result.draft.kind}. Abra o Agent Office para revisar e salvar.`, needsAppCard: false }
  }
}
