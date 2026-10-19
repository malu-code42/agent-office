import { describe, expect, it } from 'vitest'
import {
  APPROVED_MODELS,
  decisionPrompt,
  executionPrompt,
  isApprovedAgentProfile,
  isApprovedModel,
  type JudgeDelegation,
  mapOpenCodePermission,
  MIN_DELEGATION_CONFIDENCE,
  parseJudgePlan,
  selectModel,
  trustedReportedCost,
  validateJudgePlan,
} from '../src/main/opencode/judge'

const delegation = (overrides: Partial<JudgeDelegation> = {}): JudgeDelegation => ({
  task: 'Implementar subtarefa de código',
  profile: 'general',
  providerID: 'openai',
  modelID: 'gpt-6-luna',
  variant: 'high',
  rationale: 'General dimensiona bem a subtarefa e já roda no modelo aprovado.',
  confidence: 0.9,
  ...overrides,
})
const planOf = (decisions: JudgeDelegation[], objective = 'Concluir a tarefa em subtarefas') => ({ objective, decisions })

describe('OpenCode judge model routing', () => {
  it('selects GPT-6 Luna high as the only active runtime model', () => {
    expect(selectModel([{ id: 'openai/gpt-6-luna', available: true, tools: true, variants: ['low', 'high'] }], 'Implement a code change')).toMatchObject({
      providerID: 'openai',
      modelID: 'gpt-6-luna',
      variant: 'high',
    })
  })

  it('pauses instead of selecting an unapproved model or switching after quota exhaustion', () => {
    expect(selectModel([{ id: 'openai/gpt-6-luna', available: true, tools: true, variants: ['high'], quotaRemaining: 0 }], 'write tests')).toBeUndefined()
    expect(selectModel([{ id: 'unknown/provider-model', available: true, tools: true, variants: ['high'] }], 'write tests')).toBeUndefined()
    expect(selectModel([{ id: 'openai/gpt-6-luna', available: true, tools: false, variants: ['high'] }], 'write tests')).toBeUndefined()
    expect(selectModel([{ id: 'openai/gpt-6-luna', available: true, tools: true, variants: ['low'] }], 'write tests')).toBeUndefined()
  })

  it('does not add free OpenCode IDs to the runtime allowlist', () => {
    expect(APPROVED_MODELS).toEqual([{ providerID: 'openai', modelID: 'gpt-6-luna', variants: ['high'] }])
    const catalog: readonly { providerID: string; modelID: string }[] = APPROVED_MODELS
    expect(catalog.some((m) => m.providerID === 'opencode' || m.modelID.includes('-free'))).toBe(false)
    expect(isApprovedModel('opencode', 'beam-free', 'high')).toBe(false)
    expect(selectModel([{ id: 'opencode/beam-free', available: true, tools: true, variants: ['high'] }], 'Implement feature')).toBeUndefined()
  })

  it('validates provider, model, and supported variant as one approved tuple', () => {
    expect(isApprovedModel('openai', 'gpt-6-luna', 'high')).toBe(true)
    expect(isApprovedModel('openai', 'gpt-6-luna', 'max')).toBe(false)
    expect(isApprovedModel('unknown', 'gpt-6-luna', 'high')).toBe(false)
  })

  it('only allows a child profile to inherit GPT-6 or explicitly select its approved variant', () => {
    expect(isApprovedAgentProfile(undefined)).toBe(true)
    expect(isApprovedAgentProfile({ providerID: 'openai', id: 'gpt-6-luna', variant: 'high' })).toBe(true)
    expect(isApprovedAgentProfile({ providerID: 'openai', id: 'gpt-6-luna' })).toBe(false)
    expect(isApprovedAgentProfile({ providerID: 'opencode', id: 'beam-free', variant: 'high' })).toBe(false)
    expect(isApprovedAgentProfile({ providerID: 'openai', id: 'gpt-6-luna', variant: 'max' })).toBe(false)
    expect(isApprovedAgentProfile({ providerID: 'openai', id: 'gpt-6-luna', variant: 'max' })).toBe(false)
  })

  it('keeps GPT-6 cost unknown when the provider catalog has no reliable price', () => {
    expect(trustedReportedCost(0, 0)).toBeUndefined()
    expect(trustedReportedCost(0, 0.25)).toBeUndefined()
    expect(trustedReportedCost(2, 0.25)).toBe(0.25)
  })

  it('maps only single-target read, edit, and shell permission requests for Office reclassification', () => {
    expect(mapOpenCodePermission('read', ['src/a.ts'], 'C:\\project')).toEqual({
      tool: 'Read',
      input: { file_path: 'C:\\project\\src\\a.ts' },
    })
    expect(mapOpenCodePermission('edit', ['src/a.ts'], 'C:\\project')?.tool).toBe('Edit')
    expect(mapOpenCodePermission('shell', ['npm test'], 'C:\\project')).toEqual({
      tool: 'Bash',
      input: { command: 'npm test' },
    })
    expect(mapOpenCodePermission('read', ['a.ts', 'b.ts'], 'C:\\project')).toBeUndefined()
    expect(mapOpenCodePermission('webfetch', ['https://example.com'], 'C:\\project')).toBeUndefined()
  })
})

