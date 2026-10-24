import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { Account, ProjectFloor, Settings } from '@shared/types'
import { DEFAULT_VIDEO, QUALITY_PRESETS } from '@shared/video'
import {
  assigneeSchema,
  attachmentsSchema,
  cleanAccountIds,
  cleanAccounts,
  cleanBrain,
  cleanDelegateTarget,
  cleanHire,
  cleanLedgerQuery,
  cleanProjects,
  cleanSettings,
  cleanVideo,
  checkedSquadMode,
  modeIsMorePermissive,
  externalUrlSchema,
  idSchema,
  irisAnswerSchema,
  mediaDraftSchema,
  mediaPosterTokenSchema,
  MAX_LOGO_CHARS,
  parse,
  permissionDecisionSchema,
  searchSchema,
  subagentLogArgsSchema,
  squadAdjustmentSchema,
  squadApprovalSchema,
  squadProposalRequestSchema,
  squadRenameSchema,
  ticketDraftSchema,
  ticketPatchSchema,
} from '../src/main/validate'

const dir = mkdtempSync(join(tmpdir(), 'ao-validate-'))
const other = mkdtempSync(join(tmpdir(), 'ao-validate-'))
afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
  rmSync(other, { recursive: true, force: true })
})

const main: Account = { id: 'main', name: 'Principal', provider: 'claude', color: '#e0894a' }
const work: Account = { id: 'a-1', name: 'Trabalho', provider: 'claude', color: '#4a8fe0', configDir: '/tmp/a-1' }
const accounts = [main, work]

const settings = (): Settings => ({
  playerName: 'Você',
  playerLook: { skin: '#f6d3b3', hair: '#2b1d16', hairStyle: 1, shirt: '#4a8fe0', pants: '#2f3b5c', shoes: '#1e1e24' },
  pixelSize: 3,
  defaultModel: '',
  defaultEngine: 'claude',
  defaultEffort: '',
  defaultPermissionMode: 'default',
  notifications: true,
  bridgePort: 47821,
  projects: [],
  accounts: [...accounts],
  defaultAccounts: [],
  ticketAutoCloseDays: 7,
  maxSubagents: 10,
  agentBudgetUsd: 0,
  templates: [],
  video: { ...DEFAULT_VIDEO },
})

describe('parse', () => {
  it('devolve o valor válido e lança a mensagem dada no inválido', () => {
    expect(parse(idSchema, 'abc', 'ruim')).toBe('abc')
    expect(() => parse(idSchema, '', 'ruim')).toThrow('ruim')
    expect(() => parse(idSchema, 42, 'ruim')).toThrow('ruim')
    expect(() => parse(idSchema, 'x'.repeat(201), 'ruim')).toThrow('ruim')
  })
})

describe('mediaPosterTokenSchema', () => {
  it('aceita somente token aleatório com formato limitado e recusa valores inválidos', () => {
    expect(mediaPosterTokenSchema.safeParse('a'.repeat(43)).success).toBe(true)
    expect(mediaPosterTokenSchema.safeParse('../poster.png').success).toBe(false)
    expect(mediaPosterTokenSchema.safeParse('a'.repeat(44)).success).toBe(false)
  })
})

describe('rascunho de mídia da Luna', () => {
  it.each(['livro', 'filme', 'jogo'])('aceita apenas tipo e título para %s', (kind) => {
    expect(mediaDraftSchema.safeParse({ kind, title: 'Título válido' }).success).toBe(true)
    expect(mediaDraftSchema.safeParse({ kind, title: 'Título válido', posterPath: 'x' }).success).toBe(false)
  })

  it('recusa tipo inválido, título vazio, multilinha ou longo demais', () => {
    expect(mediaDraftSchema.safeParse({ kind: 'tarefa', title: 'A' }).success).toBe(false)
    expect(mediaDraftSchema.safeParse({ kind: 'livro', title: '  ' }).success).toBe(false)
    expect(mediaDraftSchema.safeParse({ kind: 'livro', title: 'A\nB' }).success).toBe(false)
    expect(mediaDraftSchema.safeParse({ kind: 'livro', title: 'A'.repeat(201) }).success).toBe(false)
  })

  it('resposta Iris não aceita simultaneamente proposta, pergunta e rascunho', () => {
    expect(irisAnswerSchema.safeParse({ operations: [], question: null, mediaDraft: { kind: 'filme', title: 'Ran' } }).success).toBe(true)
    expect(
      irisAnswerSchema.safeParse({
        operations: [{ kind: 'focus', id: 'tabc123' }],
        question: null,
        mediaDraft: { kind: 'filme', title: 'Ran' },
      }).success,
    ).toBe(false)
  })
})

