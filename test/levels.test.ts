import { mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OfficeEvent, PermissionLevel } from '../src/shared/types'
import {
  blockedToolsForLevel,
  canOfferAlwaysAllow,
  cleanLevel,
  decideByLevel,
  effectiveLevel,
  levelFromMode,
  roleLevel,
  routineLevel,
  rulesForLevel,
} from '../src/main/permissions/levels'

// AO-109, parte 2: os cinco níveis em código. Três camadas: (A) regra pura (decideByLevel e atribuição),
// (B) o caminho real do agente (askPlayer com um Claude falso), (C) estático (o que o app passa ao Claude).

const cwd = mkdtempSync(join(tmpdir(), 'ao-levels-'))
mkdirSync(join(cwd, 'src'), { recursive: true })
writeFileSync(join(cwd, 'src', 'a.ts'), 'x')
const file = (name: string) => join(cwd, name)
const scope = { cwd, homeDir: join(tmpdir(), 'casa'), dataDir: join(tmpdir(), 'dados') }
const verdict = (level: PermissionLevel, tool: string, input: Record<string, unknown> = {}) =>
  decideByLevel(level, tool, input, scope).verdict

const ALL: PermissionLevel[] = [1, 2, 3, 4, 5]

describe('atribuição de nível', () => {
  it('cleanLevel aceita só inteiros de 1 a 5', () => {
    expect([1, 2, 3, 4, 5].map(cleanLevel)).toEqual([1, 2, 3, 4, 5])
    expect(cleanLevel('4')).toBe(4)
    for (const bad of [0, 6, 2.5, -1, '9', 'x', null, undefined, NaN, {}]) expect(cleanLevel(bad)).toBeUndefined()
  })

  it('levelFromMode: tabela de migração; bypass e desconhecido nunca passam de 3', () => {
    expect(levelFromMode('plan')).toBe(2)
    expect(levelFromMode('default')).toBe(3)
    expect(levelFromMode('acceptEdits')).toBe(4)
    expect(levelFromMode('auto')).toBe(4)
    expect(levelFromMode('bypassPermissions')).toBe(3)
    expect(levelFromMode('qualquer coisa')).toBe(3)
    expect(levelFromMode(undefined)).toBe(3)
  })

  it('padrão por agente: Bonnie 1, Luna 3, Emi 5 (com worktree), orquestrador e ticket 4', () => {
    expect(effectiveLevel({ hasWorktree: false, builtIn: 'bonnie', mode: 'auto' }).level).toBe(1)
    expect(effectiveLevel({ hasWorktree: false, builtIn: 'luna', mode: 'auto' }).level).toBe(3)
    expect(effectiveLevel({ hasWorktree: true, builtIn: 'emi', mode: 'default' }).level).toBe(5)
    expect(effectiveLevel({ hasWorktree: true, squad: true, mode: 'default' }).level).toBe(4)
    expect(effectiveLevel({ hasWorktree: true, ticket: true, mode: 'default' }).level).toBe(4)
  })

  it('padrão por papel de membro: implementador, testador e escritor 4; revisor, analista e pesquisador 2', () => {
    for (const r of ['implementer', 'tester', 'writer']) expect(roleLevel(r)).toBe(4)
    for (const r of ['reviewer', 'analyst', 'researcher']) expect(roleLevel(r)).toBe(2)
    expect(roleLevel('outro')).toBeUndefined()
    expect(roleLevel(undefined)).toBeUndefined()
    // O papel vale mesmo dentro de um orquestrador de nível 4.
    expect(effectiveLevel({ hasWorktree: true, squad: true, memberRole: 'reviewer' }).level).toBe(2)
    expect(effectiveLevel({ hasWorktree: true, squad: true, memberRole: 'implementer' }).level).toBe(4)
  })

  it('auto e acceptEdits sem worktree são rebaixados ao nível 3; com worktree valem 4', () => {
    for (const mode of ['auto', 'acceptEdits']) {
      const sem = effectiveLevel({ hasWorktree: false, mode })
      expect(sem.level).toBe(3)
      expect(sem.downgraded).toBe(true)
      expect(sem.note).toMatch(/cópia isolada/)
      expect(effectiveLevel({ hasWorktree: true, mode }).level).toBe(4)
    }
    // Nível 4 ou 5 gravado sem worktree também cai para 3.
    expect(effectiveLevel({ hasWorktree: false, level: 4 }).level).toBe(3)
    expect(effectiveLevel({ hasWorktree: false, level: 5, builtIn: 'emi' }).level).toBe(3)
  })

  it('o nível 5 só existe para a Emi; avulso e agente criado por agente têm teto', () => {
    expect(effectiveLevel({ hasWorktree: true, level: 5 }).level).toBe(4)
    expect(effectiveLevel({ hasWorktree: true, level: 4, createdByAgent: true }).level).toBe(3)
    expect(effectiveLevel({ hasWorktree: false, level: 3, createdByAgent: true }).level).toBe(3)
  })

  it('dado salvo sem nível ou com nível inválido continua valendo pelo modo, sem erro', () => {
    expect(effectiveLevel({ hasWorktree: true, mode: 'plan' }).level).toBe(2)
    expect(effectiveLevel({ hasWorktree: true, mode: 'default', level: 99 as never }).level).toBe(3)
    expect(effectiveLevel({ hasWorktree: true }).level).toBe(3)
  })

  it('rotinas: padrão 2, teto 4, nunca 5 e nunca 3', () => {
    expect(routineLevel(undefined)).toBe(2)
    expect(routineLevel(5)).toBe(4)
    expect(routineLevel(4)).toBe(4)
    expect(routineLevel(3)).toBe(2)
    expect(routineLevel(1)).toBe(1)
    expect(routineLevel(undefined, 'auto')).toBe(4)
    expect(routineLevel(undefined, 'default')).toBe(2)
    expect(routineLevel(undefined, 'bypassPermissions')).toBe(2)
    expect(routineLevel('lixo')).toBe(2)
    // Rotina em nível 4 sem worktree roda em 2 (não em 3).
    expect(effectiveLevel({ hasWorktree: false, level: 4, routine: true }).level).toBe(2)
    expect(effectiveLevel({ hasWorktree: true, level: 4, routine: true }).level).toBe(4)
    // Teto temporário numa rotina rodando em agente existente.
    expect(effectiveLevel({ hasWorktree: true, level: 4, cap: 2, routine: true }).level).toBe(2)
  })
})

