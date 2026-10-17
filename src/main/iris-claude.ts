import { homedir } from 'node:os'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { accountEnv, mainAccount } from './accounts'
import { claudeNotFoundMessage } from './claude-messages'
import { findClaude } from './claude-path'
import { IrisUnavailable, type IrisInterpreter } from './iris'

/**
 * The instructions of the Íris. Fixed in the app and sent with every request; they hold no user data. The answer
 * is one JSON object in the kinds of proposals.ts, so validate.ts (parseIrisAnswer) can check it.
 */
export const IRIS_INSTRUCTIONS = [
  'You are the Íris, the planner of the Agent Office. The user writes a request in Brazilian Portuguese about their',
  'tasks (tarefas.md) and commitments (agenda.md). You get the request and only the data the app allows: the',
  'commitments of the next seven days (day, time, title) and the tasks the request cites or matches (id, list,',
  'date, time, status, title). You never see anything else.',
  '',
  'Reply with ONLY one JSON object, no prose and no code fence:',
  '{"operations": [ ... ], "question": null}',
  '',
  'Operations, by kind:',
  '- {"kind":"focus","id":"tXXXXXX"} and {"kind":"unfocus","id":"tXXXXXX"}',
  '- {"kind":"reschedule","id":"tXXXXXX","date":"DD.MM.AAAA"}',
  '- {"kind":"discard","id":"tXXXXXX","reason":"..."}',
  '- {"kind":"step","id":"tXXXXXX","text":"..."} (at most 200 characters)',
  '- {"kind":"add-commitment","day":"AAAA-MM-DD","time":"HH:MM","title":"..."}',
  '- {"kind":"remove-commitment","day":"AAAA-MM-DD","time":"HH:MM","title":"..."}',
  '- {"kind":"move-commitment","from":{"day":"AAAA-MM-DD","time":"HH:MM","title":"..."},"to":{"day":"AAAA-MM-DD","time":"HH:MM"}}',
  '',
  'Rules:',
  '- Never complete a task. There is no operation for it.',
  '- Use only the ids and commitments that appear in the data. Never invent one.',
  '- If the request is ambiguous (two commitments or tasks fit) or refers to something not in the data, return',
  '  "operations": [] and "question": a short question in Brazilian Portuguese that tells the user what to say.',
  '- Otherwise return the operations that do what the request asks, and "question": null.',
].join('\n')

/**
 * The Íris's Claude call: one turn, no tools, the answer as text. It uses the same SDK and the same Claude Code
 * binary as the agents (agents/sdk.ts, with the main account), and the session is not kept (persistSession off).
 * The abort signal from IrisDesk stops the call when the time is up.
 */
export function claudeIrisInterpreter(): IrisInterpreter {
  return {
    async interpret(context, signal) {
      const claude = findClaude()
      if (!claude) throw new IrisUnavailable(claudeNotFoundMessage(process.platform))
      const abort = new AbortController()
      const stop = () => abort.abort()
      signal.addEventListener('abort', stop)
      const q = query({
        prompt: context,
        options: {
          cwd: homedir(),
          pathToClaudeCodeExecutable: claude,
          systemPrompt: IRIS_INSTRUCTIONS,
          tools: [],
          maxTurns: 1,
          permissionMode: 'default',
          persistSession: false,
          abortController: abort,
          env: { ...accountEnv(mainAccount()), AGENT_OFFICE_MANAGED: '1' },
        },
      })
      try {
        for await (const msg of q) {
          if (msg.type !== 'result') continue
          if (msg.subtype === 'success') return msg.result
          // The text of an error result is not shown: IrisDesk says the Íris could not answer.
          throw new Error('O Claude Code não devolveu uma resposta.')
        }
        throw new Error('O Claude Code não devolveu uma resposta.')
      } finally {
        signal.removeEventListener('abort', stop)
        q.close()
      }
    },
  }
}
