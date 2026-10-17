import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DATA_SHAPES, shapeOf } from '../src/main/backups'
import { PlanningStore } from '../src/main/planning'
import { parseProposal, proposalOperationSchema, proposalSchema } from '../src/main/validate'
import {
  REFUSED_MESSAGE,
  describeProposal,
  dayPt,
  isIsoDay,
  proposalRow,
  type Proposal,
  type ProposalOperation,
} from '../src/shared/proposals'

/**
 * Propostas (AO-10), the model: the exact list of operations, the caixa row, the refusal of "concluir",
 * and planning.json with its pending list. The rules that touch files are in proposals-apply.test.ts.
 */

const REUNIAO = { day: '2026-10-16', time: '09:00', title: 'Reunião de pauta' }
const OPS: ProposalOperation[] = [
  { kind: 'focus', id: 't1a2b3c' },
  { kind: 'unfocus', id: 'tdef456' },
  { kind: 'reschedule', id: 'tabc123', date: '17.10.2026' },
  { kind: 'discard', id: 'tdef456', reason: 'não faz mais sentido' },
  { kind: 'move-commitment', from: REUNIAO, to: { day: '2026-10-17', time: '11:00' } },
]
const TITLES: Record<string, string> = { t1a2b3c: 'Ler capítulo 3', tdef456: 'Passar pano', tabc123: 'Lavar roupa' }
const titleOf = (id: string) => TITLES[id.toLowerCase()]

const proposal = (operations: unknown[] = OPS): Proposal => ({
  id: 'p1',
  source: 'revisão',
  createdAt: 1_700_000_000_000,
  operations: operations as ProposalOperation[],
})

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ao-proposals-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('describeProposal', () => {
  it('lists every operation, in order, with the titles of its tasks', () => {
    expect(describeProposal(proposal(), titleOf)).toEqual([
      'Pôr em foco “Ler capítulo 3”',
      'Tirar do foco “Passar pano”',
      'Reagendar “Lavar roupa” para 17.10.2026',
      'Descartar “Passar pano”, com o motivo: não faz mais sentido',
      'Mover o compromisso “Reunião de pauta” de 16.10.2026 09:00 para 17.10.2026 às 11:00',
    ])
  })

  it('names a task by its id when it is not in tarefas.md, and says the time change of a same-day commitment', () => {
    const lines = describeProposal(
      proposal([
        { kind: 'focus', id: 'tsumiu' },
        { kind: 'move-commitment', from: REUNIAO, to: { day: REUNIAO.day, time: '11:15' } },
      ]),
      () => undefined,
    )
    expect(lines).toEqual(['Pôr em foco a tarefa tsumiu', 'Mudar o compromisso “Reunião de pauta” de 09:00 para 11:15 em 16.10.2026'])
  })
})

describe('proposalRow', () => {
  it('is a caixa row with the chip "proposta" that opens the review and applies nothing', () => {
    expect(proposalRow(proposal())).toEqual({
      id: 'p1',
      chip: 'proposta',
      name: 'revisão',
      text: '5 operações para revisar',
      createdAt: 1_700_000_000_000,
      failed: false,
      action: 'review',
    })
  })

  it('says when the last confirmation failed, and counts one operation in the singular', () => {
    const failed = { ...proposal([{ kind: 'focus', id: 't1a2b3c' }]), failure: { index: 0, message: 'nada' } }
    expect(proposalRow(failed)).toMatchObject({ text: '1 operação · a última tentativa falhou', failed: true })
  })
})

describe('"concluir" is never an operation', () => {
  it('the schema refuses the kinds that would finish a task', () => {
    expect(proposalOperationSchema.safeParse({ kind: 'concluir', id: 't1a2b3c' }).success).toBe(false)
    expect(proposalOperationSchema.safeParse({ kind: 'complete', id: 't1a2b3c' }).success).toBe(false)
    expect(proposalSchema.safeParse(proposal([{ kind: 'concluir', id: 't1a2b3c' }])).success).toBe(false)
  })

  it('the main process refuses a proposal that carries it, with the message for the user', () => {
    expect(() => parseProposal(proposal([{ kind: 'concluir', id: 't1a2b3c' }]))).toThrow(REFUSED_MESSAGE)
    expect(() =>
      parseProposal(
        proposal([
          { kind: 'focus', id: 't1a2b3c' },
          { kind: 'complete', id: 't1a2b3c' },
        ]),
      ),
    ).toThrow(REFUSED_MESSAGE)
  })

  it('the planning store does not keep such a proposal', () => {
    const store = new PlanningStore(dir)
    expect(() => store.addProposal(proposal([{ kind: 'concluir', id: 't1a2b3c' }]))).toThrow(REFUSED_MESSAGE)
    expect(store.pendingProposals()).toEqual([])
  })

  it('accepts each operation kind the ticket names', () => {
    expect(parseProposal(proposal()).operations).toHaveLength(OPS.length)
  })
})

describe('proposals in planning.json', () => {
  it('a pending proposal is kept with its id, source, creation time and operations, and survives a reload', () => {
    const store = new PlanningStore(dir)
    store.addProposal(proposal())
    expect(store.pendingProposals()).toEqual([proposal()])

    const reloaded = new PlanningStore(dir)
    expect(reloaded.proposal('p1')).toEqual(proposal())
  })

  it('a second proposal with the same id is refused', () => {
    const store = new PlanningStore(dir)
    store.addProposal(proposal())
    expect(() => store.addProposal(proposal())).toThrow('Já existe uma proposta com esse identificador.')
  })

  it('removing a proposal takes it off the pending list and writes it', () => {
    const store = new PlanningStore(dir)
    store.addProposal(proposal())
    store.removeProposal('p1')
    expect(new PlanningStore(dir).pendingProposals()).toEqual([])
  })

  it('a planning.json from before this change loads with no proposals and passes the backup shape check', () => {
    const old = {
      focus: ['tabc123'],
      steps: { tabc123: { date: '2026-10-17', text: 'rascunho' } },
      archived: { t1a2b3c: { origin: 'Casa', completedAt: '2026-10-10', originalLine: '- [ ] x ^t1a2b3c' } },
    }
    writeFileSync(join(dir, 'planning.json'), JSON.stringify(old))

    const store = new PlanningStore(dir)
    expect(store.focus()).toEqual(['tabc123'])
    expect(store.pendingProposals()).toEqual([])
    expect(shapeOf('planning.json')(old)).toBe(true)
    expect(DATA_SHAPES['planning.json']({ ...old, proposals: [] })).toBe(true)
    expect(DATA_SHAPES['planning.json']({ ...old, proposals: 'x' })).toBe(false)
  })

  it('a stored proposal this version cannot read is dropped, never applied', () => {
    writeFileSync(
      join(dir, 'planning.json'),
      JSON.stringify({ focus: [], steps: {}, proposals: [proposal([{ kind: 'concluir', id: 't1a2b3c' }])] }),
    )
    expect(new PlanningStore(dir).pendingProposals()).toEqual([])
  })
})

describe('dates', () => {
  it('isIsoDay refuses a day that does not exist, and dayPt writes it the way tarefas.md does', () => {
    expect(isIsoDay('2026-10-17')).toBe(true)
    expect(isIsoDay('2026-02-31')).toBe(false)
    expect(isIsoDay('17.10.2026')).toBe(false)
    expect(dayPt('2026-10-17')).toBe('17.10.2026')
  })
})