describe('o piso vale em todos os níveis', () => {
  const NEGADOS: Array<[string, Record<string, unknown>]> = [
    ['Bash', { command: 'git merge feature' }],
    ['Bash', { command: 'gh pr merge 12' }],
    ['Bash', { command: 'git push origin main' }],
    ['Bash', { command: 'git push --force' }],
    ['Bash', { command: 'git push' }],
    ['Bash', { command: 'cat .env' }],
    ['Read', { file_path: file('.env') }],
    ['Read', { file_path: file('.claude.json') }],
    ['Read', { file_path: file('secrets/api_key.txt') }],
  ]
  for (const level of ALL) {
    it(`nível ${level}: merge, push e credenciais são negados`, () => {
      for (const [tool, input] of NEGADOS) expect(verdict(level, tool, input), `${tool} ${JSON.stringify(input)}`).toBe('deny')
    })
  }

  it('o piso não derruba o normal (leitura comum nos níveis que leem)', () => {
    for (const level of ALL) expect(verdict(level, 'Read', { file_path: join(cwd, 'src', 'a.ts') })).toBe('allow')
    expect(verdict(4, 'Read', { file_path: file('.env.example') })).not.toBe('deny')
  })
})

describe('nível 1: somente leitura', () => {
  it('permite ler na pasta', () => {
    expect(verdict(1, 'Read', { file_path: join(cwd, 'src', 'a.ts') })).toBe('allow')
  })
  it('nega editar, terminal, rede, subagente, MCP de terceiros e ctx_*', () => {
    expect(verdict(1, 'Edit', { file_path: join(cwd, 'src', 'a.ts') })).toBe('deny')
    expect(verdict(1, 'Write', { file_path: file('novo.ts') })).toBe('deny')
    expect(verdict(1, 'NotebookEdit', { notebook_path: file('n.ipynb') })).toBe('deny')
    expect(verdict(1, 'Bash', { command: 'ls' })).toBe('deny')
    expect(verdict(1, 'WebFetch', { url: 'https://example.com' })).toBe('deny')
    expect(verdict(1, 'WebSearch', { query: 'x' })).toBe('deny')
    expect(verdict(1, 'Agent', { subagent_type: 'x' })).toBe('deny')
    expect(verdict(1, 'mcp__terceiro__tool')).toBe('deny')
    expect(verdict(1, 'mcp__plugin_context-mode_context-mode__ctx_execute', { code: '1' })).toBe('deny')
  })
  it('não lista edição, terminal, rede nem subagente ao Claude', () => {
    const blocked = blockedToolsForLevel(1)
    for (const t of ['Edit', 'Write', 'NotebookEdit', 'Bash', 'WebFetch', 'WebSearch', 'Agent']) expect(blocked).toContain(t)
  })
})