describe('subagentLogArgsSchema (getSubagentLog)', () => {
  it('dois ids válidos; o resto é recusado', () => {
    expect(parse(subagentLogArgsSchema, ['agente', 'task-1'], 'ruim')).toEqual(['agente', 'task-1'])
    expect(() => parse(subagentLogArgsSchema, ['agente'], 'ruim')).toThrow('ruim')
    expect(() => parse(subagentLogArgsSchema, ['agente', ''], 'ruim')).toThrow('ruim')
    expect(() => parse(subagentLogArgsSchema, ['agente', { id: 1 }], 'ruim')).toThrow('ruim')
    expect(() => parse(subagentLogArgsSchema, ['a', 'b', 'c'], 'ruim')).toThrow('ruim')
    expect(() => parse(subagentLogArgsSchema, ['a', 'x'.repeat(201)], 'ruim')).toThrow('ruim')
  })
})

describe('cleanBrain', () => {
  it('aceita modelo curto, esforço conhecido e contas que existem', () => {
    expect(cleanBrain({ model: 'opus', effort: 'high', accounts: ['a-1', 'a-1', 'nope'] }, accounts)).toEqual({
      model: 'opus',
      effort: 'high',
      accounts: ['a-1'],
    })
  })
  it('chave presente e inválida vira undefined (padrão do Claude Code)', () => {
    expect(cleanBrain({ model: 'rm -rf /', effort: 'turbo', accounts: 'main' }, accounts)).toEqual({
      model: undefined,
      effort: undefined,
      accounts: [],
    })
  })
  it('chaves ausentes ficam ausentes; lixo vira objeto vazio', () => {
    expect(cleanBrain({}, accounts)).toEqual({})
    expect(cleanBrain(null, accounts)).toEqual({})
    expect(cleanBrain('opus', accounts)).toEqual({})
  })
  it('aceita ids com contexto de 1M', () => {
    expect(cleanBrain({ model: 'claude-opus-5-5[1m]' }, accounts).model).toBe('claude-opus-5-5[1m]')
  })
})

describe('cleanAccountIds', () => {
  it('filtra tipos, ids desconhecidos e repetidos', () => {
    expect(cleanAccountIds(['main', 3, 'main', 'x', 'a-1'], accounts)).toEqual(['main', 'a-1'])
    expect(cleanAccountIds('main', accounts)).toEqual([])
  })
})

describe('cleanAccounts', () => {
  it('só muda nome, cor e ordem; ids e pastas vêm do main', () => {
    const out = cleanAccounts(
      [
        { id: 'a-1', name: '  Cliente  ', color: '#00ff00', configDir: '/etc', provider: 'evil' },
        { id: 'main', name: '', color: 'red' },
      ],
      accounts,
    )
    expect(out).toEqual([{ ...work, name: 'Cliente', color: '#00ff00' }, { ...main }])
  })
  it('ignora contas desconhecidas e repetidas, e nunca remove as que existem', () => {
    const out = cleanAccounts([{ id: 'ghost', name: 'x' }, { id: 'main', name: 'A' }, { id: 'main', name: 'B' }, 'lixo'], accounts)
    expect(out.map((a) => a.id)).toEqual(['main', 'a-1'])
    expect(out[0].name).toBe('A')
    expect(cleanAccounts(null, accounts)).toEqual(accounts)
  })
  it('corta nomes longos em 32', () => {
    expect(cleanAccounts([{ id: 'main', name: 'x'.repeat(100) }], accounts)[0].name).toHaveLength(32)
  })
})

