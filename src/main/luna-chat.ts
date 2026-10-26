import type { IrisPreview, IrisResult } from '@shared/iris'
import type { AgentStatus, LogEntry } from '@shared/types'
import { profileById, type ProfileId } from '@shared/profiles'

export interface LunaDesk {
  prepare(vault: string, request: string): IrisPreview
  send(token: string): Promise<IrisResult>
  cancel(token: string): void
}

export interface LunaChatHost {
  confirmContext(preview: IrisPreview): Promise<boolean>
  log(kind: LogEntry['kind'], text: string): void
  status(status: AgentStatus, activity: string): void
  startProfileTask(profile: ProfileId, request: string): Promise<void>
  openMediaDraft(draft: Extract<IrisResult, { kind: 'media-draft' }>['draft']): void
}

/** Routes the normal Luna chat through the approved local-data preview before any Claude request. */
export class LunaChat {
  private readonly queue: { request: string; resolve: () => void }[] = []
  private running = false

  constructor(
    private readonly desk: LunaDesk,
    private readonly host: LunaChatHost,
    private readonly vault: () => string,
  ) {}

  send(request: string): Promise<void> {
    const done = new Promise<void>((resolve) => this.queue.push({ request, resolve }))
    if (!this.running) this.host.status('working', 'Preparando seu pedido')
    void this.drain()
    return done
  }

  private async drain(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      while (this.queue.length) {
        const next = this.queue.shift()!
        await this.handle(next.request)
        next.resolve()
      }
    } finally {
      this.running = false
      this.host.status('idle', 'Pronta para ajudar')
    }
  }

  private async handle(request: string): Promise<void> {
    let preview: IrisPreview | undefined
    try {
      preview = this.desk.prepare(this.vault(), request)
      this.host.status('waiting', 'Aguardando sua aprovação para enviar contexto')
      if (!(await this.host.confirmContext(preview))) {
        this.desk.cancel(preview.token)
        this.host.log('assistant', 'Envio cancelado. Nenhum dado foi enviado.')
        return
      }

      this.host.status('working', 'A Luna está pensando…')
      await this.present(await this.desk.send(preview.token), request)
    } catch (error) {
      if (preview) this.desk.cancel(preview.token)
      this.host.log('error', error instanceof Error ? error.message : 'Não consegui concluir esse pedido.')
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