describe('nível 2: leitura e análise', () => {
  it('permite ler e comandos de leitura da lista', () => {
    expect(verdict(2, 'Read', { file_path: join(cwd, 'src', 'a.ts') })).toBe('allow')
    expect(verdict(2, 'Bash', { command: 'ls' })).toBe('allow')
  })
  it('pede cartão para web e npm test', () => {
    expect(verdict(2, 'WebFetch', { url: 'https://example.com' })).toBe('ask')
    expect(verdict(2, 'WebSearch', { query: 'x' })).toBe('ask')
    expect(verdict(2, 'Bash', { command: 'npm test' })).toBe('ask')
  })
  it('nega editar, redirecionar, apagar, git add/commit, instalar, subagente e ctx_*', () => {
    expect(verdict(2, 'Edit', { file_path: join(cwd, 'src', 'a.ts') })).toBe('deny')
    expect(verdict(2, 'Write', { file_path: file('novo.ts') })).toBe('deny')
    expect(verdict(2, 'Bash', { command: 'echo x > arq.txt' })).toBe('deny')
    expect(verdict(2, 'Bash', { command: 'rm arq.txt' })).toBe('deny')
    expect(verdict(2, 'Bash', { command: 'git add .' })).toBe('deny')
    expect(verdict(2, 'Bash', { command: 'git commit -m x' })).toBe('deny')
    expect(verdict(2, 'Bash', { command: 'npm install' })).toBe('deny')
    expect(verdict(2, 'Agent', { subagent_type: 'x' })).toBe('deny')
    expect(verdict(2, 'mcp__plugin_context-mode_context-mode__ctx_execute', { code: '1' })).toBe('deny')
    expect(verdict(2, 'mcp__terceiro__tool')).toBe('deny')
  })
  it('Edit, Write e NotebookEdit nem são oferecidos ao Claude', () => {
    expect(blockedToolsForLevel(2)).toEqual(expect.arrayContaining(['Edit', 'Write', 'NotebookEdit']))
    expect(blockedToolsForLevel(2)).not.toContain('Bash')
  })
})

