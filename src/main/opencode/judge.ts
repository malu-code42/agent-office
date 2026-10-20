import { isAbsolute, resolve } from 'node:path'

/** The only models Agent Office may route to. IDs are reviewed, never learned from discovery. */
export const APPROVED_MODELS = [
  { providerID: 'openai', modelID: 'gpt-6-luna', variants: ['high'] },
] as const

export type ApprovedModel = (typeof APPROVED_MODELS)[number]
export interface ModelAvailability {
  id: string
  available: boolean
  tools: boolean
  variants: string[]
  /** Remaining quota, if the provider exposes it. Unknown is not treated as zero. */
  quotaRemaining?: number
}
export interface ModelSelection {
  providerID: ApprovedModel['providerID']
  modelID: ApprovedModel['modelID']
  variant: string
  rationale: string
}

const VARIANT_RANK: Record<string, number> = { none: 0, minimal: 1, low: 2, medium: 3, high: 4, xhigh: 5, max: 6 }

/** Select once, before a subtask starts. Never silently retry another model mid-run. */
export function selectModel(availability: ModelAvailability[], task: string): ModelSelection | undefined {
  const coding = /\b(code|coding|implement|implementation|bug|fix|refactor|test|build|program|código|implementar|corrigir|teste)\b/i.test(task)
  for (const model of APPROVED_MODELS) {
    const state = availability.find((x) => x.id === `${model.providerID}/${model.modelID}`)
    if (!state?.available || !state.tools || state.quotaRemaining === 0) continue
    const variant = [...model.variants]
      .filter((candidate) => state.variants.includes(candidate))
      .sort((a, b) => VARIANT_RANK[b] - VARIANT_RANK[a])[0]
    if (!variant) continue
    return {
      providerID: model.providerID,
      modelID: model.modelID,
      variant,
      rationale: coding
        ? 'GPT-6 Luna é o único modelo runtime aprovado no Agent Office; variante high selecionada para código.'
        : 'GPT-6 Luna é o único modelo runtime aprovado no Agent Office; variante high.',
    }
  }
  return undefined
}

/** Only single-target actions that the Office can reclassify may reach its policy engine. */
export function mapOpenCodePermission(
  action: string,
  resources: string[],
  cwd: string,
): { tool: 'Read' | 'Edit' | 'Bash'; input: Record<string, unknown> } | undefined {
  if (resources.length !== 1) return undefined
  const resource = resources[0]
  if (!resource || resource === '*') return undefined
  switch (action.toLowerCase()) {
    case 'read':
      return { tool: 'Read', input: { file_path: isAbsolute(resource) ? resolve(resource) : resolve(cwd, resource) } }
    case 'edit':
      return { tool: 'Edit', input: { file_path: isAbsolute(resource) ? resolve(resource) : resolve(cwd, resource) } }
    case 'shell':
      return { tool: 'Bash', input: { command: resource } }
    default:
      return undefined
  }
}

export function isApprovedModel(providerID: string, modelID: string, variant?: string): boolean {
  const model = APPROVED_MODELS.find((x) => x.providerID === providerID && x.modelID === modelID)
  return !!model && (!variant || (model.variants as readonly string[]).includes(variant))
}

/** A child with no model inherits its session model; explicit child models must be approved. */
export function isApprovedAgentProfile(model?: { providerID: string; id: string; variant?: string } | null): boolean {
  return !model || isApprovedModel(model.providerID, model.id, model.variant) && model.variant === 'high'
}

/** A provider response alone is not a trustworthy price when its model catalog has no rates. */
export function trustedReportedCost(priceRows: number, reportedCost: number | undefined): number | undefined {
  if (!(priceRows > 0) || typeof reportedCost !== 'number' || !Number.isFinite(reportedCost)) return undefined
  return Math.max(0, reportedCost)
}

/**
 * Structured delegation contract. The judge answers exactly one envelope per
 * run and the Office validates it locally before a single subtask is allowed
 * to start (two-stage flow: decide → validate → execute).
 */
export interface JudgeDelegation {
  task: string
  profile: string
  providerID: string
  modelID: string
  variant: string
  rationale: string
  /** The judge's own certainty that the delegation is allowed and adequate. */
  confidence: number
}
export interface JudgePlan {
  objective: string
  decisions: JudgeDelegation[]
}
/** Below this certainty the Office pauses instead of delegating. */
export const MIN_DELEGATION_CONFIDENCE = 0.5

function isDelegationShape(value: unknown): value is JudgeDelegation {
  if (!value || typeof value !== 'object') return false
  const delegation = value as Record<string, unknown>
  return (
    typeof delegation.task === 'string'
    && typeof delegation.profile === 'string'
    && typeof delegation.providerID === 'string'
    && typeof delegation.modelID === 'string'
    && typeof delegation.variant === 'string'
    && typeof delegation.rationale === 'string'
    && typeof delegation.confidence === 'number'
  )
}

function asPlan(parsed: unknown): JudgePlan | undefined {
  if (!parsed || typeof parsed !== 'object') return undefined
  const plan = parsed as Record<string, unknown>
  if (typeof plan.objective !== 'string' || !Array.isArray(plan.decisions)) return undefined
  if (!plan.decisions.every(isDelegationShape)) return undefined
  return { objective: plan.objective, decisions: plan.decisions }
}

