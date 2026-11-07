import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SQUAD_PHASE_FILE, SquadPhaseStore, createPhaseRecorder, decideResume, resumeNote, resumeSquads, squadPhaseOf, type ResumeFacts } from '../src/main/squad-phase'
import type { SquadPhaseRecord, SquadProgress } from '../src/shared/types'

// AO-100: a fase de cada ciclo de squad em disco, para o squad voltar sozinho ao reabrir o app.

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ao-squad-phase-'))
})

const members = [
  { id: 'builder', role: 'implementer' as const },
  { id: 'reviewer', role: 'reviewer' as const },
  { id: 'qa', role: 'tester' as const },
]
const step = (agent: string, over: Partial<SquadProgress> = {}): SquadProgress => ({
  current: 2,
  total: 4,
  label: 'Passo',
  status: 'running',
  type: 'agent',
  agent,
  ...over,
})
const rec = (over: Partial<SquadPhaseRecord> = {}): SquadPhaseRecord => ({
  code: 'sala-1',
  ticketId: 't1',
  ticketKey: 'AO-1',
  phase: 'implementando',
  round: 0,
  member: 'builder',
  updatedAt: 1000,
  ...over,
})
const facts = (over: Partial<ResumeFacts> = {}): ResumeFacts => ({
  active: 't1',
  ticket: { id: 't1', key: 'AO-1', status: 'doing', assignee: 'squad:sala-1' },
  ...over,
})

describe('a fase vinda do passo e do estado', () => {
  it('lê a fase do papel do membro do passo', () => {
    expect(squadPhaseOf(step('builder'), 'working', members)).toBe('implementando')
    expect(squadPhaseOf(step('reviewer'), 'working', members)).toBe('revisando')
    expect(squadPhaseOf(step('qa'), 'working', members)).toBe('testando')
    expect(squadPhaseOf(step('outro'), 'working', members)).toBe('trabalhando')
    expect(squadPhaseOf(undefined, 'starting', members)).toBe('iniciando')
  })
  it('espera a usuária no checkpoint e quando o agente pede decisão', () => {
    expect(squadPhaseOf(step('builder', { type: 'checkpoint' }), 'working', members)).toBe('aguardando')
    expect(squadPhaseOf(step('builder'), 'waiting', members)).toBe('aguardando')
  })
  it('conclui quando o turno acabou; parado ou ocioso não muda nada', () => {
    expect(squadPhaseOf(step('builder'), 'done', members)).toBe('concluido')
    expect(squadPhaseOf(step('builder', { status: 'completed' }), 'working', members)).toBe('concluido')
    expect(squadPhaseOf(step('builder'), 'stopped', members)).toBeUndefined()
    expect(squadPhaseOf(step('builder'), 'idle', members)).toBeUndefined()
  })
})

describe('guardar a fase (critério 1)', () => {
  it('grava squad, ticket, fase, rodada, membro e hora, e sobrevive a reabrir', () => {
    const store = new SquadPhaseStore(dir, () => 5000)
    store.record({ code: 'sala-1', ticketId: 't1', ticketKey: 'AO-1', phase: 'implementando', member: 'builder', step: 'Código' })
    const onDisk = JSON.parse(readFileSync(join(dir, SQUAD_PHASE_FILE), 'utf8'))
    expect(onDisk.phases['sala-1']).toEqual({
      code: 'sala-1',
      ticketId: 't1',
      ticketKey: 'AO-1',
      phase: 'implementando',
      round: 0,
      member: 'builder',
      step: 'Código',
      updatedAt: 5000,
    })
    expect(new SquadPhaseStore(dir).get('sala-1')?.phase).toBe('implementando')
  })
  it('grava de forma atômica: nenhum arquivo temporário sobra', () => {
    const store = new SquadPhaseStore(dir)
    store.record({ code: 'sala-1', ticketId: 't1', phase: 'revisando' })
    store.record({ code: 'sala-1', ticketId: 't1', phase: 'testando' })
    expect(readdirSync(dir).filter((f) => f.includes('.tmp'))).toEqual([])
    expect(readdirSync(dir)).toContain(SQUAD_PHASE_FILE)
  })
  it('conta a rodada de revisão e recomeça em outro ticket; sem mudança não regrava', () => {
    const store = new SquadPhaseStore(dir)
    store.record({ code: 'c', ticketId: 't1', phase: 'implementando' })
    expect(store.record({ code: 'c', ticketId: 't1', phase: 'revisando' }).round).toBe(1)
    expect(store.record({ code: 'c', ticketId: 't1', phase: 'revisando' }).round).toBe(1)
    store.record({ code: 'c', ticketId: 't1', phase: 'implementando' })
    expect(store.record({ code: 'c', ticketId: 't1', phase: 'revisando' }).round).toBe(2)
    expect(store.record({ code: 'c', ticketId: 't2', phase: 'implementando' }).round).toBe(0)
  })
  it('clear tira o registro do disco', () => {
    const store = new SquadPhaseStore(dir)
    store.record({ code: 'c', ticketId: 't1', phase: 'testando' })
    store.clear('c')
    expect(new SquadPhaseStore(dir).all()).toEqual([])
  })
})