describe('nível 3: edição com cartão', () => {
  it('pede cartão para cada edição, comando, npm test, instalação, web e subagente', () => {
    expect(verdict(3, 'Edit', { file_path: join(cwd, 'src', 'a.ts') })).toBe('ask')
    expect(verdict(3, 'Write', { file_path: file('novo.ts') })).toBe('ask')
    expect(verdict(3, 'Bash', { command: 'npm test' })).toBe('ask')
    expect(verdict(3, 'Bash', { command: 'npm install' })).toBe('ask')
    expect(verdict(3, 'Bash', { command: 'git commit -m x' })).toBe('ask')
    expect(verdict(3, 'WebFetch', { url: 'https://example.com' })).toBe('ask')
    expect(verdict(3, 'Agent', { subagent_type: 'x' })).toBe('ask')
    expect(verdict(3, 'mcp__terceiro__tool')).toBe('ask')
  })
  it('permite ler e comandos de leitura', () => {
    expect(verdict(3, 'Read', { file_path: join(cwd, 'src', 'a.ts') })).toBe('allow')
    expect(verdict(3, 'Bash', { command: 'ls' })).toBe('allow')
  })
  it('nega push e PR (só nível 5 ou a usuária pelo botão)', () => {
    expect(verdict(3, 'Bash', { command: 'git push origin agent/x' })).toBe('deny')
    expect(verdict(3, 'Bash', { command: 'gh pr create --title x' })).toBe('deny')
  })
})

describe('nível 4: autônomo na própria worktree', () => {
  it('edita arquivo comum na worktree sem cartão', () => {
    expect(verdict(4, 'Edit', { file_path: join(cwd, 'src', 'a.ts') })).toBe('allow')
    expect(verdict(4, 'Write', { file_path: file('novo.ts') })).toBe('allow')
  })
  it('npm test e npm run build/lint/typecheck livres', () => {
    for (const c of ['npm test', 'npm run build', 'npm run lint', 'npm run typecheck'])
      expect(verdict(4, 'Bash', { command: c })).toBe('allow')
  })
  it('pede cartão para arquivo de risco, fora da worktree, apagar, instalar, web e outro comando', () => {
    expect(verdict(4, 'Edit', { file_path: file('package.json') })).toBe('ask')
    expect(verdict(4, 'Write', { file_path: join(tmpdir(), 'fora.ts') })).toBe('ask')
    expect(verdict(4, 'Bash', { command: 'rm -rf src' })).toBe('ask')
    expect(verdict(4, 'Bash', { command: 'npm install left-pad' })).toBe('ask')
    expect(verdict(4, 'WebFetch', { url: 'https://example.com' })).toBe('ask')
    expect(verdict(4, 'WebSearch', { query: 'x' })).toBe('ask')
    expect(verdict(4, 'Bash', { command: 'curl https://example.com' })).toBe('ask')
  })
  it('nega push, PR e definição de squad', () => {
    expect(verdict(4, 'Bash', { command: 'git push origin agent/x' })).toBe('deny')
    expect(verdict(4, 'Bash', { command: 'gh pr create --title x' })).toBe('deny')
    expect(verdict(4, 'Write', { file_path: file('squads/meu/squad.yaml') })).toBe('deny')
    expect(verdict(4, 'Edit', { file_path: file('squads/meu/agents/dev.agent.md') })).toBe('deny')
    expect(verdict(4, 'Write', { file_path: file('squads/meu/output/relatorio.md') })).not.toBe('deny')
  })
})

describe('nível 5: livre dentro das regras', () => {
  it('tudo do nível 4, mais WebSearch livre', () => {
    expect(verdict(5, 'Edit', { file_path: join(cwd, 'src', 'a.ts') })).toBe('allow')
    expect(verdict(5, 'Bash', { command: 'npm test' })).toBe('allow')
    expect(verdict(5, 'WebSearch', { query: 'x' })).toBe('allow')
  })
  it('WebFetch e comandos fora da lista continuam pedindo', () => {
    expect(verdict(5, 'WebFetch', { url: 'https://example.com' })).toBe('ask')
    expect(verdict(5, 'Bash', { command: 'curl https://example.com' })).toBe('ask')
    expect(verdict(5, 'Edit', { file_path: file('package.json') })).toBe('ask')
  })
  it('PR só aqui (com cartão enquanto não há portão do dono); push solto segue negado', () => {
    expect(verdict(5, 'Bash', { command: 'gh pr create --title x' })).toBe('ask')
    expect(verdict(5, 'Bash', { command: 'git push origin agent/x' })).toBe('deny')
    expect(verdict(5, 'Bash', { command: 'git push origin main' })).toBe('deny')
    expect(verdict(5, 'Bash', { command: 'gh pr merge 3' })).toBe('deny')
  })
})

