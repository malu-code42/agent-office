// AO-109, parte 3: merge_pr (só nível 5, cartão reforçado a cada uso), portão do dono (conta do gh) e merge pelo código do escritório.
// Nada real: o gh e o GitHub são simulados; nenhum PR existe.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emiAgentId } from '../src/shared/emi'
import { assertOwnerAccount, DEFAULT_GITHUB_ACCOUNTS, normalizeGithubAccounts } from '../src/main/git/owner-gate'
import { mergePullRequest, inspectPullRequest } from '../src/main/git/merge'
import { MergeApprovals, MERGE_TOOL } from '../src/main/merge-tools'

const queries: Array<{ options: Record<string, unknown> }> = []
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (args: { options: Record<string, unknown> }) => {
    queries.push(args)
    return { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => undefined) }), close: () => undefined, interrupt: async () => undefined }
  },
  createSdkMcpServer: (config: { name: string }) => ({ type: 'sdk', name: config.name, instance: config }),
  tool: (...args: unknown[]) => args,
}))
vi.mock('../src/main/claude-path', () => ({ findClaude: () => '/bin/false' }))

const SHA = 'a'.repeat(40)
const OTHER_SHA = 'b'.repeat(40)
const IDENTITY = { host: 'github.com', repository: 'malu-code42/agent-office' }

function prJson(over: Record<string, unknown> = {}) {
  return JSON.stringify({
    number: 7,
    title: 'Corrige o tema',
    state: 'OPEN',
    headRefName: 'agent/tema',
    baseRefName: 'main',
    headRefOid: SHA,
    isCrossRepository: false,
    url: 'https://github.com/malu-code42/agent-office/pull/7',
    ...over,
  })
}

describe('portão do dono (conta do gh)', () => {
  it('a lista padrão é só malu-code42; vazia ou inválida recusa tudo', () => {
    expect(DEFAULT_GITHUB_ACCOUNTS).toEqual(['malu-code42'])
    expect(normalizeGithubAccounts(undefined)).toEqual(['malu-code42'])
    expect(normalizeGithubAccounts([])).toEqual([])
    expect(normalizeGithubAccounts('malu-code42')).toEqual([])
    expect(normalizeGithubAccounts(['Malu-Code42', 'malu-code42', 'x y', 42, '-ok'.slice(1)])).toEqual(['malu-code42', 'ok'])
  })

  const gate = (login: string | Error, accounts: string[]) =>
    assertOwnerAccount('gh', '/x', 'github.com', undefined, {
      accounts: () => accounts,
      activeLogin: async () => {
        if (login instanceof Error) throw login
        return login
      },
    })

  it('aceita a conta autorizada (sem diferenciar caixa) e devolve o login', async () => {
    await expect(gate('malu-code42\n', ['malu-code42'])).resolves.toBe('malu-code42')
    await expect(gate('Malu-Code42', ['malu-code42'])).resolves.toBe('Malu-Code42')
  })

  it('recusa conta de fora, lista vazia, gh quebrado e resposta ilegível', async () => {
    await expect(gate('outra-pessoa', ['malu-code42'])).rejects.toThrow(/outra-pessoa.*não está na lista/)
    await expect(gate('malu-code42', [])).rejects.toThrow(/lista .* vazia/)
    await expect(gate(new Error('gh: not logged in'), ['malu-code42'])).rejects.toThrow(/não consegui confirmar/i)
    await expect(gate('', ['malu-code42'])).rejects.toThrow(/ilegível/)
    await expect(gate('a b; rm -rf', ['malu-code42'])).rejects.toThrow(/ilegível/)
  })

  it('o host vazio recusa', async () => {
    await expect(
      assertOwnerAccount('gh', '/x', '', undefined, { accounts: () => ['malu-code42'], activeLogin: async () => 'malu-code42' }),
    ).rejects.toThrow(/host/)
  })
})