describe('dados ruins ou antigos (critério 4 e compatibilidade)', () => {
  it('sem o arquivo, abre vazio sem erro', () => {
    expect(new SquadPhaseStore(dir).all()).toEqual([])
  })
  it('arquivo cortado não trava o app', () => {
    writeFileSync(join(dir, SQUAD_PHASE_FILE), '{"phases": {"sala-1": ')
    expect(() => new SquadPhaseStore(dir)).not.toThrow()
    expect(new SquadPhaseStore(dir).all()).toEqual([])
  })
  it('descarta só o registro fora do formato e guarda o resto', () => {
    writeFileSync(
      join(dir, SQUAD_PHASE_FILE),
      JSON.stringify({ phases: { bom: rec({ code: 'bom' }), ruim: { code: 'ruim', phase: 'dancando' }, nulo: null, outro: rec({ code: 'x' }) } }),
    )
    const store = new SquadPhaseStore(dir)
    expect(store.all().map((r) => r.code)).toEqual(['bom'])
    expect(readdirSync(dir).length).toBeGreaterThan(1)
  })
})

describe('quem volta sozinho (critério 3 e 4)', () => {
  it('volta o que estava rodando', () => {
    for (const phase of ['iniciando', 'implementando', 'revisando', 'testando', 'trabalhando'] as const)
      expect(decideResume(rec({ phase }), facts()).action).toBe('resume')
  })
  it('concluído e aguardando a usuária não voltam', () => {
    expect(decideResume(rec({ phase: 'concluido' }), facts()).action).toBe('skip')
    expect(decideResume(rec({ phase: 'aguardando' }), facts()).action).toBe('skip')
  })
  it('pausado e desativado não voltam', () => {
    expect(decideResume(rec(), facts({ state: 'paused' })).action).toBe('skip')
    expect(decideResume(rec(), facts({ state: 'disabled' })).action).toBe('skip')
  })
  it('ticket que saiu de fazendo, fechado, de outro squad ou que não é o ativo é descartado', () => {
    const t = (over: object) => ({ ...facts().ticket!, ...over })
    expect(decideResume(rec(), facts({ ticket: t({ status: 'review' }) })).action).toBe('discard')
    expect(decideResume(rec(), facts({ ticket: t({ status: 'done' }) })).action).toBe('discard')
    expect(decideResume(rec(), facts({ ticket: t({ closedAt: 1 }) })).action).toBe('discard')
    expect(decideResume(rec(), facts({ ticket: t({ assignee: 'squad:outro' }) })).action).toBe('discard')
    expect(decideResume(rec(), facts({ ticket: undefined })).action).toBe('discard')
    expect(decideResume(rec(), facts({ active: 't9' })).action).toBe('discard')
  })
  it('a nota diz a fase, a rodada, o membro e de onde continua', () => {
    const note = resumeNote(rec({ phase: 'revisando', round: 2, step: 'Revisão' }), [{ id: 'builder', name: 'Bia' }])
    expect(note).toContain('revisando')
    expect(note).toContain('rodada de revisão 2')
    expect(note).toContain('Bia')
    expect(note).toContain('Revisão')
    expect(note).toContain('squads/sala-1/state.json')
  })
})