describe('cleanProjects', () => {
  const png = 'data:image/png;base64,iVBORw0KGgo='
  it('aceita pastas que existem, um andar por pasta, com marca limpa', () => {
    const out = cleanProjects(
      [
        { id: 'p1', name: ' Loja ', cwd: dir, logo: png, brandColor: '#AABBCC', uniform: true },
        { id: 'p2', name: 'Repetida', cwd: dir },
        { id: 'p3', name: 'Some', cwd: join(dir, 'nao-existe') },
        { id: 'p4', name: 'Relativa', cwd: 'relativa' },
      ],
      [],
    )
    expect(out).toEqual([{ id: 'p1', name: 'Loja', cwd: dir, logo: png, brandColor: '#aabbcc', uniform: true }])
  })
  it('recusa SVG, logo gigante e cor fora do formato', () => {
    const svg = 'data:image/svg+xml;base64,PHN2Zz4='
    const big = 'data:image/png;base64,' + 'A'.repeat(MAX_LOGO_CHARS)
    const [p] = cleanProjects([{ id: 'p1', cwd: dir, logo: svg, brandColor: 'red', uniform: 'yes' }], [])
    expect(p).toEqual({ id: 'p1', name: expect.any(String), cwd: dir })
    expect(cleanProjects([{ id: 'p1', cwd: dir, logo: big }], [])[0].logo).toBeUndefined()
  })
  it('troca id inválido ou repetido e dá nome pela pasta', () => {
    const out = cleanProjects(
      [
        { id: '../x', cwd: dir },
        { id: 'same', cwd: other },
      ],
      [],
    )
    expect(out[0].id).toMatch(/^p-[0-9a-f]{8}$/)
    expect(out[0].name).toBeTruthy()
    const twice = cleanProjects(
      [
        { id: 'same', cwd: dir },
        { id: 'same', cwd: other },
      ],
      [],
    )
    expect(twice[0].id).toBe('same')
    expect(twice[1].id).not.toBe('same')
  })
  it('mantém as contas do andar que já existia, nunca as do formulário', () => {
    const previous: ProjectFloor[] = [{ id: 'p1', name: 'Loja', cwd: dir, accounts: ['a-1'] }]
    const [p] = cleanProjects([{ id: 'p1', name: 'Loja', cwd: dir, accounts: ['main'] }], previous)
    expect(p.accounts).toEqual(['a-1'])
  })
  it('para no limite de andares e aceita lixo sem lançar', () => {
    const many = Array.from({ length: 10 }, () => ({ cwd: mkdtempSync(join(dir, 'f-')) }))
    expect(cleanProjects(many, [])).toHaveLength(6)
    expect(cleanProjects('lixo', [])).toEqual([])
    expect(cleanProjects([null, 3], [])).toEqual([])
  })
  it('guarda o modo do andar; fora da lista mantém o que já existia', () => {
    const previous: ProjectFloor[] = [{ id: 'p1', name: 'Loja', cwd: dir, permissionMode: 'auto' }]
    expect(cleanProjects([{ id: 'p1', name: 'Loja', cwd: dir, permissionMode: 'auto' }], previous)[0].permissionMode).toBe('auto')
    expect(cleanProjects([{ id: 'p2', name: 'Novo', cwd: other, permissionMode: 'plan' }], [])[0].permissionMode).toBe('plan')
    // O formulário pode mandar o modo inválido (ou nem mandar): o andar mantém o seu.
    expect(cleanProjects([{ id: 'p1', name: 'Loja', cwd: dir, permissionMode: 'raiz' }], previous)[0].permissionMode).toBe('auto')
    expect(cleanProjects([{ id: 'p1', name: 'Loja', cwd: dir }], previous)[0].permissionMode).toBe('auto')
    const [semPrev] = cleanProjects([{ id: 'p3', name: 'X', cwd: other, permissionMode: 'raiz' }], [])
    expect('permissionMode' in semPrev).toBe(false)
  })
  it('não transfere o modo nem as permissões salvas quando um id de andar muda de pasta', () => {
    const previous: ProjectFloor[] = [
      { id: 'p1', name: 'Loja', cwd: dir, permissionMode: 'auto', alwaysAllow: [{ id: 'r1', kind: 'tool', value: 'Read' }] },
    ]
    const [moved] = cleanProjects([{ id: 'p1', name: 'Outro', cwd: other }], previous)
    expect('permissionMode' in moved).toBe(false)
    expect('alwaysAllow' in moved).toBe(false)
  })
  it('guarda, limpa e dedupe as regras "Sempre permitir"; apagar manda lista vazia', () => {
    // Sem a chave no patch, o andar mantém as regras que já tinha.
    const previous: ProjectFloor[] = [{ id: 'p1', name: 'Loja', cwd: dir, alwaysAllow: [{ id: 'r1', kind: 'tool', value: 'Read' }] }]
    expect(cleanProjects([{ id: 'p1', name: 'Loja', cwd: dir }], previous)[0].alwaysAllow).toEqual([
      { id: 'r1', kind: 'tool', value: 'Read' },
    ])
    // Com a chave (o formulário manda sempre, com ou sem regras), o lixo sai e a lista vazia vale.
    const out = cleanProjects(
      [
        {
          id: 'p2',
          name: 'Novo',
          cwd: other,
          alwaysAllow: [
            { id: 'a', kind: 'command', value: ' npm test ' },
            { kind: 'tool', value: 'Read' },
            { id: 'b', kind: 'destrua', value: 'Read' },
            { id: 'c', kind: 'tool', value: '   ' },
            { id: 'a', kind: 'command', value: 'npm test' },
            'lixo',
          ],
        },
      ],
      [],
    )
    expect(out[0].alwaysAllow).toEqual([
      { id: 'a', createdAt: expect.any(Number), kind: 'command', value: 'npm test' },
      { id: expect.any(String), createdAt: expect.any(Number), kind: 'tool', value: 'Read' },
    ])
    expect(cleanProjects([{ id: 'p2', name: 'Novo', cwd: other, alwaysAllow: [] }], [])[0].alwaysAllow ?? []).toEqual([])
  })
  it('limpa as "Sempre permitir" do andar que já existia: zerar é zerar', () => {
    const previous: ProjectFloor[] = [
      {
        id: 'p1',
        name: 'Loja',
        cwd: dir,
        alwaysAllow: [
          { id: 'r1', kind: 'tool', value: 'Read' },
          { id: 'r2', kind: 'command', value: 'ls' },
        ],
      },
    ]
    const [p] = cleanProjects(
      [{ id: 'p1', name: 'Loja', cwd: dir, alwaysAllow: [{ id: 'r2', kind: 'command', value: 'ls' }, 'lixo'] }],
      previous,
    )
    expect(p.alwaysAllow).toEqual([{ id: 'r2', createdAt: expect.any(Number), kind: 'command', value: 'ls' }])
  })
})