describe('mergePullRequest (gh simulado)', () => {
  function deps(over: { view?: string; owner?: () => Promise<unknown> } = {}) {
    const calls: string[][] = []
    return {
      calls,
      deps: {
        identity: async () => IDENTITY,
        gh: async (args: string[]) => {
          calls.push(args)
          return args[1] === 'view' ? (over.view ?? prJson()) : ''
        },
        assertOwner: over.owner ?? (async () => 'malu-code42'),
      },
    }
  }

  it('mescla com merge commit, sem apagar branch, conferindo o commit que a usuária viu', async () => {
    const { calls, deps: d } = deps()
    await expect(mergePullRequest('/repo', 7, SHA, d)).resolves.toBe('https://github.com/malu-code42/agent-office/pull/7')
    const merge = calls.find((c) => c[1] === 'merge')!
    expect(merge).toEqual(['pr', 'merge', 'https://github.com/malu-code42/agent-office/pull/7', '--merge', `--match-head-commit=${SHA}`])
    expect(merge.join(' ')).not.toMatch(/delete-branch|--admin|--auto/)
  })

  it('não mescla se a conta não passa no portão (nem chega ao gh pr merge)', async () => {
    const { calls, deps: d } = deps({ owner: async () => Promise.reject(new Error('conta fora da lista')) })
    await expect(mergePullRequest('/repo', 7, SHA, d)).rejects.toThrow('conta fora da lista')
    expect(calls.some((c) => c[1] === 'merge')).toBe(false)
  })

  it('não mescla se o commit mudou depois do cartão, se o PR não está aberto ou se vem de fork', async () => {
    for (const [view, expected, text] of [
      [prJson({ headRefOid: OTHER_SHA }), SHA, /mudou depois/],
      [prJson({ state: 'MERGED' }), SHA, /não está aberto/],
      [prJson({ state: 'CLOSED' }), SHA, /não está aberto/],
      [prJson({ isCrossRepository: true }), SHA, /fork/],
      [prJson({ url: 'https://github.com/terceiro/outro/pull/7' }), SHA, /não é deste repositório/],
      [prJson({ number: 8 }), SHA, /não é deste repositório/],
      ['não é json', SHA, /ilegível/],
      [prJson(), 'curto', /inválido/],
    ] as const) {
      const { calls, deps: d } = deps({ view })
      await expect(mergePullRequest('/repo', 7, expected, d)).rejects.toThrow(text)
      expect(calls.some((c) => c[1] === 'merge')).toBe(false)
    }
  })

  it('só aceita número de PR inteiro e positivo', async () => {
    for (const n of [0, -1, 1.5, Number.NaN, 2 ** 60]) {
      const { calls, deps: d } = deps()
      await expect(inspectPullRequest('/repo', n, d)).rejects.toThrow(/inválido/)
      expect(calls).toHaveLength(0)
    }
  })
})

describe('MergeApprovals', () => {
  it('vale uma vez e expira em 10 minutos', () => {
    let t = 0
    const a = new MergeApprovals(() => t)
    a.grant('ag', 7, SHA)
    expect(a.take('ag', 8)).toBeUndefined()
    expect(a.take('outro', 7)).toBeUndefined()
    expect(a.take('ag', 7)).toBe(SHA)
    expect(a.take('ag', 7)).toBeUndefined()
    a.grant('ag', 7, SHA)
    t = 10 * 60_000 + 1
    expect(a.take('ag', 7)).toBeUndefined()
  })
})

// ---------- o cartão reforçado, no caminho real do agente ----------

type Ask = (agent: unknown, tool: string, input: Record<string, unknown>, opts: { signal: AbortSignal; agentID?: string }) => Promise<{ behavior: string; message?: string }>
const flush = () => new Promise<void>((r) => setTimeout(r, 10))

