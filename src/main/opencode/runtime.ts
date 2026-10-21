import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { OpenCode } from '@opencode/client'
import { Service } from '@opencode/client/service'
import { helperLimit, helperLimitReason } from '@shared/subagents'
import type { AgentSummary, SubagentInfo } from '@shared/types'
import { APPROVED_MODELS, decisionPrompt, executionPrompt, isApprovedAgentProfile, parseJudgePlan, selectModel, trustedReportedCost, validateJudgePlan, type JudgeDelegation, type ModelAvailability } from './judge'

export type OpenCodePermissionReply = 'once' | 'always' | 'reject'
export interface OpenCodePermission {
  sessionID: string
  requestID: string
  action: string
  resources: string[]
  message?: string
  metadata?: Record<string, unknown>
  approvedSubagent?: boolean
  subagent?: string
  rejectionReason?: string
}

const POLICY = [
  { action: '*', resource: '*', effect: 'ask' as const },
  { action: 'external_directory', resource: '*', effect: 'ask' as const },
]

export interface OpenCodeTurn {
  text: string
  providerID: string
  model: string
  variant: string
  rationale: string
  streamed: boolean
  inputTokens: number
  outputTokens: number
  costUsd?: number
  /** Delegations the Office validated locally before the execution stage ran. */
  plan: JudgeDelegation[]
}

/** Emitted once the judge plan passes local validation, before the execution stage — even if stage 2 later fails. */
export interface JudgeAudit {
  providerID: string
  model: string
  variant: string
  rationale: string
  decisions: JudgeDelegation[]
}

/** Official local-service client adapter. It never stops the user's shared OpenCode service. */
export class OpenCodeRuntime {
  private client(): ReturnType<typeof makeClient> {
    return makeClient()
  }

