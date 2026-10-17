import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAgendaWriter } from '../src/main/agenda-write'
import { PlanningStore } from '../src/main/planning'
import { applyProposal } from '../src/main/proposals'
import { createTaskWriter } from '../src/main/tasks-write'
import type { ProposalOperation } from '../src/shared/proposals'

/**
 * Confirmar uma proposta (AO-10): all of its operations or none. Each test runs against a temporary
 * vault and a temporary planning.json, never the user's data.
 */

const TASKS = [
  '## Casa',
  '- [ ] 16.10.2026 | 09:00 | Casa | Lavar roupa ^tabc123',
  '- [ ] Passar pano ^tdef456',
  '## Estudo',
  '- [ ] Ler capítulo 3 ^t1a2b3c',
  '## Archive',
  '',
].join('\n')

const AGENDA = [
  '# Agenda',
  '',
  '## 2026-10-16',
  '- 09:00 Reunião de pauta',
  '- 10:30 ↦ ^tabc123',
  'Uma nota solta',
  '',
  '## 2026-10-17',
  '- 14:00 Dentista',
  '',
].join('\n')

const REUNIAO = { day: '2026-10-16', time: '09:00', title: 'Reunião de pauta' }
const DAY = new Date(2026, 9, 17, 10, 30)

const OPS: ProposalOperation[] = [
  { kind: 'focus', id: 't1a2b3c' },
  { kind: 'unfocus', id: 'tdef456' },
  { kind: 'reschedule', id: 'tabc123', date: '17.10.2026' },
  { kind: 'move-commitment', from: REUNIAO, to: { day: '2026-10-17', time: '11:00' } },
]

let vault: string
let data: string

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), 'ao-apply-vault-'))
  data = mkdtempSync(join(tmpdir(), 'ao-apply-data-'))
  writeFileSync(join(vault, 'tarefas.md'), TASKS)
  writeFileSync(join(vault, 'agenda.md'), AGENDA)
})

afterEach(() => {
  rmSync(vault, { recursive: true, force: true })
  rmSync(data, { recursive: true, force: true })
})

/** A planning store with "Passar pano" in focus and the proposal p1 pending; both writers have read the files, as the review does. */
function setup(operations: ProposalOperation[] = OPS) {
  const planning = new PlanningStore(data, () => DAY.getTime())
  planning.add('tdef456')
  planning.addProposal({ id: 'p1', source: 'revisão', createdAt: DAY.getTime(), operations })
  const tasks = createTaskWriter({ now: () => DAY })
  const agenda = createAgendaWriter({ now: () => DAY })
  tasks.remember(vault, readFileSync(join(vault, 'tarefas.md'), 'utf8'))
  agenda.read(vault)
  const apply = () => applyProposal(vault, planning.proposal('p1')!, { tasks, agenda, planning, now: () => DAY })
  return { planning, tasks, agenda, apply }
}

const tasksFile = () => readFileSync(join(vault, 'tarefas.md'), 'utf8')
const agendaFile = () => readFileSync(join(vault, 'agenda.md'), 'utf8')