describe('retomar ao reabrir o app (critérios 2, 3, 4 e 5)', () => {
  const run = (records: SquadPhaseRecord[], f: (code: string) => ResumeFacts = () => facts()) => {
    const starts: { code: string; note: string }[] = []
    const discarded: string[] = []
    const warn = vi.fn()
    const deps = {
      records: () => records,
      facts: f,
      discard: (c: string) => discarded.push(c),
      start: async (code: string, r: { note: string }) => {
        starts.push({ code, note: r.note })
        await Promise.resolve()
      },
      warn,
    }
    return { deps, starts, discarded, warn }
  }
  const doing = (code: string, over: Partial<ResumeFacts> = {}): ResumeFacts =>
    facts({ ticket: { id: 't1', key: 'AO-1', status: 'doing', assignee: `squad:${code}` }, ...over })

  it('reinício simulado: grava, reabre o disco e retoma na fase guardada com a nota', async () => {
    new SquadPhaseStore(dir).record({ code: 'sala-1', ticketId: 't1', ticketKey: 'AO-1', phase: 'revisando', member: 'reviewer' })
    const r = run(new SquadPhaseStore(dir).all())
    expect(await resumeSquads(r.deps)).toEqual(['sala-1'])
    expect(r.starts).toHaveLength(1)
    expect(r.starts[0].note).toContain('revisando')
  })
  it('não retoma concluído, aguardando, pausado nem desativado', async () => {
    const r = run([rec({ code: 'a', phase: 'concluido' }), rec({ code: 'b', phase: 'aguardando' })], (code) => doing(code))
    expect(await resumeSquads(r.deps)).toEqual([])
    const p = run([rec({ code: 'p' }), rec({ code: 'd' })], (code) => doing(code, { state: code === 'p' ? 'paused' : 'disabled' }))
    expect(await resumeSquads(p.deps)).toEqual([])
    expect(r.starts).toEqual([])
    expect(p.starts).toEqual([])
  })
  it('descarta com aviso o registro de ticket que saiu de fazendo, sem lançar', async () => {
    const r = run([rec()], () => facts({ ticket: { id: 't1', key: 'AO-1', status: 'review', assignee: 'squad:sala-1' } }))
    await expect(resumeSquads(r.deps)).resolves.toEqual([])
    expect(r.discarded).toEqual(['sala-1'])
    expect(r.warn).toHaveBeenCalledWith(expect.stringContaining('descartada'))
  })
  it('falha ao iniciar vira aviso, não derruba o app', async () => {
    const r = run([rec()])
    r.deps.start = () => Promise.reject(new Error('sem repositório'))
    await expect(resumeSquads(r.deps)).resolves.toEqual([])
    expect(r.warn).toHaveBeenCalledWith(expect.stringContaining('sem repositório'))
  })
  it('duas retomadas ao mesmo tempo iniciam um único ciclo do squad', async () => {
    const r = run([rec()])
    const [a, b] = await Promise.all([resumeSquads(r.deps), resumeSquads(r.deps)])
    expect(r.starts).toHaveLength(1)
    expect([...a, ...b]).toEqual(['sala-1'])
  })
})