  async run(
    agent: AgentSummary,
    prompt: string,
    signal: AbortSignal,
    onPermission: (request: OpenCodePermission) => Promise<OpenCodePermissionReply>,
    onChild: (child: SubagentInfo) => void,
    onText: (delta: string) => void,
    maxSubagents = 10,
    onAudit?: (audit: JudgeAudit) => void,
  ): Promise<OpenCodeTurn> {
    const availability: ModelAvailability[] = []
    let client = await this.client()
    const cwd = agent.worktree?.path ?? agent.cwd
    const inventory = await client.model.list()
    const catalog = await client.agent.list({ location: { directory: cwd } })
    const allowedSubagents = new Set(
      catalog.data
        .filter((profile) => !profile.hidden && (profile.mode === 'subagent' || profile.mode === 'all') && isApprovedAgentProfile(profile.model))
        .map((profile) => profile.id),
    )
    let pricingEntries = 0
    for (const approved of APPROVED_MODELS) {
      const found = inventory.data.find((x) => x.providerID === approved.providerID && x.id === approved.modelID)
      const available = !!found && found.enabled && found.status === 'active'
      availability.push({
        id: `${approved.providerID}/${approved.modelID}`,
        available,
        tools: found?.capabilities.tools === true,
        variants: found?.variants.map((variant) => variant.id) ?? [],
      })
      if (available) pricingEntries = found.cost.length
    }
    const selection = selectModel(availability, prompt)
    if (!selection) throw new Error('Nenhum modelo aprovado está disponível. A execução foi pausada sem fallback.')
    const selectedModel = { providerID: selection.providerID, id: selection.modelID, variant: selection.variant }

    const sessionID = agent.sessionId || randomUUID()
    let existing: Awaited<ReturnType<typeof client.session.get>> | undefined
    try {
      existing = await client.session.get({ sessionID })
    } catch (error) {
      if (!isNotFound(error)) throw error
      await client.session.create({
        id: sessionID,
        title: agent.name,
        agent: 'build',
        model: selectedModel,
        location: { directory: cwd },
        permissions: POLICY,
      })
    }
    if (existing && normalizeDirectory(existing.location.directory) !== normalizeDirectory(cwd)) {
      throw new Error('A sessão OpenCode persistida aponta para outra pasta. A execução foi pausada por segurança.')
    }
    const activeBeforeRun = existing ? await client.session.active() : {}
    const sameSelectedModel = (model?: { providerID: string; id: string; variant?: string } | null) =>
      model?.providerID === selection.providerID && model.id === selection.modelID && model.variant === selection.variant
    if (existing && activeBeforeRun[sessionID] && !sameSelectedModel(existing.model)) {
      await client.session.interrupt({ sessionID }).catch(() => undefined)
      throw new Error('A sessão OpenCode ativa não está usando o modelo aprovado. Ela foi interrompida para impedir envio a outro modelo.')
    }
    if (existing && !sameSelectedModel(existing.model)) await client.session.switchModel({ sessionID, model: selectedModel })
    await client.session.update({ sessionID, permissions: POLICY })
    if (signal.aborted) throw new DOMException('Cancelado.', 'AbortError')
    const eventController = new AbortController()
    const stopEvents = () => eventController.abort()
    signal.addEventListener('abort', stopEvents, { once: true })
    let streamedText = ''
    /** Stage 1 answer (one structured envelope) must not be mistaken for the run's final report. */
    let deciding = true
    let decisionText = ''
    /** Remaining spawn budget per profile, built from the locally validated plan. */
    const planBudget = new Map<string, number>()
    // The cap of the desk: the room holds three helpers, and a tighter limit the
    // player configured wins over it.
    const childLimit = helperLimit(maxSubagents)
    let activeChildren = 0
    let reservedChildren = 0
    const childText = new Map<string, string>()
    const childUsage = new Map<string, { cost: number; inputTokens: number; outputTokens: number }>()
    const related = new Set([sessionID])
    const children = new Map<string, SubagentInfo>()
    /** Recovered children the desk had no room for: interrupted, never adopted. */
    const blockedChildren = new Set<string>()
    const permissionReplies = new Map<string, Promise<void>>()
    const dispatchPermission = (rawPermission: Record<string, unknown>): Promise<void> => {
      const requestID = String(rawPermission.id ?? '')
      if (!requestID) return Promise.resolve()
      const existingReply = permissionReplies.get(requestID)
      if (existingReply) return existingReply
      const action = String(rawPermission.action ?? '')
      const resources = Array.isArray(rawPermission.resources) ? rawPermission.resources.map(String) : []
      const sessionIDForRequest = String(rawPermission.sessionID ?? '')
      const isSubagent = action.toLowerCase() === 'subagent'
      const approvedSubagent = isSubagent && sessionIDForRequest === sessionID && resources.some((id) => allowedSubagents.has(id))
      const overLimit = approvedSubagent && activeChildren + reservedChildren >= childLimit
      const reservesSlot = approvedSubagent && !overLimit
      if (reservesSlot) reservedChildren++
      const request: OpenCodePermission = {
        sessionID: sessionIDForRequest,
        requestID,
        action,
        resources,
        message: typeof rawPermission.message === 'string' ? rawPermission.message : undefined,
        metadata: rawPermission.metadata && typeof rawPermission.metadata === 'object' ? rawPermission.metadata as Record<string, unknown> : undefined,
        approvedSubagent: approvedSubagent && reservesSlot,
        subagent: children.get(sessionIDForRequest)?.description,
        ...(isSubagent && !approvedSubagent
          ? { rejectionReason: `Perfil filho OpenCode não aprovado: ${resources.join(', ') || '(desconhecido)'}.` }
          : overLimit
            ? { rejectionReason: helperLimitReason(childLimit, activeChildren + reservedChildren) }
            : {}),
      }
      const reply = (async () => {
        const decision = await onPermission(request)
        if (reservesSlot && decision === 'reject') reservedChildren = Math.max(0, reservedChildren - 1)
        await client.permission.reply({ sessionID: request.sessionID, requestID: request.requestID, decision })
      })()
      permissionReplies.set(requestID, reply)
      return reply
    }
    const reconcilePending = async () => {
      const permissionSessions = [sessionID]
      const [activeSessions, listed] = await Promise.all([
        client.session.active(),
        client.session.list({ parentID: sessionID, directory: cwd, limit: 100, order: 'asc' }),
      ])
      // The order of the service is not a contract: the desk decides by age, so
      // the same children are always adopted in the same run, whatever the
      // service answered.
      const recovered = listed.data
        .filter((childSession) => childSession.parentID === sessionID)
        .sort(byCreation)
      for (const childSession of recovered) {
          // A child already blocked by the cap stays blocked: it never comes back.
          if (blockedChildren.has(childSession.id)) continue
          const isActive = !!activeSessions[childSession.id]
          const childAgent = childSession.agent ?? ''
          if (!allowedSubagents.has(childAgent)) {
            if (isActive) {
              await client.session.interrupt({ sessionID: childSession.id }).catch(() => undefined)
              await client.session.interrupt({ sessionID }).catch(() => undefined)
              throw new FatalPolicyError(`A retomada encontrou um subagente OpenCode não aprovado (${childAgent || 'desconhecido'}); sessão pausada.`)
            }
            continue
          }
          const tracked = children.get(childSession.id)
          if (tracked) {
            if (isActive) {
              if (!sameSelectedModel(childSession.model)) {
                await client.session.interrupt({ sessionID: childSession.id }).catch(() => undefined)
                await client.session.interrupt({ sessionID }).catch(() => undefined)
                throw new FatalPolicyError('Um subagente OpenCode ativo mudou de modelo; execução pausada por segurança.')
              }
              await client.session.update({ sessionID: childSession.id, permissions: POLICY })
              permissionSessions.push(childSession.id)
            } else if (childSession.outcome && !tracked.status) {
              const status: SubagentInfo['status'] = childSession.outcome === 'succeeded' ? 'completed' : childSession.outcome === 'interrupted' ? 'stopped' : 'failed'
              const inputTokens = childSession.tokens.input ?? 0
              const outputTokens = childSession.tokens.output ?? 0
              const costUsd = trustedReportedCost(pricingEntries, childSession.cost)
              const ended = {
                ...tracked,
                status,
                endedAt: childSession.time.updated,
                inputTokens,
                outputTokens,
                tokens: inputTokens + outputTokens,
                ...(costUsd !== undefined ? { costUsd } : { costUnknown: true }),
              }
              children.set(childSession.id, ended)
              activeChildren = Math.max(0, activeChildren - 1)
              onChild(ended)
            }
            continue
          }
          const child: SubagentInfo = {
            id: childSession.id,
            description: childSession.title ?? 'Subtarefa OpenCode recuperada',
            type: childAgent,
            model: `${selection.providerID}/${selection.modelID}`,
            variant: selection.variant,
            startedAt: childSession.time.created,
            background: true,
          }
          if (isActive && activeChildren >= childLimit) {
            // A retomada adota no máximo childLimit filhos ativos: a mesa não
            // ganha ajudantes extras. O excedente é interrompido (a sessão pai
            // nunca é interrompida) e entra na conversa do agente como falha,
            // com o mesmo motivo dos outros bloqueios por limite.
            blockedChildren.add(childSession.id)
            await client.session.interrupt({ sessionID: childSession.id }).catch(() => undefined)
            onChild({
              ...child,
              status: 'failed',
              endedAt: Date.now(),
              summary: helperLimitReason(childLimit, activeChildren),
            })
            continue
          }
          children.set(childSession.id, child)
          related.add(childSession.id)
          if (isActive) {
            if (!sameSelectedModel(childSession.model)) {
              await client.session.interrupt({ sessionID: childSession.id }).catch(() => undefined)
              await client.session.interrupt({ sessionID }).catch(() => undefined)
              throw new FatalPolicyError('Um subagente ativo da sessão recuperada não está usando o modelo aprovado; execução pausada.')
            }
            await client.session.update({ sessionID: childSession.id, permissions: POLICY })
            activeChildren++
            onChild(child)
            permissionSessions.push(childSession.id)
          } else if (childSession.outcome) {
            const status: SubagentInfo['status'] = childSession.outcome === 'succeeded' ? 'completed' : childSession.outcome === 'interrupted' ? 'stopped' : 'failed'
            const costUsd = trustedReportedCost(pricingEntries, childSession.cost)
            const inputTokens = childSession.tokens.input ?? 0
            const outputTokens = childSession.tokens.output ?? 0
            onChild({
              ...child,
              status,
              endedAt: childSession.time.updated,
              inputTokens,
              outputTokens,
              tokens: inputTokens + outputTokens,
              ...(costUsd !== undefined ? { costUsd } : { costUnknown: true }),
            })
          }
      }
      for (const permissionSession of permissionSessions) {
        const pending = await client.permission.list({ sessionID: permissionSession })
        await Promise.all(pending.map((permission) => dispatchPermission(permission as unknown as Record<string, unknown>)))
      }
    }
    const eventPump = (async () => {
      let reconnectAttempts = 0
      while (!eventController.signal.aborted) {
        try {
          for await (const event of client.event.subscribe({ signal: eventController.signal })) {
        const raw = event as unknown as { type: string; data?: Record<string, unknown> }
        if (!raw.data) continue
        if (raw.type === 'session.text.delta' && typeof raw.data.sessionID === 'string' && typeof raw.data.delta === 'string') {
          if (raw.data.sessionID === sessionID) {
            if (deciding) {
              decisionText += raw.data.delta
              continue
            }
            streamedText += raw.data.delta
            onText(raw.data.delta)
          } else if (related.has(raw.data.sessionID)) {
            childText.set(raw.data.sessionID, (childText.get(raw.data.sessionID) ?? '') + raw.data.delta)
          }
          continue
        }
        if (raw.type === 'session.usage.updated' && typeof raw.data.sessionID === 'string' && related.has(raw.data.sessionID)) {
          const tokens = raw.data.tokens && typeof raw.data.tokens === 'object' ? raw.data.tokens as Record<string, unknown> : {}
          childUsage.set(raw.data.sessionID, {
            cost: typeof raw.data.cost === 'number' ? raw.data.cost : 0,
            inputTokens: typeof tokens.input === 'number' ? tokens.input : 0,
            outputTokens: typeof tokens.output === 'number' ? tokens.output : 0,
          })
          continue
        }
        if (raw.type === 'session.created' && typeof raw.data.sessionID === 'string' && raw.data.parentID && related.has(String(raw.data.parentID))) {
          const childID = raw.data.sessionID
          if (children.has(childID)) continue
          // A child the cap already refused stays refused: it never comes back.
          if (blockedChildren.has(childID)) continue
          const childAgent = String(raw.data.agent ?? '')
          if (deciding) {
            await client.session.interrupt({ sessionID: childID }).catch(() => undefined)
            await client.session.interrupt({ sessionID }).catch(() => undefined)
            onChild({
              id: childID,
              description: String(raw.data.title ?? 'Subtarefa OpenCode'),
              type: childAgent,
              model: `${selection.providerID}/${selection.modelID}`,
              variant: selection.variant,
              startedAt: Date.now(),
              endedAt: Date.now(),
              background: true,
              status: 'failed',
              summary: 'Bloqueado pelo Agent Office: subagente nasceu antes da validação do plano.',
            })
            throw new FatalPolicyError('Um subagente nasceu antes da validação do plano do julgador; execução interrompida.')
          }
          if (!allowedSubagents.has(childAgent)) {
            await client.session.interrupt({ sessionID: childID }).catch(() => undefined)
            await client.session.interrupt({ sessionID }).catch(() => undefined)
            onChild({
              id: childID,
              description: String(raw.data.title ?? 'Subtarefa OpenCode'),
              type: childAgent,
              model: `${selection.providerID}/${selection.modelID}`,
              variant: selection.variant,
              startedAt: Date.now(),
              endedAt: Date.now(),
              background: true,
              status: 'failed',
              summary: `Bloqueado pelo Agent Office: perfil filho não aprovado (${childAgent || '(desconhecido)'}).`,
            })
            throw new FatalPolicyError(`OpenCode criou um perfil filho não aprovado (${childAgent || 'desconhecido'}); execução interrompida.`)
          }
          if (reservedChildren === 0 && activeChildren >= childLimit) {
            // The cap refused this child: it is interrupted, reported as failed
            // and remembered, so a later reconcile never adopts it again.
            blockedChildren.add(childID)
            await client.session.interrupt({ sessionID: childID }).catch(() => undefined)
            onChild({
              id: childID,
              description: String(raw.data.title ?? 'Subtarefa OpenCode'),
              type: childAgent,
              model: `${selection.providerID}/${selection.modelID}`,
              variant: selection.variant,
              startedAt: Date.now(),
              endedAt: Date.now(),
              background: true,
              status: 'failed',
              summary: helperLimitReason(childLimit, activeChildren),
            })
            continue
          }
          let childModel = raw.data.model && typeof raw.data.model === 'object'
            ? raw.data.model as { providerID?: unknown; id?: unknown; variant?: unknown }
            : undefined
          if (typeof childModel?.providerID !== 'string' || typeof childModel.id !== 'string' || typeof childModel.variant !== 'string') {
            const childSession = await client.session.get({ sessionID: childID })
            childModel = childSession.model
          }
          if (!sameSelectedModel(childModel as { providerID: string; id: string; variant?: string } | undefined)) {
            await client.session.interrupt({ sessionID: childID }).catch(() => undefined)
            await client.session.interrupt({ sessionID }).catch(() => undefined)
            onChild({
              id: childID,
              description: String(raw.data.title ?? 'Subtarefa OpenCode'),
              type: childAgent,
              model: typeof childModel?.providerID === 'string' && typeof childModel.id === 'string'
                ? `${childModel.providerID}/${childModel.id}`
                : 'unknown',
              variant: typeof childModel?.variant === 'string' ? childModel.variant : 'unknown',
              startedAt: Date.now(),
              endedAt: Date.now(),
              background: true,
              status: 'failed',
              summary: 'Bloqueado pelo Agent Office: o modelo efetivo do subagente não corresponde a GPT-6 Luna high.',
            })
            throw new FatalPolicyError('O modelo efetivo do subagente não corresponde ao modelo aprovado GPT-6 Luna high; execução interrompida.')
          }
          const planRemaining = planBudget.get(childAgent) ?? 0
          if (planRemaining <= 0) {
            await client.session.interrupt({ sessionID: childID }).catch(() => undefined)
            await client.session.interrupt({ sessionID }).catch(() => undefined)
            onChild({
              id: childID,
              description: String(raw.data.title ?? 'Subtarefa OpenCode'),
              type: childAgent,
              model: `${selection.providerID}/${selection.modelID}`,
              variant: selection.variant,
              startedAt: Date.now(),
              endedAt: Date.now(),
              background: true,
              status: 'failed',
              summary: `Bloqueado pelo Agent Office: delegação fora do plano validado (${childAgent || '(desconhecido)'}).`,
            })
            throw new FatalPolicyError(`OpenCode tentou delegar fora do plano validado (${childAgent || 'desconhecido'}); execução interrompida.`)
          }
          planBudget.set(childAgent, planRemaining - 1)
          if (reservedChildren > 0) reservedChildren--
          activeChildren++
          related.add(childID)
          try {
            // Never switch a child's model after it has been created; validate it, then apply Office permissions.
            await client.session.update({ sessionID: childID, permissions: POLICY })
          } catch (error) {
            await client.session.interrupt({ sessionID: childID }).catch(() => undefined)
            await client.session.interrupt({ sessionID }).catch(() => undefined)
            throw new FatalPolicyError(`Não consegui aplicar a política Office ao subagente OpenCode; execução interrompida: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
          }
          const child = {
            id: childID,
            description: String(raw.data.title ?? 'Subtarefa OpenCode'),
            type: childAgent,
            model: `${selection.providerID}/${selection.modelID}`,
            variant: selection.variant,
            startedAt: Date.now(),
            background: true,
          }
          children.set(childID, child)
          onChild(child)
          continue
        }
        if (typeof raw.data.sessionID === 'string' && related.has(raw.data.sessionID)) {
          const status = raw.type === 'session.execution.succeeded' ? 'completed' : raw.type === 'session.execution.failed' ? 'failed' : raw.type === 'session.execution.interrupted' ? 'stopped' : undefined
          if (status && raw.data.sessionID !== sessionID) {
            const child = children.get(raw.data.sessionID)
            // A child refused by the cap keeps its failure: a late "stopped"
            // never rewrites the reason the player was told.
            if (child && !blockedChildren.has(raw.data.sessionID)) {
              const summary = childText.get(raw.data.sessionID)?.trim()
              const usage = childUsage.get(raw.data.sessionID)
              const costUsd = usage ? trustedReportedCost(pricingEntries, usage.cost) : undefined
              onChild({
                ...child,
                status,
                endedAt: Date.now(),
                ...(usage ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, tokens: usage.inputTokens + usage.outputTokens } : {}),
                ...(costUsd !== undefined ? { costUsd } : { costUnknown: true }),
                ...(summary ? { summary: summary.slice(0, 1200) } : {}),
              })
              activeChildren = Math.max(0, activeChildren - 1)
            }
          }
        }
        if (raw.type === 'permission.asked' && typeof raw.data.sessionID === 'string' && related.has(raw.data.sessionID)) {
          const askedAction = String(typeof raw.data.action === 'string' ? raw.data.action : '')
          if (deciding && askedAction.toLowerCase() === 'subagent' && raw.data.sessionID === sessionID) {
            await client.session.interrupt({ sessionID }).catch(() => undefined)
            throw new FatalPolicyError('A Office não permite pedido de subagente antes da validação do plano do julgador; execução interrompida.')
          }
          void dispatchPermission(raw.data).catch(async () => {
            await client.session.interrupt({ sessionID }).catch(() => undefined)
          })
        }
          }
          if (eventController.signal.aborted) break
          throw new Error('O stream SSE do OpenCode foi encerrado.')
        } catch (error) {
          if (eventController.signal.aborted) break
          if (error instanceof FatalPolicyError) throw error
          reconnectAttempts++
          if (reconnectAttempts > 3) throw error
          client = await this.client()
          await reconcilePending()
          await new Promise((resolveDelay) => setTimeout(resolveDelay, Math.min(250 * reconnectAttempts, 1500)))
        }
      }
    })()
    const eventPumpFailure = eventPump.then(
      () => {
        if (!eventController.signal.aborted) throw new Error('O stream do OpenCode parou sem concluir a execução.')
        return new Promise<never>(() => undefined)
      },
      (error) => Promise.reject(error),
    )
    void eventPumpFailure.catch(() => undefined)
    let plan: JudgeDelegation[]
    try {
      await reconcilePending()
      // —— Stage 1 (decide): the judge answers one structured envelope; the
      // Office validates it locally before a single subtask is allowed to run.
      const decisionRun = client.session.prompt(
        {
          sessionID,
          delivery: 'queue',
          text: decisionPrompt(prompt, [...allowedSubagents], selection),
        },
        { signal },
      )
      try {
        await Promise.race([decisionRun, eventPumpFailure])
      } catch (error) {
        if (!signal.aborted) await client.session.interrupt({ sessionID }).catch(() => undefined)
        throw error
      }
      let parsed = parseJudgePlan(decisionText)
      if (!parsed) {
        // Streamed deltas may lag behind completion; the transcript is the fall-back reading.
        try {
          const transcript = await client.message.list({ sessionID }, { signal: AbortSignal.timeout(5_000) })
          parsed = parseJudgePlan(
            transcript.data
              .filter((message) => message.type === 'assistant')
              .flatMap((message) => message.content.filter((part) => part.type === 'text').map((part) => part.text))
              .join('\n\n'),
          )
        } catch {
          // The stream answer above is already what failed; both failing closes the run.
        }
      }
      if (!parsed) throw new Error('O julgador não apresentou o plano JSON esperado; execução pausada sem delegar.')
      const verdict = validateJudgePlan(parsed, selection, [...allowedSubagents])
      if (!verdict.ok)
        throw new Error(
          `O plano do julgador não passou na validação local; execução pausada sem delegar tarefa.\n${verdict.errors
            .map((reason) => `- ${reason}`)
            .join('\n')}`,
        )
      plan = verdict.decisions
      // From here on the event gate admits exactly one spawn per validated delegation.
      planBudget.clear()
      for (const delegation of verdict.decisions) planBudget.set(delegation.profile, (planBudget.get(delegation.profile) ?? 0) + 1)
      onAudit?.({
        providerID: selection.providerID,
        model: selection.modelID,
        variant: selection.variant,
        rationale: selection.rationale,
        decisions: verdict.decisions,
      })
      // —— Stage 2 (execute): only validated delegations reach the OpenCode session.
      deciding = false
      const promptRun = client.session.prompt(
        {
          sessionID,
          delivery: 'queue',
          text: executionPrompt(parsed),
        },
        { signal },
      )
      try {
        await Promise.race([promptRun, eventPumpFailure])
      } catch (error) {
        if (!signal.aborted) await client.session.interrupt({ sessionID }).catch(() => undefined)
        throw error
      }
    } finally {
      eventController.abort()
      signal.removeEventListener('abort', stopEvents)
      await eventPump.catch(() => undefined)
      await Promise.all([...permissionReplies.values()])
    }
    let assistant: { cost?: number; tokens?: { input?: number; output?: number } } | undefined
    try {
      const messages = await client.message.list({ sessionID }, { signal: AbortSignal.timeout(5_000) })
      const last = messages.data.filter((message) => message.type === 'assistant').at(-1)
      assistant = last
      if (!streamedText && last?.content) {
        streamedText = last.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n').trim()
      }
    } catch {
      // SSE may have disconnected; missing transcript/price is reported as unknown, never zero.
    }
    const costUsd = trustedReportedCost(pricingEntries, assistant?.cost)
    return {
      text: streamedText || 'A sessão terminou sem uma resposta textual recuperável.',
      providerID: selection.providerID,
      model: selection.modelID,
      variant: selection.variant,
      rationale: selection.rationale,
      streamed: streamedText.length > 0,
      inputTokens: assistant?.tokens?.input ?? 0,
      outputTokens: assistant?.tokens?.output ?? 0,
      ...(costUsd !== undefined ? { costUsd } : {}),
      plan,
    }
  }

  async interrupt(sessionID: string): Promise<void> {
    const client = await this.client()
    await client.session.interrupt({ sessionID })
  }
}

async function makeClient() {
  const endpoint = (await Service.discover()) ?? (await Service.ensure())
  const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
  const info = await client.server.info()
  if (!/^2\./.test(info.version)) throw new Error(`OpenCode ${info.version} não é compatível com a integração V2.`)
  return client
}

/** The official local-service client, for the paths that ask the approved model something. */
export const openCodeClient = makeClient

function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const value = error as { detail?: unknown; cause?: unknown; status?: unknown }
  if (value.status === 404 || value.detail === '404') return true
  if (!value.cause || typeof value.cause !== 'object') return false
  return (value.cause as { status?: unknown }).status === 404
}

function normalizeDirectory(path: string): string {
  const normalized = resolve(path).replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

/**
 * The order of the recovered children: the oldest first, the id breaking a tie.
 * The service does not promise an order, so the desk decides here — the same
 * children are always adopted in the same run, and the ones already working
 * longest are the ones kept.
 */
function byCreation(a: { id: string; time?: { created?: number } }, b: { id: string; time?: { created?: number } }): number {
  const created = (a.time?.created ?? 0) - (b.time?.created ?? 0)
  if (created !== 0) return created
  if (a.id === b.id) return 0
  return a.id < b.id ? -1 : 1
}

class FatalPolicyError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'FatalPolicyError'
  }
}