describe('cleanLedgerQuery', () => {
  it('mantém só dias YYYY-MM-DD e pasta absoluta', () => {
    expect(cleanLedgerQuery({ from: '2026-10-01', to: '2026-10-12', cwd: '/proj', extra: 1 })).toEqual({
      from: '2026-10-01',
      to: '2026-10-12',
      cwd: '/proj',
    })
    expect(cleanLedgerQuery({ from: 'ontem', to: 20261012, cwd: 'rel' })).toEqual({})
    expect(cleanLedgerQuery(undefined)).toEqual({})
  })
})

describe('cleanHire', () => {
  const s = settings()
  it('permissionMode inválido cai no padrão do escritório', () => {
    const r = cleanHire({ name: 'Ana', cwd: dir, task: 'faz', permissionMode: 'rootMode' }, { ...s, defaultPermissionMode: 'plan' })
    expect(r.permissionMode).toBe('plan')
    expect(cleanHire({ cwd: dir, task: 'faz' }, s).permissionMode).toBe('default')
  })
  it('sempre usa Claude, mesmo se um cliente antigo pedir OpenCode', () => {
    const legacy = { ...s, defaultEngine: 'claude' as const }
    expect(cleanHire({ cwd: dir, task: 'faz' }, legacy).engine).toBe('claude')
    expect(cleanHire({ cwd: dir, task: 'faz', engine: 'opencode' }, legacy).engine).toBe('claude')
    expect(cleanHire({ cwd: dir, task: 'faz', engine: 'desconhecido' }, legacy).engine).toBe('claude')
    expect(cleanHire({ cwd: dir, task: 'faz', engine: 'opencode', accounts: ['main'] }, legacy).accounts).toEqual(['main'])
  })
  it('override mais permissivo exige confirmação explícita; restrição não', () => {
    expect(() => cleanHire({ cwd: dir, task: 'faz', permissionMode: 'acceptEdits' }, s)).toThrow(/Confirme explicitamente/)
    expect(cleanHire({ cwd: dir, task: 'faz', permissionMode: 'acceptEdits', confirmPermissionOverride: true }, s).permissionMode).toBe(
      'acceptEdits',
    )
    expect(cleanHire({ cwd: dir, task: 'faz', permissionMode: 'plan' }, s).permissionMode).toBe('plan')
  })
  it('herda o modo do andar do projeto quando não há modo escolhido', () => {
    const comAndar = { ...s, projects: [{ id: 'p1', name: 'Loja', cwd: dir, permissionMode: 'plan' as const }] }
    // Sem modo no pedido: o modo do andar. Modo inválido: cai no andar, não no global.
    expect(cleanHire({ cwd: dir, task: 'faz' }, comAndar).permissionMode).toBe('plan')
    expect(cleanHire({ cwd: dir, task: 'faz', permissionMode: 'rootMode' }, comAndar).permissionMode).toBe('plan')
    // Andar sem modo próprio: o padrão do escritório.
    const andarSemModo = { ...s, projects: [{ id: 'p1', name: 'Loja', cwd: dir }], defaultPermissionMode: 'acceptEdits' as const }
    expect(cleanHire({ cwd: dir, task: 'faz' }, andarSemModo).permissionMode).toBe('acceptEdits')
    // Pasta de fora: o padrão do escritório continua.
    expect(cleanHire({ cwd: other, task: 'faz' }, comAndar).permissionMode).toBe('default')
  })
  it('recusa pasta que não existe e tarefa vazia', () => {
    expect(() => cleanHire({ cwd: join(dir, 'nada'), task: 'x' }, s)).toThrow('Escolha uma pasta')
    expect(() => cleanHire({ cwd: 42, task: 'x' }, s)).toThrow('Escolha uma pasta')
    expect(() => cleanHire(null, s)).toThrow('Escolha uma pasta')
    expect(() => cleanHire({ cwd: dir, task: '   ' }, s)).toThrow('Descreva a tarefa')
    expect(() => cleanHire({ cwd: dir, task: ['x'] }, s)).toThrow('Descreva a tarefa')
  })
  it('corta o nome, limpa o cérebro e descarta chaves extras', () => {
    const r = cleanHire({ name: 'x'.repeat(100), cwd: dir, task: 't', model: 'opus', accounts: ['ghost'], evil: true }, s)
    expect(r).toEqual({
      name: 'x'.repeat(40),
      cwd: dir,
      task: 't',
      model: 'opus',
      accounts: [],
      engine: 'claude',
      permissionMode: 'default',
      worktree: undefined,
    })
    expect(cleanHire({ name: 7, cwd: dir, task: 't' }, s).name).toBe('')
  })
})