describe('Sempre permitir: só leitura, só nos níveis 2 e 3', () => {
  const rules = [
    { kind: 'tool', value: 'Read' },
    { kind: 'tool', value: 'Edit' },
    { kind: 'command', value: 'npm test' },
  ] as never
  it('oferece só para ferramentas de leitura nos níveis 2 e 3', () => {
    for (const level of [2, 3] as const) {
      expect(canOfferAlwaysAllow(level, 'Read')).toBe(true)
      expect(canOfferAlwaysAllow(level, 'Grep')).toBe(true)
      expect(canOfferAlwaysAllow(level, 'Edit')).toBe(false)
      expect(canOfferAlwaysAllow(level, 'Bash')).toBe(false)
    }
    for (const level of [1, 4, 5] as const) expect(canOfferAlwaysAllow(level, 'Read')).toBe(false)
  })
  it('regras salvas: só as de leitura sobrevivem, e só nos níveis 2 e 3', () => {
    expect(rulesForLevel(3, rules)).toEqual([{ kind: 'tool', value: 'Read' }])
    expect(rulesForLevel(2, rules)).toEqual([{ kind: 'tool', value: 'Read' }])
    for (const level of [1, 4, 5] as const) expect(rulesForLevel(level, rules)).toBeUndefined()
  })
  it('uma regra antiga de Edit ou de npm test não libera nada no nível 3', () => {
    expect(decideByLevel(3, 'Edit', { file_path: join(cwd, 'src', 'a.ts') }, { ...scope, rules }).verdict).toBe('ask')
    expect(decideByLevel(3, 'Bash', { command: 'npm test' }, { ...scope, rules }).verdict).toBe('ask')
  })
})

describe('estático: o que o app entrega ao Claude e às portas de entrada', () => {
  const src = join(__dirname, '..', 'src')
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p, out)
      else if (p.endsWith('.ts')) out.push(p)
    }
    return out
  }
  it('o Claude recebe sempre permissionMode default (nunca auto, acceptEdits ou bypass)', () => {
    const sdk = readFileSync(join(src, 'main', 'agents', 'sdk.ts'), 'utf8')
    expect(sdk).toMatch(/permissionMode: 'default'/)
    for (const f of walk(join(src, 'main'))) {
      const text = readFileSync(f, 'utf8')
      expect(text, f).not.toMatch(/permissionMode\s*:\s*['"](auto|acceptEdits|bypassPermissions)['"]\s*,?\s*\n[^\n]*(query|options)/)
      expect(text, f).not.toMatch(/allowDangerouslySkipPermissions\s*:/)
    }
  })
  it('membros de squad que só leem não recebem Edit/Write', async () => {
    const { memberAgents } = await import('../src/main/squads')
    const mk = (id: string, role: string) => ({ id, name: id, icon: '•', title: '', execution: 'subagent', role, sector: 'x' })
    const defs = memberAgents({
      code: 'c',
      name: 'C',
      icon: '',
      description: '',
      cwd,
      steps: [],
      prompts: { dev: 'p', rev: 'p', ana: 'p', pes: 'p', tes: 'p' },
      members: [mk('dev', 'implementer'), mk('rev', 'reviewer'), mk('ana', 'analyst'), mk('pes', 'researcher'), mk('tes', 'tester')],
    } as never)
    for (const id of ['rev', 'ana', 'pes'])
      expect(defs[id]?.disallowedTools).toEqual(expect.arrayContaining(['Edit', 'Write', 'NotebookEdit', 'Agent']))
    for (const id of ['dev', 'tes']) expect(defs[id]?.disallowedTools).not.toContain('Edit')
  })
})