describe('OpenCode judge delegation contract', () => {
  it('parses the structured envelope from plain JSON, fences, and surrounding prose', () => {
    const envelope = JSON.stringify(planOf([delegation()]))
    expect(parseJudgePlan(envelope)).toEqual(JSON.parse(envelope))
    expect(parseJudgePlan(`Aqui está o plano:\n\n\`\`\`json\n${envelope}\n\`\`\`\nObrigado.`)).toEqual(JSON.parse(envelope))
    expect(parseJudgePlan(`Claro!\n\n${envelope}\n\nSigo para a validação.`)).toEqual(JSON.parse(envelope))
  })

  it('rejects malformed, incomplete, or shape-invalid envelopes instead of guessing', () => {
    expect(parseJudgePlan('')).toBeUndefined()
    expect(parseJudgePlan('decidi executar sozinho, sem plano estruturado')).toBeUndefined()
    expect(parseJudgePlan('{"decisions": []}')).toBeUndefined()
    expect(parseJudgePlan('{"objective": "ok", "decisions": [{"task": "t"}]}')).toBeUndefined()
    expect(parseJudgePlan('{"objective": "ok", "decisions": [null]}')).toBeUndefined()
    expect(parseJudgePlan('```json\n{"objective": "ok", "decisions": [')).toBeUndefined()
  })

  it('validates profile, model, variant, rationale, and confidence locally before executing', () => {
    const selected = { providerID: 'openai', modelID: 'gpt-6-luna', variant: 'high' }
    expect(validateJudgePlan(planOf([delegation()]), selected, ['general'])).toEqual({ ok: true, decisions: [delegation()] })
    expect(validateJudgePlan(planOf([]), selected, ['general'])).toEqual({ ok: true, decisions: [] })

    const abuses = [
      { profile: 'explore', reason: /não está entre os aprovados/ },
      { modelID: 'beam-free', reason: /não é o aprovado/ },
      { modelID: 'gpt-6-luna', providerID: 'opencode', reason: /não é o aprovado/ },
      { variant: 'max', reason: /variant/ },
      { rationale: 'curto', reason: /justificativa/ },
      { rationale: '   ', reason: /justificativa/ },
      { task: '   ', reason: /subtarefa vazia/ },
      { confidence: -0.2, reason: /entre 0 e 1/ },
      { confidence: 1.4, reason: /entre 0 e 1/ },
    ] as const
    for (const abuse of abuses) {
      const verdict = validateJudgePlan(planOf([delegation({ ...abuse })]), selected, ['general'])
      expect(verdict.ok).toBe(false)
      if (!verdict.ok) expect(verdict.errors.join(' ')).toMatch(abuse.reason)
    }
  })

  it('pauses on confidence below the minimum instead of delegating', () => {
    const selected = { providerID: 'openai', modelID: 'gpt-6-luna', variant: 'high' }
    const verdict = validateJudgePlan(planOf([delegation({ confidence: 0.3 })]), selected, ['general'])
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.errors[0]).toMatch(/confiança 30% abaixo do mínimo/)
    expect(MIN_DELEGATION_CONFIDENCE).toBe(0.5)
  })

  it('admits confidence exactly at the minimum and rejects one step below it', () => {
    const selected = { providerID: 'openai', modelID: 'gpt-6-luna', variant: 'high' }
    expect(validateJudgePlan(planOf([delegation({ confidence: 0.5 })]), selected, ['general'])).toEqual({
      ok: true,
      decisions: [delegation({ confidence: 0.5 })],
    })
    const lowConfidence = validateJudgePlan(planOf([delegation({ confidence: 0.49 })]), selected, ['general'])
    expect(lowConfidence.ok).toBe(false)
  })

  it('keeps objective and allowed-profile rules in the decision prompt', () => {
    const promptText = decisionPrompt('Corrigir o bug do estimador', ['general', 'explore'], { providerID: 'openai', modelID: 'gpt-6-luna', variant: 'high' })
    expect(promptText).toContain('Corrigir o bug do estimador')
    expect(promptText).toContain('general, explore')
    expect(promptText).toContain('`openai`, `gpt-6-luna`, `high`')
    expect(promptText).toContain('decisions" como []')
    expect(promptText).not.toContain('beam-free')

    const emptyPrompt = decisionPrompt('tarefa', [], { providerID: 'openai', modelID: 'gpt-6-luna', variant: 'high' })
    expect(emptyPrompt).toMatch(/somente: nenhum/)
  })

  it('embeds only the validated plan in the execution prompt', () => {
    const promptText = executionPrompt(planOf([delegation()]))
    expect(promptText).toContain('"task": "Implementar subtarefa de código"')
    expect(promptText).toContain('"providerID": "openai"')
    expect(promptText).toContain('Não delegue outra subtarefa além destas')
    expect(executionPrompt(planOf([]))).toContain('sem delegar subagentes')
  })
})