describe('cleanDelegateTarget', () => {
  it('agente existente: só o id', () => {
    expect(cleanDelegateTarget({ agentId: 'ag-1', hire: { permissionMode: 'bypassPermissions' } }, accounts)).toEqual({
      agentId: 'ag-1',
      confirmPermissionOverride: false,
    })
    expect(() => cleanDelegateTarget({ agentId: {} }, accounts)).toThrow('Agente inválido')
  })
  it('preserva modo delegado, sem downgrade silencioso; tickets validam o bypass no servidor', () => {
    expect(cleanDelegateTarget({ hire: { permissionMode: 'bypassPermissions', model: 'opus' } }, accounts)).toEqual({
      hire: { model: 'opus', engine: 'claude', permissionMode: 'bypassPermissions', confirmPermissionOverride: false, worktree: undefined },
    })
    expect(cleanDelegateTarget({ hire: { permissionMode: 'auto' } }, accounts)).toEqual({
      hire: { engine: 'claude', permissionMode: 'auto', confirmPermissionOverride: false, worktree: undefined },
    })
    expect(cleanDelegateTarget(undefined, accounts)).toEqual({
      hire: { engine: 'claude', permissionMode: undefined, confirmPermissionOverride: false, worktree: undefined },
    })
  })
  it('compara override conservador e nunca permite bypass em squad', () => {
    expect(modeIsMorePermissive('plan', 'default')).toBe(false)
    expect(modeIsMorePermissive('auto', 'default')).toBe(true)
    expect(checkedSquadMode('plan', 'default')).toBe('plan')
    expect(() => checkedSquadMode('bypassPermissions', 'default', true)).toThrow(/Squads nunca/)
    expect(() => checkedSquadMode('auto', 'default')).toThrow(/Confirme explicitamente/)
    expect(checkedSquadMode('auto', 'default', true)).toBe('auto')
  })
})