async function setup(ops?: Partial<NonNullable<InstanceType<typeof import('../src/main/agents').AgentManager>['mergeOps']>>) {
  queries.length = 0
  app.setPath('userData', mkdtempSync(join(tmpdir(), 'ao-merge-data-')))
  const dir = mkdtempSync(join(tmpdir(), 'ao-merge-proj-'))
  writeFileSync(join(dir, 'a.ts'), 'x')
  const { Store } = await import('../src/main/store')
  const { AgentManager } = await import('../src/main/agents')
  const store = new Store()
  store.settings = { ...store.settings, projects: [{ id: 'p1', name: 'T', cwd: dir }] as never }
  const m = new AgentManager(store)
  m.claudeHome = mkdtempSync(join(tmpdir(), 'ao-merge-claude-'))
  const calls = { merge: 0, gate: 0 }
  m.mergeOps = {
    inspect: async (_root, pr) => ({
      number: pr,
      url: `https://github.com/malu-code42/agent-office/pull/${pr}`,
      title: 'Corrige o tema',
      repository: 'malu-code42/agent-office',
      host: 'github.com',
      state: 'OPEN',
      head: 'agent/tema',
      base: 'main',
      sha: SHA,
    }),
    gate: async () => {
      calls.gate++
    },
    merge: async (_root, pr) => {
      calls.merge++
      return `https://github.com/malu-code42/agent-office/pull/${pr}`
    },
    ...ops,
  }
  const internals = m as unknown as { agents: Map<string, { summary: Record<string, unknown> }>; askPlayer: Ask; mergeApprovals: MergeApprovals }
  const emi = internals.agents.get(emiAgentId('p1'))!
  // O nível 5 exige cópia isolada (sem ela a Emi cai para 3, por desenho da parte 2).
  emi.summary.worktree = { path: dir, root: dir, repo: dir, branch: 'agent/emi', base: 'abc' }
  const fake = (summary: Record<string, unknown>) => ({ summary: { id: 'ag-1', name: 'Ada', cwd: dir, ...summary } })
  const ask = (agent: unknown, input: Record<string, unknown>, agentID?: string) =>
    internals.askPlayer.call(m, agent, MERGE_TOOL, input, { signal: new AbortController().signal, ...(agentID ? { agentID } : {}) })
  return { m, dir, emi, fake, ask, internals, calls }
}

