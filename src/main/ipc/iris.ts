import { IrisDesk } from '../iris'
import { claudeIrisInterpreter } from '../iris-claude'
import { log } from '../log'
import type { AgendaWriter } from '../agenda-write'
import type { TaskWriter } from '../tasks-write'
import { LUNA_AGENT_ID } from '@shared/luna'
import { LunaChat } from '../luna-chat'
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
  })
  // Lightweight IPC tests register task handlers with a partial context and do not exercise the built-in roster.
  if (!ctx.manager) return
  const chat = new LunaChat(
    desk,
    {
      confirmContext: (preview) =>
        new Promise((resolve) => {
          ctx.manager.requestDecision(
            LUNA_AGENT_ID,
            {
              kind: 'question',
              toolName: 'Luna',
              title: 'Revisar o conteúdo antes de enviar',
              detail: '',
              input: {},
              canAlwaysAllow: false,
              questions: [
                {
                  header: 'Privacidade',
                  question: `Confira o texto exato e os dados selecionados que a Luna enviará ao Claude. Sem sua aprovação, nada será enviado.\n\n${preview.context}`,
                  multiSelect: false,
                  options: [
                    { label: 'Enviar à Luna', description: 'Enviar este contexto para preparar sua resposta.' },
                    { label: 'Cancelar envio', description: 'Não enviar nenhum dado.' },
                  ],
                },
              ],
            },
            (decision) => resolve(decision.behavior === 'allow' && Object.values(decision.answers ?? {}).includes('Enviar à Luna')),
          )
        }),
      log: (kind, text) => ctx.manager.appendBuiltInLog(LUNA_AGENT_ID, kind, text),
      status: (status, activity) => ctx.manager.setBuiltInStatus(LUNA_AGENT_ID, status, activity),
      startProfileTask: async (profile, task) => ctx.broadcast({ type: 'luna:profile-task', profile, task }),
      openMediaDraft: (draft) => ctx.broadcast({ type: 'luna:media-draft', draft }),
    },
    files.vault,
  )
  ctx.manager.setBuiltInMessageHandler((agentId, request) => {
    if (agentId !== LUNA_AGENT_ID) return
    return chat.send(request).finally(() => ctx.broadcast({ type: 'proposals', proposals: ctx.planning.pendingProposals() }))
  })
}