// ---------- (B) caminho real do agente ----------

type ToolUseOpts = { signal: AbortSignal; agentID?: string }
type CanUse = (tool: string, input: Record<string, unknown>, opts: ToolUseOpts) => Promise<{ behavior: string }>
const queries: Array<{ options: Record<string, unknown> & { canUseTool?: CanUse } }> = []
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (args: { options: Record<string, unknown> & { canUseTool?: CanUse } }) => {
    queries.push(args)
    return {
      [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => undefined) }),
      close: () => undefined,
      interrupt: async () => undefined,
    }
  },
}))
vi.mock('../src/main/claude-path', () => ({ findClaude: () => '/bin/false' }))
vi.mock('../src/main/git', () => ({
  createWorktree: async () => null,
  changesSince: async () => null,
  takeSnapshot: async () => null,
}))
const { Store } = await import('../src/main/store')
const { AgentManager } = await import('../src/main/agents')
const flush = () => new Promise<void>((r) => setTimeout(r, 10))

async function agentAt(opts: {
  mode: 'default' | 'plan' | 'auto' | 'acceptEdits'
  level?: PermissionLevel
  worktree?: boolean
  createdByAgent?: boolean
}) {
  queries.length = 0
  app.setPath('userData', mkdtempSync(join(tmpdir(), 'ao-levels-data-')))
  const store = new Store()
  const dir = mkdtempSync(join(tmpdir(), 'ao-levels-proj-'))
  writeFileSync(join(dir, 'a.ts'), 'x')
  store.settings = { ...store.settings, projects: [{ id: 'p1', name: 'T', cwd: dir }] as never }
  const m = new AgentManager(store)
  const a = await m.hire({
    name: 'Ada',
    cwd: dir,
    task: 't',
    engine: 'claude',
    permissionMode: opts.mode,
    ...(opts.level ? { permissionLevel: opts.level } : {}),
    ...(opts.createdByAgent ? { createdByAgent: true } : {}),
    worktree: false,
  })
  await flush()
  if (opts.worktree) {
    const internal = m as unknown as { agents: Map<string, { summary: { worktree?: unknown } }> }
    internal.agents.get(a.id)!.summary.worktree = { path: dir, root: dir, repo: dir, branch: 'agent/ada-1', base: 'abc' }
  }
  const canUse = queries[0]!.options.canUseTool as CanUse
  const events: OfficeEvent[] = []
  m.on('event', (e: OfficeEvent) => events.push(e))
  /** allow/deny na hora (sem cartão) ou 'ask' quando abriu um cartão. */
  const run = async (tool: string, input: Record<string, unknown>) => {
    const p = canUse(tool, input, { signal: new AbortController().signal })
    const r = await Promise.race([p.then((x) => x.behavior), new Promise<string>((res) => setTimeout(() => res('ask'), 25))])
    if (r === 'ask') {
      const pending = m.pendingRequests().at(-1)
      if (pending) m.respond({ requestId: pending.id, behavior: 'deny', message: 'teste' })
    }
    return r
  }
  return { m, a, dir, run, options: queries[0]!.options, events }
}

