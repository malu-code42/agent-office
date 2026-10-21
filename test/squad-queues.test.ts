import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { SquadQueueStore } from '../src/main/squad-queues'
import { SquadProposalStore } from '../src/main/squad-proposals'
import type { SquadProposal } from '../src/shared/types'

// The proposals and the queues of the squads live in the app's data, apart from the
// squads of the projects. They survive a restart and never mix with a squad.

let dir: string

const proposal = (id: string, room = 0): SquadProposal => ({
  id,
  projectId: 'p1',
  cwd: '/projeto',
  room,
  createdAt: 1,
  updatedAt: 1,
  brief: 'Refazer a busca',
  ticketIds: [],
  adjustments: [],
  name: `Squad da Sala ${room + 1}`,
  composition: {
    name: `Squad da Sala ${room + 1}`,
    members: [
      { id: 'builder', name: 'Builder', role: 'implementer', engine: 'claude', model: '', account: '', focus: 'Implementar' },
      { id: 'reviewer', name: 'Reviewer', role: 'reviewer', engine: 'claude', model: '', account: '', focus: 'Revisar' },
    ],
  },
  status: 'pending',
})

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ao-squad-queue-'))
})

describe('a fila dos squads', () => {
  it('guarda o ticket ativo e os que esperam', () => {
    const store = new SquadQueueStore(dir)
    store.set({ code: 'sala-1', cwd: '/projeto', active: 't1', queue: ['t2', 't3'], updatedAt: 10 })
    expect(new SquadQueueStore(dir).get('sala-1')).toEqual({
      code: 'sala-1',
      cwd: '/projeto',
      active: 't1',
      queue: ['t2', 't3'],
      updatedAt: 10,
    })
  })

  it('uma squad sem fila não tem nada guardado', () => {
    const store = new SquadQueueStore(dir)
    expect(store.get('sala-1')).toBeUndefined()
    store.set({ code: 'sala-1', cwd: '/projeto', active: null, queue: [], updatedAt: 1 })
    expect(store.all()).toHaveLength(1)
    store.remove('sala-1')
    expect(store.all()).toEqual([])
  })

  it('um arquivo quebrado não derruba a app: ele começa do zero', () => {
    writeFileSync(join(dir, 'squad-queues.json'), '{ isto não é json')
    const store = new SquadQueueStore(dir)
    expect(store.all()).toEqual([])
  })

  it('uma fila nula ou fora do formato é descartada, sem derrubar a app', () => {
    writeFileSync(
      join(dir, 'squad-queues.json'),
      JSON.stringify({
        queues: {
          'sala-1': null,
          'sala-2': { code: 'sala-2', cwd: '/projeto', active: 't1', queue: ['t2'], updatedAt: 3 },
          'sala-3': { code: 'sala-3', cwd: '/projeto', active: 7, queue: 'nope', updatedAt: 'ontem' },
        },
      }),
    )
    const store = new SquadQueueStore(dir)
    // A fila boa é usada; as quebradas não chegam a lugar nenhum.
    expect(store.all()).toHaveLength(1)
    expect(store.get('sala-2')?.active).toBe('t1')
    expect(store.get('sala-1')).toBeUndefined()
    expect(store.get('sala-3')).toBeUndefined()
  })

  it('um arquivo de filas que não é um objeto começa do zero', () => {
    writeFileSync(join(dir, 'squad-queues.json'), JSON.stringify({ queues: ['isto', 'não', 'é', 'um', 'mapa'] }))
    expect(new SquadQueueStore(dir).all()).toEqual([])
  })
})

describe('as propostas', () => {
  it('guardam o que a pessoa pediu, longe dos squads', () => {
    const store = new SquadProposalStore(dir)
    store.put(proposal('prop-1'))
    expect(store.list()).toHaveLength(1)
    expect(store.get('prop-1')?.brief).toBe('Refazer a busca')
    // Nothing was written in the project folder.
    expect(() => readFileSync(join(dir, 'squad-queues.json'))).toThrow()
  })

  it('uma proposta por sala: a da sala é a que a pessoa está vendo', () => {
    const store = new SquadProposalStore(dir)
    store.put(proposal('prop-1', 0))
    store.put(proposal('prop-2', 1))
    expect(store.forRoom('p1', 1)?.id).toBe('prop-2')
    expect(store.forRoom('p1', 2)).toBeUndefined()
  })

  it('uma proposta já aprovada não segura a sala', () => {
    const store = new SquadProposalStore(dir)
    const done = { ...proposal('prop-1', 0), status: 'assigned' as const }
    store.put(done)
    expect(store.forRoom('p1', 0)).toBeUndefined()
  })

  it('descartar a proposta tira ela do arquivo', () => {
    const store = new SquadProposalStore(dir)
    store.put(proposal('prop-1'))
    store.remove('prop-1')
    expect(new SquadProposalStore(dir).list()).toEqual([])
  })

  it('uma proposta nula ou fora do formato é descartada, sem derrubar a app', () => {
    writeFileSync(
      join(dir, 'squad-proposals.json'),
      JSON.stringify({
        proposals: [
          null,
          { ...proposal('prop-1'), room: 'primeira' },
          { ...proposal('prop-2'), status: 'nao-existe' },
          { ...proposal('prop-3'), composition: { name: 'x', members: [{ id: 'maya' }] } },
          proposal('prop-4'),
        ],
      }),
    )
    const store = new SquadProposalStore(dir)
    // Só a proposta que cabe no formato é usada.
    expect(store.list().map((p) => p.id)).toEqual(['prop-4'])
    expect(store.get('prop-1')).toBeUndefined()
    expect(store.get('prop-3')).toBeUndefined()
  })

  it('a lista das propostas não quebra com registros quebrados', () => {
    writeFileSync(join(dir, 'squad-proposals.json'), JSON.stringify({ proposals: [null, { id: 'sem-nada' }] }))
    expect(() => new SquadProposalStore(dir).list()).not.toThrow()
    expect(new SquadProposalStore(dir).list()).toEqual([])
  })

  it('o que ficou fora do formato é guardado para o jogador', () => {
    writeFileSync(join(dir, 'squad-proposals.json'), JSON.stringify({ proposals: [null, proposal('prop-1')] }))
    new SquadProposalStore(dir)
    const kept = readdirSync(dir).filter((n) => n.startsWith('squad-proposals.corrupt-'))
    expect(kept).toHaveLength(1)
    expect(readFileSync(join(dir, kept[0]!), 'utf8')).toContain('null')
  })

  it('o que ficou fora do formato é guardado para o jogador (filas)', () => {
    writeFileSync(join(dir, 'squad-queues.json'), JSON.stringify({ queues: { 'sala-1': null } }))
    new SquadQueueStore(dir)
    const kept = readdirSync(dir).filter((n) => n.startsWith('squad-queues.corrupt-'))
    expect(kept).toHaveLength(1)
    expect(readFileSync(join(dir, kept[0]!), 'utf8')).toContain('sala-1')
  })
})
