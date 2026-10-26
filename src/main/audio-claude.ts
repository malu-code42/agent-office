import { homedir } from 'node:os'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { accountEnv, mainAccount } from './accounts'
import { claudeNotFoundMessage } from './claude-messages'
import { findClaude } from './claude-path'

export class AudioPlanUnavailable extends Error {
  constructor(
    message: string,
    readonly retryable = false,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'AudioPlanUnavailable'
  }
}

export interface AudioPlanInterpreter {
  interpret(context: string, signal: AbortSignal): Promise<string>
}

export const AUDIO_PLAN_INSTRUCTIONS = [
  'You are Luna, classifying a locally transcribed audio message for the Agent Office. The user has reviewed the transcript and approved this exact text context for this one request.',
  'Never call tools, write files, complete tasks, invent task lists, infer an ambiguous date, or claim that anything has been saved.',
  'Return only one JSON object with this exact shape:',
  '{"groups":[],"question":null}',
  'Group all task items by their exact canonical existing list name from the context. Task fields: title (required), date (DD.MM.YYYY when clearly understood, otherwise ask), and time (HH:MM only when clearly stated).',
  'Do not invent a category. If no existing list fits, or a relative date has multiple plausible meanings, return no writable groups and ask one short question in Brazilian Portuguese.',
  'Use the explicit local calendar mapping in the context for hoje, amanhã and depois de amanhã. For weekdays or relative expressions not mapped there, calculate from the local reference date only when the intended day is unambiguous; otherwise ask.',
  'Keep non-task spans verbatim and route them as {"kind":"route","domain":"agenda"|"media"|"goals"|"writing"|"unknown","text":"..."}. Any writing span is a draft suggestion only; it is never saved automatically.',
  'Task group shape: {"kind":"tasks","list":"exact existing list","tasks":[{"title":"...","date":"DD.MM.YYYY","time":"HH:MM"}],"sourceText":"..."}. Omit optional date/time when absent.',
  'Route group shape: {"kind":"route","domain":"agenda|media|goals|writing|unknown","text":"..."}.',
  'No transcript, audio bytes, or result is stored by this interpreter. The caller handles explicit per-group approval and local writes.',
].join('\n')

export function claudeAudioPlanInterpreter(): AudioPlanInterpreter {
  return {
    async interpret(context, signal) {
      const claude = findClaude()
      if (!claude) throw new AudioPlanUnavailable(claudeNotFoundMessage(process.platform))
      const abort = new AbortController()
      const stop = () => abort.abort()
      signal.addEventListener('abort', stop)
      const session = query({
        prompt: context,
        options: {
          cwd: homedir(),
          pathToClaudeCodeExecutable: claude,
          systemPrompt: AUDIO_PLAN_INSTRUCTIONS,
          tools: [],
          maxTurns: 1,
          permissionMode: 'default',
          persistSession: false,
          abortController: abort,
          env: { ...accountEnv(mainAccount()), AGENT_OFFICE_MANAGED: '1' },
        },
      })
      try {
        for await (const message of session) {
          if (message.type !== 'result') continue
          if (message.subtype === 'success') return message.result
          throw new Error('A Luna não conseguiu organizar a transcrição.')
        }
        throw new Error('A Luna não devolveu um plano para o áudio.')
      } catch (error) {
        if (error instanceof AudioPlanUnavailable) throw error
        throw new AudioPlanUnavailable('A consulta do plano de áudio falhou; a captura continuará pendente.', true, { cause: error })
      } finally {
        signal.removeEventListener('abort', stop)
        session.close()
      }
    },
  }
}