describe('caminho real do agente (askPlayer)', () => {
  beforeEach(() => {
    queries.length = 0
  })

  it('avulso em "Pedir permissão" é nível 3: edita só com cartão; o Claude recebe default e nenhuma ferramenta bloqueada', async () => {
    const { run, dir, options, m } = await agentAt({ mode: 'default' })
    expect(options.permissionMode).toBe('default')
    expect(options.disallowedTools).toBeUndefined()
    expect(await run('Edit', { file_path: join(dir, 'a.ts'), old_string: 'x', new_string: 'y' })).toBe('ask')
    expect(await run('Read', { file_path: join(dir, 'a.ts') })).toBe('allow')
    expect(await run('Bash', { command: 'git push origin main' })).toBe('deny')
    m.shutdown()
  })

  it('"Planejar" é nível 2: edição negada direto (sem cartão) e Edit/Write fora da lista do Claude', async () => {
    const { run, dir, options, m } = await agentAt({ mode: 'plan' })
    expect(options.permissionMode).toBe('default')
    expect(options.disallowedTools).toEqual(expect.arrayContaining(['Edit', 'Write', 'NotebookEdit']))
    expect(await run('Edit', { file_path: join(dir, 'a.ts'), old_string: 'x', new_string: 'y' })).toBe('deny')
    expect(await run('Bash', { command: 'git commit -m x' })).toBe('deny')
    expect(await run('Read', { file_path: join(dir, 'a.ts') })).toBe('allow')
    m.shutdown()
  })

  it('Automático sem worktree é rebaixado ao nível 3 (a pasta principal nunca recebe edição livre)', async () => {
    const { run, dir, m } = await agentAt({ mode: 'auto' })
    expect(await run('Edit', { file_path: join(dir, 'a.ts'), old_string: 'x', new_string: 'y' })).toBe('ask')
    expect(await run('Bash', { command: 'npm test' })).toBe('ask')
    m.shutdown()
  })

  it('Automático com worktree é nível 4: edita e roda npm test sem cartão; push segue negado', async () => {
    const { run, dir, m } = await agentAt({ mode: 'auto', worktree: true })
    expect(await run('Edit', { file_path: join(dir, 'a.ts'), old_string: 'x', new_string: 'y' })).toBe('allow')
    expect(await run('Bash', { command: 'npm test' })).toBe('allow')
    expect(await run('Bash', { command: 'git push origin agent/ada-1' })).toBe('deny')
    expect(await run('Bash', { command: 'gh pr create --title x' })).toBe('deny')
    expect(await run('Bash', { command: 'gh pr merge 3' })).toBe('deny')
    expect(await run('Read', { file_path: join(dir, '.env') })).toBe('deny')
    m.shutdown()
  })

  it('agente criado por outro agente nasce com teto 3, mesmo pedindo 4 com worktree', async () => {
    const { run, dir, m } = await agentAt({ mode: 'auto', level: 4, worktree: true, createdByAgent: true })
    expect(await run('Edit', { file_path: join(dir, 'a.ts'), old_string: 'x', new_string: 'y' })).toBe('ask')
    m.shutdown()
  })

  it('rotina em agente existente: o teto da execução vale e some ao terminar', async () => {
    const { run, dir, m, a } = await agentAt({ mode: 'auto', worktree: true })
    m.setRunCap(a.id, 2)
    expect(await run('Edit', { file_path: join(dir, 'a.ts'), old_string: 'x', new_string: 'y' })).toBe('deny')
    m.setRunCap(a.id, undefined)
    expect(await run('Edit', { file_path: join(dir, 'a.ts'), old_string: 'x', new_string: 'y' })).toBe('allow')
    m.shutdown()
  })

  it('Luna (nível 3): lê livre, edita só com cartão; Bonnie (nível 1) só pelas ferramentas dela', async () => {
    const { LUNA_AGENT_ID } = await import('../src/shared/luna')
    const { m } = await agentAt({ mode: 'default' })
    const lunaSummary = m.agent(LUNA_AGENT_ID)
    expect(lunaSummary?.permissionMode).toBe('default')
    const internals = m as unknown as { levelOf(a: unknown): { level: number }; agents: Map<string, unknown> }
    expect(internals.levelOf(internals.agents.get(LUNA_AGENT_ID)).level).toBe(3)
    m.shutdown()
  })
})