describe('cartão reforçado do merge_pr', () => {
  beforeEach(() => {
    queries.length = 0
  })

  it('a Emi (nível 5) recebe um cartão com repositório, PR, branch, commit e a pergunta; nunca oferece "Sempre permitir"', async () => {
    const { m, emi, ask } = await setup()
    const answer = ask(emi, { pr: 7 })
    await flush()
    const card = m.pendingRequests().at(-1)!
    expect(card.toolName).toBe(MERGE_TOOL)
    expect(card.canAlwaysAllow).toBe(false)
    expect(card.title).toContain('#7')
    expect(card.detail).toContain('github.com/malu-code42/agent-office')
    expect(card.detail).toContain('agent/tema → main')
    expect(card.detail).toContain(SHA.slice(0, 10))
    expect(card.detail).toContain('Você pediu este merge?')
    m.respond({ requestId: card.id, behavior: 'allow_always' })
    await expect(answer).resolves.toMatchObject({ behavior: 'allow' })
    // "Sempre permitir" virou só uma aprovação, uma vez: nenhuma regra salva e a aprovação é de uso único.
    expect(m['store' as keyof typeof m]).toBeDefined()
    expect(((m as unknown as { store: { settings: { projects: { alwaysAllow?: unknown[] }[] } } }).store.settings.projects[0]!.alwaysAllow ?? [])).toHaveLength(0)
    const approvals = (m as unknown as { mergeApprovals: MergeApprovals }).mergeApprovals
    expect(approvals.take(emi.summary.id as string, 7)).toBe(SHA)
    expect(approvals.take(emi.summary.id as string, 7)).toBeUndefined()
    m.shutdown()
  })

  it('cada uso abre um cartão novo (duas chamadas, dois cartões)', async () => {
    const { m, emi, ask } = await setup()
    for (const pr of [7, 8]) {
      const before = m.pendingRequests().length
      const answer = ask(emi, { pr })
      await flush()
      expect(m.pendingRequests().length).toBe(before + 1)
      m.respond({ requestId: m.pendingRequests().at(-1)!.id, behavior: 'deny' })
      await expect(answer).resolves.toMatchObject({ behavior: 'deny' })
    }
    m.shutdown()
  })

  it('negar o cartão nega e não grava aprovação', async () => {
    const { m, emi, ask } = await setup()
    const answer = ask(emi, { pr: 7 })
    await flush()
    m.respond({ requestId: m.pendingRequests().at(-1)!.id, behavior: 'deny', message: 'não pedi' })
    await expect(answer).resolves.toMatchObject({ behavior: 'deny', message: 'não pedi' })
    expect((m as unknown as { mergeApprovals: MergeApprovals }).mergeApprovals.take(emi.summary.id as string, 7)).toBeUndefined()
    m.shutdown()
  })

  it('níveis 1 a 4, subagente e argumento fora do formato são negados sem cartão', async () => {
    const { m, dir, emi, fake, ask } = await setup()
    const wt = { path: dir, root: dir, repo: dir, branch: 'agent/ada', base: 'abc' }
    const agents = [
      fake({ permissionLevel: 4, permissionMode: 'auto', worktree: wt }),
      fake({ permissionLevel: 5, permissionMode: 'auto', worktree: wt }), // teto: só a Emi passa de 4
      fake({ permissionLevel: 3, permissionMode: 'default' }),
      fake({ permissionLevel: 2, permissionMode: 'plan' }),
      fake({ permissionLevel: 1, permissionMode: 'plan' }),
      fake({ squad: undefined, ticketId: 't1', worktree: wt }),
    ]
    for (const agent of agents) {
      const r = await ask(agent, { pr: 7 })
      expect(r.behavior).toBe('deny')
      expect(r.message).toMatch(/nível 5/)
    }
    expect(m.pendingRequests()).toHaveLength(0)
    expect((await ask(emi, { pr: 7 }, 'sub-1')).behavior).toBe('deny')
    for (const pr of ['7', 0, -3, 1.5, null, undefined, '7; rm -rf /', { n: 7 }]) {
      expect((await ask(emi, { pr })).behavior).toBe('deny')
    }
    m.shutdown()
  })

  it('PR fechado, conta fora da lista ou gh com erro: negado sem cartão', async () => {
    const closed = await setup({
      inspect: async (_r, pr) => ({
        number: pr,
        url: 'u',
        title: 't',
        repository: 'a/b',
        host: 'github.com',
        state: 'MERGED',
        head: 'h',
        base: 'main',
        sha: SHA,
      }),
    })
    expect((await closed.ask(closed.emi, { pr: 7 })).message).toMatch(/não está aberto/)
    expect(closed.m.pendingRequests()).toHaveLength(0)
    closed.m.shutdown()

    const gate = await setup({ gate: async () => Promise.reject(new Error('o gh está na conta "outra"')) })
    expect((await gate.ask(gate.emi, { pr: 7 })).message).toMatch(/outra/)
    expect(gate.m.pendingRequests()).toHaveLength(0)
    gate.m.shutdown()

    const broken = await setup({ inspect: async () => Promise.reject(new Error('sem rede')) })
    expect((await broken.ask(broken.emi, { pr: 7 })).behavior).toBe('deny')
    expect(broken.m.pendingRequests()).toHaveLength(0)
    broken.m.shutdown()
  })

  it('o terminal segue negado pelo piso, até para a Emi (nível 5)', async () => {
    const { m, emi, internals } = await setup()
    for (const command of ['gh pr merge 7', 'git merge main', 'gh api repos/a/b/pulls/7/merge -X PUT', 'git push origin main']) {
      const r = await internals.askPlayer.call(m, emi, 'Bash', { command }, { signal: new AbortController().signal })
      expect(r.behavior, command).toBe('deny')
    }
    m.shutdown()
  })

  it('o servidor merge só é montado no nível 5: avulso pedindo 5 fica em 4; a Emi com worktree é 5, sem worktree 3', async () => {
    const { m, dir, emi, fake } = await setup()
    const internals = m as unknown as { levelOf(agent: unknown): { level: number }; mergeToolsFor(agent: unknown): { name: string } }
    const wt = { path: dir, root: dir, repo: dir, branch: 'agent/ada', base: 'abc' }
    expect(internals.levelOf(fake({ permissionLevel: 5, permissionMode: 'auto', worktree: wt })).level).toBe(4)
    expect(internals.levelOf(emi).level).toBe(5)
    expect(internals.mergeToolsFor(emi).name).toBe('merge')
    delete emi.summary.worktree
    expect(internals.levelOf(emi).level).toBe(3)
    m.shutdown()
  })
})