describe('applyProposal', () => {
  it('confirmation applies every operation: tarefas.md, the focus and agenda.md match the proposal', () => {
    const { planning, apply } = setup()
    apply()

    expect(tasksFile()).toBe(
      [
        '## Casa',
        '- [ ] 17.10.2026 | 09:00 | Casa | Lavar roupa ^tabc123',
        '- [ ] Passar pano ^tdef456',
        '## Estudo',
        '- [ ] Ler capítulo 3 ^t1a2b3c',
        '## Archive',
        '',
      ].join('\n'),
    )
    expect(agendaFile()).toBe(
      [
        '# Agenda',
        '',
        '## 2026-10-16',
        '- 10:30 ↦ ^tabc123',
        'Uma nota solta',
        '',
        '## 2026-10-17',
        '- 14:00 Dentista',
        '- 11:00 Reunião de pauta',
        '',
      ].join('\n'),
    )
    expect(planning.focus()).toEqual(['t1a2b3c'])
    expect(planning.proposal('p1')).toBeUndefined()

    const reloaded = new PlanningStore(data)
    expect(reloaded.focus()).toEqual(['t1a2b3c'])
    expect(reloaded.pendingProposals()).toEqual([])
  })

  it('a discard in a proposal takes the task to the Archive and keeps its record, so it can be reopened', () => {
    const { planning, apply } = setup([{ kind: 'discard', id: 'tdef456', reason: 'não faz mais sentido' }])
    apply()

    expect(tasksFile()).toContain('- [-] Passar pano ❌ 17.10.2026 — não faz mais sentido ^tdef456')
    expect(planning.archivedOf('tdef456')).toEqual({
      origin: 'Casa',
      completedAt: '2026-10-17',
      originalLine: '- [ ] Passar pano ^tdef456',
    })
    expect(planning.focus()).toEqual([])
  })

  it('one failing operation applies none, and the message says which one failed', () => {
    const { planning, apply } = setup([
      { kind: 'reschedule', id: 'tabc123', date: '17.10.2026' },
      { kind: 'focus', id: 'tnaoexi' },
    ])

    expect(apply).toThrow(/Não consegui aplicar a operação 2 \(Pôr em foco a tarefa tnaoexi\).*Nada foi escrito/)
    expect(tasksFile()).toBe(TASKS)
    expect(agendaFile()).toBe(AGENDA)
    expect(planning.focus()).toEqual(['tdef456'])
    expect(planning.proposal('p1')).toMatchObject({ id: 'p1' })
    expect(planning.proposal('p1')!.failure).toBeUndefined()
  })

  it('a commitment that is not in agenda.md stops the whole proposal before any write', () => {
    const { planning, apply } = setup([
      { kind: 'reschedule', id: 'tabc123', date: '17.10.2026' },
      { kind: 'move-commitment', from: { ...REUNIAO, title: 'Não existe' }, to: { day: '2026-10-17', time: '11:00' } },
    ])

    expect(apply).toThrow('operação 2')
    expect(tasksFile()).toBe(TASKS)
    expect(agendaFile()).toBe(AGENDA)
    expect(planning.focus()).toEqual(['tdef456'])
  })

  it('a proposal that closes without confirming writes nothing and stays pending', () => {
    const { planning } = setup()
    expect(planning.pendingProposals()).toHaveLength(1)
    expect(tasksFile()).toBe(TASKS)
    expect(agendaFile()).toBe(AGENDA)
    expect(new PlanningStore(data).proposal('p1')?.operations).toEqual(OPS)
  })

  it('refusing takes it off the pending list and changes no file', () => {
    const { planning } = setup()
    planning.removeProposal('p1')
    expect(new PlanningStore(data).pendingProposals()).toEqual([])
    expect(tasksFile()).toBe(TASKS)
    expect(agendaFile()).toBe(AGENDA)
  })

  it('a tarefas.md that changed since the review refuses everything, in words the user can read', () => {
    const { planning, apply } = setup()
    writeFileSync(join(vault, 'tarefas.md'), TASKS + '- [ ] Outra tarefa ^tzzzzzz\n')

    expect(apply).toThrow('O tarefas.md mudou desde que você abriu o quadro')
    expect(tasksFile()).toBe(TASKS + '- [ ] Outra tarefa ^tzzzzzz\n')
    expect(agendaFile()).toBe(AGENDA)
    expect(planning.focus()).toEqual(['tdef456'])
    expect(planning.proposal('p1')).toBeDefined()
  })

  it('an agenda.md that changed since the review refuses everything, and tarefas.md is not written', () => {
    const { planning, apply } = setup()
    writeFileSync(join(vault, 'agenda.md'), AGENDA + '- 18:00 Outro\n')

    expect(apply).toThrow('O agenda.md mudou desde que você abriu a proposta')
    expect(tasksFile()).toBe(TASKS)
    expect(planning.focus()).toEqual(['tdef456'])
  })

  it('a proposal with no agenda operation does not need agenda.md at all', () => {
    rmSync(join(vault, 'agenda.md'))
    const { planning, apply } = setup([{ kind: 'focus', id: 't1a2b3c' }])
    apply()
    expect(planning.focus()).toEqual(['tdef456', 't1a2b3c'])
    expect(planning.proposal('p1')).toBeUndefined()
  })

  it('if agenda.md fails after tarefas.md was written, the focus is kept, the agenda operations stay pending and the failure is marked', () => {
    // A file where the agenda's backup folder should be: tarefas.md is written, agenda.md cannot be.
    mkdirSync(join(vault, 'backups'))
    writeFileSync(join(vault, 'backups', 'agenda'), 'não é uma pasta')
    const { planning, apply } = setup()

    expect(apply).toThrow('continuam pendentes')
    expect(tasksFile()).toContain('- [ ] 17.10.2026 | 09:00 | Casa | Lavar roupa ^tabc123')
    expect(agendaFile()).toBe(AGENDA)
    expect(planning.focus()).toEqual(['t1a2b3c'])

    const pending = new PlanningStore(data).proposal('p1')!
    expect(pending.operations).toEqual([OPS[3]])
    expect(pending.failure).toMatchObject({ index: 0 })
    expect(pending.failure!.message).toContain('não consegui gravar o agenda.md')
  })
})