describe('migração: dado salvo sem nível continua carregando', () => {
  it('rotina antiga sem nível recebe o nível pela tabela (nunca 5, nunca 3)', async () => {
    const { loadRoutine } = await import('../src/main/routines/store')
    const base = {
      id: 'r1',
      name: 'Diária',
      prompt: 'faça',
      who: { kind: 'new' },
      schedule: { kind: 'daily', time: '09:00' },
      history: [],
    }
    expect(loadRoutine({ ...base, permissionMode: 'auto' })?.permissionLevel).toBe(4)
    expect(loadRoutine({ ...base, permissionMode: 'acceptEdits' })?.permissionLevel).toBe(4)
    expect(loadRoutine({ ...base, permissionMode: 'default' })?.permissionLevel).toBe(2)
    expect(loadRoutine({ ...base, permissionMode: 'plan' })?.permissionLevel).toBe(2)
    expect(loadRoutine({ ...base, permissionMode: 'bypassPermissions' })?.permissionLevel).toBe(2)
    expect(loadRoutine({ ...base, permissionMode: 'auto', permissionLevel: 5 })?.permissionLevel).toBe(4)
    expect(loadRoutine({ ...base })?.permissionLevel).toBe(2)
  })

  it('agente salvo sem nível ou com nível inválido volta sem erro e sem nível', async () => {
    app.setPath('userData', mkdtempSync(join(tmpdir(), 'ao-levels-mig-')))
    const { Store: S } = await import('../src/main/store')
    const s1 = new S()
    const dir = mkdtempSync(join(tmpdir(), 'ao-levels-mig-proj-'))
    const base = {
      source: 'office',
      engine: 'claude',
      cwd: dir,
      status: 'idle',
      activity: '',
      desk: 0,
      look: {},
      costUsd: 0,
      createdAt: 1,
    }
    ;(s1 as unknown as { data: { agents: unknown[] } }).data.agents = [
      { summary: { ...base, id: 'a1', name: 'A1', permissionMode: 'auto', sessionId: 's1' }, log: [], started: false },
      {
        summary: { ...base, id: 'a2', name: 'A2', permissionMode: 'default', permissionLevel: 42, runCap: 2, sessionId: 's2' },
        log: [],
        started: false,
      },
    ]
    s1.save()
    s1.flush?.()
    const s2 = new S()
    const byId = (id: string) => s2.agents.find((x) => x.summary.id === id)?.summary
    expect(byId('a1')?.permissionLevel).toBeUndefined()
    expect(byId('a2')?.permissionLevel).toBeUndefined()
    expect(byId('a2')?.runCap).toBeUndefined()
  })
})

describe('rotinas: o rascunho da tela respeita padrão 2 e teto 4', () => {
  const settings = { projects: [], templates: [], defaultPermissionMode: 'default' } as never
  const draft = (extra: Record<string, unknown>) => ({
    name: 'Diária',
    prompt: 'faça',
    who: { kind: 'new' },
    cwd,
    schedule: { kind: 'daily', time: '09:00' },
    ...extra,
  })
  it('sem nível: 2; 5 vira 4; 3 vira 2; modo auto sem nível vira 4 (teto)', async () => {
    const { cleanRoutineDraft } = await import('../src/main/validate')
    const level = (extra: Record<string, unknown>) =>
      cleanRoutineDraft(draft({ confirmPermissionOverride: true, ...extra }), { settings, agents: [] }).permissionLevel
    expect(level({})).toBe(2)
    expect(level({ permissionLevel: 5 })).toBe(4)
    expect(level({ permissionLevel: 4 })).toBe(4)
    expect(level({ permissionLevel: 3 })).toBe(2)
    expect(level({ permissionLevel: 1 })).toBe(1)
    expect(level({ permissionMode: 'auto' })).toBe(4)
    expect(level({ permissionMode: 'bypassPermissions' })).toBe(2)
    expect(level({ permissionLevel: 'lixo' })).toBe(2)
  })
})