describe('cleanSettings', () => {
  it('ignora chaves desconhecidas e nunca muda a porta da ponte', () => {
    const out = cleanSettings({ evil: '<script>', bridgePort: 1, __proto__: { playerName: 'Herdado' } }, settings())
    expect(out).toEqual(settings())
    expect('evil' in out).toBe(false)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
  it('fixa Claude como único motor padrão', () => {
    expect(cleanSettings({ defaultEngine: 'opencode' }, settings()).defaultEngine).toBe('claude')
    expect(cleanSettings({ defaultEngine: 'desconhecido' }, settings()).defaultEngine).toBe('claude')
  })
  it('aplica campos válidos', () => {
    const out = cleanSettings(
      {
        playerName: '  Allef ',
        pixelSize: 4,
        defaultModel: 'sonnet',
        defaultEffort: 'max',
        defaultPermissionMode: 'auto',
        notifications: false,
        ticketAutoCloseDays: '14',
        maxSubagents: 0,
        agentBudgetUsd: 12.345,
      },
      settings(),
    )
    expect(out).toMatchObject({
      playerName: 'Allef',
      pixelSize: 4,
      defaultModel: 'sonnet',
      defaultEffort: 'max',
      defaultPermissionMode: 'auto',
      notifications: false,
      ticketAutoCloseDays: 14,
      maxSubagents: 0,
      agentBudgetUsd: 12.35,
    })
  })
  it('não permite que um patch genérico escolha o caminho do vault', () => {
    const current = { ...settings(), vaultPath: dir }
    expect(cleanSettings({ vaultPath: dir }, settings()).vaultPath).toBeUndefined()
    expect(cleanSettings({ vaultPath: 'C:/renderer-path' }, current).vaultPath).toBe(dir)
  })
  it('campo com tipo ou tamanho errado mantém o valor atual', () => {
    const before = settings()
    const out = cleanSettings(
      {
        playerName: 'x'.repeat(33),
        pixelSize: 99,
        defaultModel: 'a b',
        defaultEffort: 'ultra',
        defaultPermissionMode: 'god',
        notifications: 'sim',
        ticketAutoCloseDays: 1.5,
        maxSubagents: 101,
        agentBudgetUsd: -1,
        playerLook: { ...before.playerLook, shirt: 'url(javascript:1)' },
      },
      before,
    )
    expect(out).toEqual(before)
  })
  it('números: null, vazio, lista e booleano mantêm o valor atual (AO-44)', () => {
    const before = { ...settings(), ticketAutoCloseDays: 7, maxSubagents: 10, agentBudgetUsd: 5 }
    for (const bad of [null, '', '  ', [], [3], true, false, {}, '1e3', '-1', 'abc', Number.NaN, Infinity]) {
      const out = cleanSettings({ ticketAutoCloseDays: bad, maxSubagents: bad, agentBudgetUsd: bad }, before)
      expect([out.ticketAutoCloseDays, out.maxSubagents, out.agentBudgetUsd], String(bad)).toEqual([7, 10, 5])
    }
    // 0 is a real choice (auto-close off, no subagents, no budget), and the input's string works too
    expect(cleanSettings({ ticketAutoCloseDays: 0, maxSubagents: ' 3 ', agentBudgetUsd: '2.5' }, before)).toMatchObject({
      ticketAutoCloseDays: 0,
      maxSubagents: 3,
      agentBudgetUsd: 2.5,
    })
  })
  it('video: aplica os campos válidos e mantém os inválidos', () => {
    const out = cleanSettings({ video: { ...QUALITY_PRESETS.saver, batterySaver: false } }, settings())
    expect(out.video).toEqual({ ...QUALITY_PRESETS.saver, batterySaver: false })
    const bad = cleanSettings(
      { video: { shadows: 'sim', shadowMapSize: 4096, fpsLimit: 144, effects: 'none', batterySaver: 1, evil: '<x>' } },
      settings(),
    )
    expect(bad.video).toEqual(DEFAULT_VIDEO)
    expect(cleanSettings({ video: 'alta' }, settings()).video).toEqual(DEFAULT_VIDEO)
  })
  it('cleanVideo: cada campo vale sozinho; sem limite = 0', () => {
    expect(cleanVideo({ fpsLimit: 0, shadowMapSize: 1024 }, DEFAULT_VIDEO)).toEqual({ ...DEFAULT_VIDEO, fpsLimit: 0, shadowMapSize: 1024 })
    expect(cleanVideo({ fpsLimit: '30' }, DEFAULT_VIDEO).fpsLimit).toBe(DEFAULT_VIDEO.fpsLimit)
    expect(cleanVideo(null, DEFAULT_VIDEO)).toEqual(DEFAULT_VIDEO)
  })
  it('updateChannel: só estável ou beta', () => {
    expect(cleanSettings({ updateChannel: 'beta' }, settings()).updateChannel).toBe('beta')
    expect(cleanSettings({ updateChannel: 'nightly' }, settings()).updateChannel).toBe(settings().updateChannel)
  })
  it('playerLook: valida cores e corte, descarta chaves extras', () => {
    const look = { skin: '#000000', hair: '#111111', hairStyle: 5, shirt: '#222222', pants: '#333333', shoes: '#444444', extra: 'x' }
    const { extra: _extra, ...clean } = look
    expect(cleanSettings({ playerLook: look }, settings()).playerLook).toEqual(clean)
    expect(cleanSettings({ playerLook: { ...look, hairStyle: 6 } }, settings()).playerLook).toEqual(settings().playerLook)
  })
  it('playerName vazio mantém o atual; modelo e esforço vazios são o padrão', () => {
    const cur = { ...settings(), defaultModel: 'opus', defaultEffort: 'high' as const }
    const out = cleanSettings({ playerName: '   ', defaultModel: '', defaultEffort: '' }, cur)
    expect(out.playerName).toBe('Você')
    expect(out.defaultModel).toBe('')
    expect(out.defaultEffort).toBe('')
  })
  it('contas, contas padrão e andares passam pelos limpadores', () => {
    const out = cleanSettings(
      {
        accounts: [{ id: 'a-1', name: 'Novo' }],
        defaultAccounts: ['a-1', 'ghost'],
        projects: [{ id: 'p1', name: 'Loja', cwd: dir }, { cwd: '/nao/existe' }],
      },
      settings(),
    )
    expect(out.accounts.map((a) => [a.id, a.name])).toEqual([
      ['a-1', 'Novo'],
      ['main', 'Principal'],
    ])
    expect(out.defaultAccounts).toEqual(['a-1'])
    expect(out.projects).toEqual([{ id: 'p1', name: 'Loja', cwd: dir }])
  })
  it('patch que não é objeto não muda nada', () => {
    expect(cleanSettings(null, settings())).toEqual(settings())
    expect(cleanSettings('x', settings())).toEqual(settings())
  })
})

describe('schemas do IPC', () => {
  it('PermissionDecision: comportamento conhecido, sem chaves extras', () => {
    const ok = permissionDecisionSchema.parse({ requestId: 'r1', behavior: 'allow', answers: { 'Qual?': 'A' }, evil: 1 })
    expect(ok).toEqual({ requestId: 'r1', behavior: 'allow', answers: { 'Qual?': 'A' } })
    expect(permissionDecisionSchema.safeParse({ requestId: 'r1', behavior: 'sudo' }).success).toBe(false)
    expect(permissionDecisionSchema.safeParse({ requestId: '', behavior: 'deny' }).success).toBe(false)
    expect(permissionDecisionSchema.safeParse({ requestId: 'r1', behavior: 'deny', message: 'x'.repeat(10_001) }).success).toBe(false)
    const many = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`q${i}`, 'a']))
    expect(permissionDecisionSchema.safeParse({ requestId: 'r1', behavior: 'allow', answers: many }).success).toBe(false)
  })
  it('TicketDraft: exige título, aceita nulos, descarta chaves extras', () => {
    const d = ticketDraftSchema.parse({
      title: 'T',
      cwd: null,
      estimate: null,
      dueDate: null,
      acceptance: [{ text: 'a' }],
      key: 'AO-1',
      id: 'x',
    })
    expect(d).toEqual({ title: 'T', cwd: null, estimate: null, dueDate: null, acceptance: [{ text: 'a', done: false }] })
    expect(ticketDraftSchema.safeParse({}).success).toBe(false)
    expect(ticketDraftSchema.safeParse({ title: 'T', type: 'epic' }).success).toBe(false)
    expect(ticketDraftSchema.safeParse({ title: 'T', tags: 'a,b' }).success).toBe(false)
    expect(ticketDraftSchema.safeParse({ title: 'T', description: 'x'.repeat(100_001) }).success).toBe(false)
    expect(ticketDraftSchema.parse({ title: 'T', estimate: Number.NaN }).estimate).toBeNull()
  })
  it('TicketPatch: tudo opcional', () => {
    expect(ticketPatchSchema.parse({})).toEqual({})
    expect(ticketPatchSchema.parse({ status: 'review', reporter: { name: 'x' } })).toEqual({ status: 'review' })
    expect(ticketPatchSchema.safeParse({ status: 'archived' }).success).toBe(false)
  })
  it('anexos: forma conhecida e tamanho limitado', () => {
    expect(attachmentsSchema.parse([{ name: 'a.png', dataBase64: 'AAAA', other: 1 }])).toEqual([{ name: 'a.png', dataBase64: 'AAAA' }])
    expect(attachmentsSchema.safeParse([{ path: '/x' }]).success).toBe(false)
    expect(attachmentsSchema.safeParse('x').success).toBe(false)
  })
  it('links externos só http(s)', () => {
    expect(externalUrlSchema.safeParse('https://claude.ai').success).toBe(true)
    expect(externalUrlSchema.safeParse('file:///etc/passwd').success).toBe(false)
    expect(externalUrlSchema.safeParse('javascript:alert(1)').success).toBe(false)
  })
  it('busca e responsável toleram lixo', () => {
    expect(searchSchema.parse(42)).toBeUndefined()
    expect(searchSchema.parse('ao-1')).toBe('ao-1')
    expect(assigneeSchema.parse(null)).toBeNull()
    expect(assigneeSchema.parse(undefined)).toBeUndefined()
    expect(assigneeSchema.safeParse('admin').success).toBe(false)
  })
})

