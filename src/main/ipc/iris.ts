import { IrisDesk } from '../iris'
import { claudeIrisInterpreter } from '../iris-claude'
import { log } from '../log'
import type { AgendaWriter } from '../agenda-write'
import type { TaskWriter } from '../tasks-write'
import { LUNA_AGENT_ID } from '@shared/luna'
import { LunaChat } from '../luna-chat'
import { AudioCaptureWorkflow } from '../audio-capture'
import { AudioDictionaryStore } from '../audio-dictionary'
import { LocalAudioTranscriber } from '../audio-transcriber'
import { claudeAudioPlanInterpreter } from '../audio-claude'
import type { IpcContext } from './context'

/**
 * The Luna (AO-13). `prepare` builds the text the user reads and sends nothing; `send` sends that same text
 * (by its token) and creates a pending proposal, which the user confirms in the caixa de entrada. `files` are the
 * writers of tasks.ts, so one read of tarefas.md is what the proposal is checked against.
 */
export function registerIrisIpc(ctx: IpcContext, files: { tasks: TaskWriter; agenda: AgendaWriter; vault(): string }): void {
  const desk = new IrisDesk({
    planning: ctx.planning,
    tasks: files.tasks,
    agenda: files.agenda,
    interpreter: claudeIrisInterpreter(),
    log,
    memories: () => ctx.profileMemory.summaries(), // AO-43
    lunaPreferences: () => ({ model: ctx.store.settings.lunaModel || undefined, effort: ctx.store.settings.lunaEffort || undefined }),
  })
  // Lightweight IPC tests register task handlers with a partial context and do not exercise the built-in roster.
  if (!ctx.manager) return
  const askLuna = (header: string, question: string, options: { label: string; description: string }[]) =>
    new Promise<string | null>((resolve) => {
      ctx.manager.requestDecision(
        LUNA_AGENT_ID,
        {
          kind: 'question',
          toolName: 'Luna',
          title: header,
          detail: '',
          input: {},
          canAlwaysAllow: false,
          questions: [{ header, question, multiSelect: false, options }],
        },
        (decision) => resolve(decision.behavior === 'allow' ? (Object.values(decision.answers ?? {})[0] ?? null) : null),
      )
    })
  const confirmContext = async (context: string): Promise<boolean> =>
    (await askLuna(
      'Privacidade',
      `Confira o texto exato e os dados selecionados que a Luna enviará ao Claude. Sem sua aprovação, nada será enviado.\n\n${context}`,
      [
        { label: 'Enviar à Luna', description: 'Enviar este contexto para preparar sua resposta.' },
        { label: 'Cancelar envio', description: 'Não enviar nenhum dado.' },
      ],
    )) === 'Enviar à Luna'
  const chatRef: { current?: LunaChat } = {}
  const audio = new AudioCaptureWorkflow(
    new LocalAudioTranscriber(),
    new AudioDictionaryStore(ctx.store.dataDirectory),
    claudeAudioPlanInterpreter(),
    files.tasks,
    {
      dataDirectory: () => ctx.store.dataDirectory,
      vault: files.vault,
      log: (kind, text) => ctx.manager.appendBuiltInLog(LUNA_AGENT_ID, kind, text),
      transcript: (text) => ctx.broadcast({ type: 'luna:transcript', text }),
      status: (activity) => ctx.manager.setBuiltInStatus(LUNA_AGENT_ID, activity === 'Pronta para ajudar' ? 'idle' : 'working', activity),
      confirmContext,
      ask: askLuna,
      routeGroup: async (domain, text, groupId) => {
        const existing = ctx.planning.pendingProposals().find((proposal) => proposal.captureId === groupId)
        if (existing) {
          ctx.manager.appendBuiltInLog(
            LUNA_AGENT_ID,
            'assistant',
            `A proposta de ${domain} deste grupo já está na caixa de entrada para revisão.`,
          )
          return true
        }
        return chatRef.current?.sendDirect(`Trecho de áudio aprovado para ${domain}:\n${text}`, groupId) ?? false
      },
      saveWriting: async (text, stableId) => {
        const title =
          text
            .split(/\r?\n/)
            .find((line) => line.trim())
            ?.trim()
            .slice(0, 200) || 'Trecho de áudio'
        const answer = await askLuna(
          'Salvar escrita',
          `Salvar este trecho como Original na biblioteca de Escrita?\n\nTítulo: ${title}\n\n${text}`,
          [
            { label: 'Salvar como Original', description: 'Criar um novo trecho. O texto existente não será sobrescrito.' },
            { label: 'Não salvar', description: 'Manter este trecho sem gravá-lo.' },
          ],
        )
        if (answer !== 'Salvar como Original') return false
        const vault = files.vault()
        ctx.writing.read(vault)
        ctx.writing.createOriginal(vault, { id: stableId, title, body: text })
        return true
      },
    },
  )
  const chat = new LunaChat(
    desk,
    {
      log: (kind, text) => ctx.manager.appendBuiltInLog(LUNA_AGENT_ID, kind, text),
      status: (status, activity) => ctx.manager.setBuiltInStatus(LUNA_AGENT_ID, status, activity),
      startProfileTask: async (profile, task) => ctx.broadcast({ type: 'luna:profile-task', profile, task }),
      openMediaDraft: (draft) => ctx.broadcast({ type: 'luna:media-draft', draft }),
      transcribeAudio: (attachment, caption) => audio.processAttachment(attachment, caption),
    },
    files.vault,
  )
  chatRef.current = chat
  ctx.manager.setBuiltInMessageHandler((agentId, request, attachments) => {
    if (agentId !== LUNA_AGENT_ID) return
    return chat.send(request, attachments).finally(() => ctx.broadcast({ type: 'proposals', proposals: ctx.planning.pendingProposals() }))
  })
}