/** Tolerant extraction of the envelope: fenced JSON first, then the outermost braces. Until validateJudgePlan passes, this is only advisory text. */
export function parseJudgePlan(text: string): JudgePlan | undefined {
  if (!text) return undefined
  const candidates: string[] = []
  for (const block of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)) candidates.push(block[1] ?? '')
  const first = text.indexOf('{')
  const last = text.lastIndexOf('}')
  if (first !== -1 && last > first) candidates.push(text.slice(first, last + 1))
  for (const candidate of candidates) {
    try {
      const plan = asPlan(JSON.parse(candidate) as unknown)
      if (plan) return plan
    } catch {
      // Malformed candidate; the remaining ones are tried before giving up.
    }
  }
  return undefined
}

export type JudgePlanVerdict =
  | { ok: true; decisions: JudgeDelegation[] }
  | { ok: false; errors: string[] }

/** Validate the judge's decision locally, before execution. Invalid plans never reach OpenCode. */
export function validateJudgePlan(
  plan: JudgePlan,
  selected: { providerID: string; modelID: string; variant: string },
  allowedProfiles: readonly string[],
): JudgePlanVerdict {
  const errors: string[] = []
  if (!plan.objective.trim()) errors.push('O plano não declara um objetivo.')
  const allowed = new Set(allowedProfiles)
  plan.decisions.forEach((delegation, index) => {
    const what = `Subtarefa ${index + 1} (${delegation.task.trim().slice(0, 60) || 'sem subtarefa'})`
    if (!delegation.task.trim()) errors.push(`${what}: subtarefa vazia.`)
    if (!allowed.has(delegation.profile)) errors.push(`${what}: perfil \`${delegation.profile}\` não está entre os aprovados.`)
    if (delegation.providerID !== selected.providerID || delegation.modelID !== selected.modelID)
      errors.push(`${what}: modelo \`${delegation.providerID}/${delegation.modelID}\` não é o aprovado; sem troca de modelo.`)
    if (delegation.variant !== selected.variant) errors.push(`${what}: variant \`${delegation.variant}\` não é o aprovado (\`${selected.variant}\`).`)
    if (delegation.rationale.trim().length < 8) errors.push(`${what}: justificativa ausente ou muito curta.`)
    if (!Number.isFinite(delegation.confidence) || delegation.confidence < 0 || delegation.confidence > 1)
      errors.push(`${what}: confiança deve ser um número entre 0 e 1.`)
    else if (delegation.confidence < MIN_DELEGATION_CONFIDENCE)
      errors.push(
        `${what}: confiança ${(delegation.confidence * 100).toFixed(0)}% abaixo do mínimo de ${(MIN_DELEGATION_CONFIDENCE * 100).toFixed(0)}%; o Office pausa em vez de delegar.`,
      )
  })
  if (errors.length) return { ok: false, errors: errors.slice(0, 10) }
  return { ok: true, decisions: plan.decisions }
}

const CONTRACT_RULES = [
  'Sempre proibido: arquivos fora da pasta de trabalho, rede, instalar dependências, apagar arquivos, commit/push/publicação, trocar modelo durante a execução.',
  'As ferramentas do OpenCode rodam com aprovação obrigatória do Office; aguarde a decisão.',
]

/** Stage 1 (decide): the judge answers the structured envelope and uses no tools. */
export function decisionPrompt(
  task: string,
  allowedProfiles: readonly string[],
  selected: { providerID: string; modelID: string; variant: string },
): string {
  const profileList = allowedProfiles.join(', ') || 'nenhum'
  return [
    'Você é o agente julgador do Agent Office. A execução acontece em duas etapas: primeiro você decide, o Office valida, depois você executa.',
    'ETAPA 1 — DECIDIR. Não execute nada, não use ferramentas e não delegue ainda. Decomponha a tarefa em subtarefas delegáveis e responda APENAS com um objeto JSON no formato:',
    '{"objective": "...", "decisions": [{"task": "...", "profile": "...", "providerID": "...", "modelID": "...", "variant": "...", "rationale": "...", "confidence": 0.0}]}',
    'Regras do plano:',
    `- "profile" aceita somente: ${profileList}. Se nenhuma combinação fizer sentido, devolve "decisions" como []. "decisions" vazio significa que você executará tudo sozinho.`,
    `- "providerID"/"modelID"/"variant" deve ser, em toda decisão, \`${selected.providerID}\`, \`${selected.modelID}\`, \`${selected.variant}\`. Nenhum outro modelo é aprovado; jamais proponha outro.`,
    '- "rationale": justificativa concreta de por que esse perfil atende à subtarefa.',
    `- "confidence": sua certeza (0 a 1) de que a delegação é permitida e adequada. Abaixo de ${MIN_DELEGATION_CONFIDENCE} o Office pausa em vez de delegar.`,
    ...CONTRACT_RULES,
    'Tarefa do usuário:',
    task,
  ].join('\n')
}

/** Stage 2 (execute): drives only the locally validated envelope; everything outside it must never be delegated. */
export function executionPrompt(plan: JudgePlan): string {
  return [
    'ETAPA 2 — EXECUTAR. O Office validou localmente o plano; execute exatamente este envelope, usando somente o que ele aprova:',
    JSON.stringify(plan, null, 2),
    plan.decisions.length
      ? 'Não delegue outra subtarefa além destas e não mude modelo/perfil durante a execução.'
      : 'O Office aprovou a execução sem delegar subagentes: conduza a tarefa sozinho dentro das regras em vigor.',
    'Se um passo do plano não puder ser concluído, reporte o bloqueio em vez de improvisar outro modelo ou perfil.',
    ...CONTRACT_RULES,
  ].join('\n')
}