describe('a rodada de revisão depois de retomar (AO-100)', () => {
  it('voltar de "iniciando" para "revisando" depois da retomada é a mesma rodada, não outra', () => {
    const store = new SquadPhaseStore(dir)
    store.record({ code: 'c', ticketId: 't1', phase: 'implementando' })
    expect(store.record({ code: 'c', ticketId: 't1', phase: 'revisando' }).round).toBe(1)
    // reabriu o app: o orquestrador novo passa por "iniciando" antes de voltar ao passo do revisor
    expect(store.record({ code: 'c', ticketId: 't1', phase: 'iniciando' }).round).toBe(1)
    expect(store.record({ code: 'c', ticketId: 't1', phase: 'revisando', member: 'reviewer' }).round).toBe(1)
  })
  it('uma revisão nova de verdade ainda conta: retomou em "implementando" e revisou de novo', () => {
    const store = new SquadPhaseStore(dir)
    store.record({ code: 'c', ticketId: 't1', phase: 'revisando' })
    store.record({ code: 'c', ticketId: 't1', phase: 'iniciando' })
    store.record({ code: 'c', ticketId: 't1', phase: 'implementando' })
    expect(store.record({ code: 'c', ticketId: 't1', phase: 'revisando' }).round).toBe(2)
  })
  it('a primeira revisão logo depois de "iniciando" (rodada 0) conta 1', () => {
    const store = new SquadPhaseStore(dir)
    store.record({ code: 'c', ticketId: 't1', phase: 'iniciando' })
    expect(store.record({ code: 'c', ticketId: 't1', phase: 'revisando' }).round).toBe(1)
  })
})

describe('createPhaseRecorder, o gancho que grava a fase (AO-100 critério 1)', () => {
  const setup = (over: { active?: string | undefined } = {}) => {
    const calls: unknown[] = []
    const membersOf = vi.fn(() => members)
    const deps = {
      members: membersOf,
      activeTicket: vi.fn(() => ('active' in over ? over.active : 't1')),
      ticketKey: vi.fn(() => 'AO-1'),
      record: (input: unknown) => void calls.push(input),
    }
    return { calls, membersOf, deps, recorder: createPhaseRecorder(deps) }
  }
  const orch = (over: Record<string, unknown> = {}) =>
    ({ id: 'o1', role: 'orchestrator', squad: 'sala-1', ticketId: 't1', status: 'working', cwd: 'C:/p', squadStep: step('reviewer', { label: 'Revisar' }), ...over }) as never

  it('grava squad, ticket, chave, fase, membro e passo do orquestrador do ticket ativo', () => {
    const { calls, recorder } = setup()
    recorder(orch())
    expect(calls).toEqual([{ code: 'sala-1', ticketId: 't1', ticketKey: 'AO-1', phase: 'revisando', member: 'reviewer', step: 'Revisar' }])
  })
  it('ignora quem não é orquestrador de squad e quem não tem ticket', () => {
    const { calls, recorder } = setup()
    recorder(orch({ role: 'worker' }))
    recorder(orch({ squad: undefined }))
    recorder(orch({ ticketId: undefined }))
    expect(calls).toEqual([])
  })
  it('ignora ticket que não é o ativo da fila, e estado que não diz nada novo', () => {
    const other = setup({ active: 't2' })
    other.recorder(orch())
    expect(other.calls).toEqual([])
    const idle = setup()
    idle.recorder(orch({ status: 'idle' }))
    expect(idle.calls).toEqual([])
  })
  it('só relê o squad quando o passo ou o estado mudou', () => {
    const { calls, membersOf, recorder } = setup()
    recorder(orch())
    recorder(orch())
    expect(membersOf).toHaveBeenCalledTimes(1)
    expect(calls).toHaveLength(1)
    recorder(orch({ squadStep: step('qa', { label: 'Testar' }) }))
    expect(membersOf).toHaveBeenCalledTimes(2)
    expect(calls).toHaveLength(2)
    expect(calls[1]).toMatchObject({ phase: 'testando', member: 'qa', step: 'Testar' })
  })
  it('ligado ao store: a fase vira registro em disco e a retomada não soma rodada', () => {
    const store = new SquadPhaseStore(dir)
    const recorder = createPhaseRecorder({
      members: () => members,
      activeTicket: () => 't1',
      ticketKey: () => 'AO-1',
      record: (input) => void store.record(input),
    })
    recorder(orch())
    expect(store.get('sala-1')).toMatchObject({ phase: 'revisando', round: 1, member: 'reviewer', ticketKey: 'AO-1' })
    recorder(orch({ id: 'o2', squadStep: undefined, status: 'starting' }))
    expect(store.get('sala-1')).toMatchObject({ phase: 'iniciando', round: 1 })
    recorder(orch({ id: 'o2' }))
    expect(store.get('sala-1')).toMatchObject({ phase: 'revisando', round: 1 })
  })
})
