import { randomUUID } from 'node:crypto'
import { APPROVED_MODELS, selectModel, type ModelAvailability } from './judge'
import { openCodeClient } from './runtime'

// One question to the model the office already approved. It is the same model of every
// other OpenCode run (GPT-6 Luna high): this path adds no model to the allowlist and
// never falls back to another one.

/** No tool is ever used here: a permission asked by the session is always refused. */
const POLICY = [{ action: '*', resource: '*', effect: 'ask' as const }]

/** What the popup shows when the model does not answer in time. */
export const TIMEOUT_MESSAGE = 'A IA não respondeu a tempo. Tente de novo.'

/** How long the model has to answer when the caller does not say. */
const DEFAULT_TIMEOUT_MS = 120_000

export interface AskOptions {
  /** Folder the session runs in. */
  cwd: string
  /** Title of the session, for the user to recognize it later. */
  title: string
  /** Stops the question when the player gives up. */
  signal?: AbortSignal
  /** How long the model has to answer. */
  timeoutMs?: number
}

export interface AskResult {
  /** The answer of the model, as it came. */
  text: string
  providerID: string
  modelID: string
  variant: string
}

/** The approved models and whether the service has them right now. */
async function availability(client: Awaited<ReturnType<typeof openCodeClient>>): Promise<ModelAvailability[]> {
  const inventory = await client.model.list()
  return APPROVED_MODELS.map((approved) => {
    const found = inventory.data.find((x) => x.providerID === approved.providerID && x.id === approved.modelID)
    return {
      id: `${approved.providerID}/${approved.modelID}`,
      available: !!found && found.enabled && found.status === 'active',
      tools: found?.capabilities.tools === true,
      variants: found?.variants.map((variant) => variant.id) ?? [],
    }
  })
}

/** The signal of the question, and what stopped it. */
interface QuestionControl {
  /** The composed signal: the session and the stream of events both listen to it. */
  signal: AbortSignal
  /** True when the time ran out. */
  timedOut(): boolean
  /** Stops everything and releases the timer. */
  stop(): void
}

/**
 * One signal for the whole question: the player giving up and the timeout both stop
 * it. Before this, the timeout only stopped the stream of events and the session kept
 * running (and waiting) forever.
 */
function questionControl(user: AbortSignal | undefined, timeoutMs: number): QuestionControl {
  const control = new AbortController()
  let timedOut = false
  const onUser = () => control.abort(user?.reason)
  if (user?.aborted) control.abort(user.reason)
  else user?.addEventListener('abort', onUser, { once: true })
  const timer = setTimeout(() => {
    timedOut = true
    control.abort(new Error(TIMEOUT_MESSAGE))
  }, timeoutMs)
  return {
    signal: control.signal,
    timedOut: () => timedOut,
    stop: () => {
      clearTimeout(timer)
      user?.removeEventListener('abort', onUser)
      if (!control.signal.aborted) control.abort()
    },
  }
}

/**
 * Rejects as soon as the signal aborts: the office never waits for a session that
 * stopped. The listener goes away with the question, so nothing stays listening.
 */
function aborted(signal: AbortSignal): { promise: Promise<never>; dispose: () => void } {
  let listener: (() => void) | undefined
  const promise = new Promise<never>((_resolve, reject) => {
    const fail = () => reject(signal.reason ?? new Error('A pergunta foi interrompida.'))
    if (signal.aborted) {
      fail()
      return
    }
    listener = fail
    signal.addEventListener('abort', fail, { once: true })
  })
  return {
    promise,
    dispose: () => {
      if (listener) signal.removeEventListener('abort', listener)
    },
  }
}

/** Waits for the stream to end, but not forever: a stuck stream never keeps the popup waiting. */
async function settle(pump: Promise<unknown>): Promise<void> {
  const guard = new Promise<void>((resolve) => {
    setTimeout(resolve, 500).unref?.()
  })
  await Promise.race([pump.catch(() => undefined), guard])
}

/**
 * Asks the approved model and returns its answer. The session is created for this
 * question alone, refuses every tool and is removed when the answer arrives.
 *
 * The timeout stops everything the question started: the stream of events, the
 * request of the prompt (the session may ignore the signal, so the office does not
 * wait for it) and the session itself, which is interrupted and thrown away.
 */
export async function askApprovedModel(prompt: string, opts: AskOptions): Promise<AskResult> {
  const client = await openCodeClient()
  const models = await availability(client)
  const selection = selectModel(models, prompt)
  if (!selection) throw new Error('Nenhum modelo aprovado está disponível. A proposta não foi gerada.')
  const sessionID = `squad-${randomUUID()}`
  const control = questionControl(opts.signal, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  let streamed = ''
  let answered = false
  const pump = (async () => {
    try {
      for await (const event of client.event.subscribe({ signal: control.signal })) {
        const raw = event as unknown as { type: string; data?: Record<string, unknown> }
        if (!raw.data) continue
        if (raw.type === 'session.text.delta' && raw.data.sessionID === sessionID && typeof raw.data.delta === 'string')
          streamed += raw.data.delta
        // A planning question never touches the disk: every tool is refused.
        if (raw.type === 'permission.asked' && raw.data.sessionID === sessionID) {
          const requestID = String(raw.data.id ?? '')
          if (requestID) await client.permission.reply({ sessionID, requestID, decision: 'reject' }).catch(() => undefined)
        }
      }
    } catch {
      // The stream ended: the transcript below is the reading of the answer.
    }
  })()
  try {
    // The session is created with the same signal: a creation that hangs does not
    // keep the popup waiting either.
    const stop = aborted(control.signal)
    try {
      await Promise.race([
        client.session.create(
          {
            id: sessionID,
            title: opts.title,
            agent: 'build',
            model: { providerID: selection.providerID, id: selection.modelID, variant: selection.variant },
            location: { directory: opts.cwd },
            permissions: POLICY,
          },
          { signal: control.signal },
        ),
        stop.promise,
      ])
      // The prompt may never answer. The signal ends the request, but the session may
      // ignore it: the office stops waiting and the session is interrupted below.
      await Promise.race([
        client.session.prompt({ sessionID, delivery: 'queue', text: prompt }, { signal: control.signal }),
        stop.promise,
      ])
      answered = true
    } finally {
      stop.dispose()
    }
  } catch (err) {
    // A timeout is not a crash: the popup says the model did not answer in time.
    if (control.timedOut()) throw new Error(TIMEOUT_MESSAGE, { cause: err })
    throw err
  } finally {
    // Nothing of the question keeps running: the stream ends, the model is stopped and
    // the session is thrown away.
    control.stop()
    await settle(pump)
    if (!answered) await client.session.interrupt({ sessionID }).catch(() => undefined)
    await client.session.remove({ sessionID }).catch(() => undefined)
  }
  let text = streamed.trim()
  if (!text) {
    const messages = await client.message.list({ sessionID }).catch(() => undefined)
    const last = messages?.data.filter((message) => message.type === 'assistant').at(-1)
    text = (last?.content ?? [])
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('\n')
      .trim()
  }
  if (!text) throw new Error(TIMEOUT_MESSAGE)
  return { text, providerID: selection.providerID, modelID: selection.modelID, variant: selection.variant }
}