describe('a proposta de um squad', () => {
  it('aceita o andar, a sala, o brief e os tickets', () => {
    const parsed = squadProposalRequestSchema.parse({
      id: 'proposta-1',
      projectId: 'p1',
      room: 2,
      brief: '  Refazer a busca  ',
      ticketIds: ['t1'],
    })
    expect(parsed.brief).toBe('Refazer a busca')
    expect(parsed.room).toBe(2)
    expect(parsed.ticketIds).toEqual(['t1'])
  })
  it('recusa uma sala fora do andar e um brief vazio', () => {
    expect(squadProposalRequestSchema.safeParse({ id: 'proposta-1', projectId: 'p1', room: 3, brief: 'x' }).success).toBe(false)
    expect(squadProposalRequestSchema.safeParse({ id: 'proposta-1', projectId: 'p1', room: 0, brief: '  ' }).success).toBe(false)
  })
  it('recusa um id que não serve para um arquivo', () => {
    expect(squadProposalRequestSchema.safeParse({ id: '../fora', projectId: 'p1', room: 0, brief: 'x' }).success).toBe(false)
    expect(squadProposalRequestSchema.safeParse({ id: 'a b', projectId: 'p1', room: 0, brief: 'x' }).success).toBe(false)
  })
  it('o ajuste e a aprovação são validados', () => {
    expect(squadAdjustmentSchema.safeParse({ id: 'proposta-1', adjustment: 'mais um testador' }).success).toBe(true)
    expect(squadAdjustmentSchema.safeParse({ id: 'proposta-1', adjustment: '  ' }).success).toBe(false)
    expect(squadApprovalSchema.safeParse({ id: 'proposta-1', name: 'Equipe' }).success).toBe(true)
    expect(squadApprovalSchema.safeParse({ id: 'proposta-1', name: '' }).success).toBe(false)
  })
  it('o ajuste leva o nome editado, e ele nunca é vazio', () => {
    expect(squadAdjustmentSchema.safeParse({ id: 'proposta-1', adjustment: 'mais um testador', name: 'Equipe' }).success).toBe(true)
    expect(squadAdjustmentSchema.safeParse({ id: 'proposta-1', adjustment: 'mais um testador', name: '  ' }).success).toBe(false)
    expect(squadAdjustmentSchema.safeParse({ id: 'proposta-1', adjustment: 'mais um testador' }).success).toBe(true)
  })
  it('o nome da proposta é validado', () => {
    expect(squadRenameSchema.safeParse({ id: 'proposta-1', name: 'Equipe da busca' }).success).toBe(true)
    expect(squadRenameSchema.safeParse({ id: 'proposta-1', name: '  ' }).success).toBe(false)
    expect(squadRenameSchema.safeParse({ id: 'proposta-1', name: 'x'.repeat(61) }).success).toBe(false)
  })
})
