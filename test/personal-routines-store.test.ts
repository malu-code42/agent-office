import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { isPersonalRoutineData, PersonalRoutineStore, type PersonalRoutineOccurrence } from '../src/main/personal-routines-store'

const dirs: string[] = []
const dir = () => {
  const path = mkdtempSync(join(tmpdir(), 'ao-personal-routines-'))
  dirs.push(path)
  return path
}
afterEach(() => dirs.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })))

describe('estado local de rotinas pessoais', () => {
  it('mantém a distribuição e uma reserva idempotente após reiniciar, sem copiar texto da rotina', () => {
    const data = dir()
    const store = new PersonalRoutineStore(data, () => 'tabc123')
    store.confirmDistribution('2026-10-19:rabc', [1, 6])
    const first = store.reserve('rabc:2026-10-19', 'rabc', '2026-10-19')
    const restarted = new PersonalRoutineStore(data, () => 'txyz987')
    expect(restarted.distribution('2026-10-19:rabc')).toEqual([1, 6])
    expect(restarted.reserve(first.id, first.routineId, first.day)).toEqual(first)
    expect(readFileSync(join(data, 'personal-routines.json'), 'utf8')).not.toContain('texto privado')
  })

  it('conta apenas conclusão manual; reabrir/descartar/undo deixam a ocorrência pendente', () => {
    const store = new PersonalRoutineStore(dir(), () => 'tabc123')
    store.reserve('rabc:2026-10-19', 'rabc', '2026-10-19')
    store.completeTask('tabc123', '2026-10-20')
    expect(store.count('rabc', '2026-10-19', '2026-10-25')).toBe(1)
    store.reopenTask('tabc123')
    expect(store.count('rabc', '2026-10-19', '2026-10-25')).toBe(0)
    expect(store.occurrence('rabc:2026-10-19')?.status).toBe('pending')
  })

  it('reserva uma ocorrência pendente sem associação e mantém o mesmo taskId após restart/retry', () => {
    const data = dir()
    const first = new PersonalRoutineStore(data, () => 'tfirst1')
    first.ensureOccurrence('rabc:2026-10-19', 'rabc', '2026-10-19')
    const reserved = first.reserve('rabc:2026-10-19', 'rabc', '2026-10-19')
    expect(reserved.taskId).toBe('tfirst1')
    const restarted = new PersonalRoutineStore(data, () => 'tsecond')
    expect(restarted.reserve(reserved.id, reserved.routineId, reserved.day)).toEqual(reserved)
  })

  it('reconcilia uma associação ausente sem apagar a ocorrência nem a data', () => {
    const generatedIds = ['tlink01', 'tnew001']
    const store = new PersonalRoutineStore(dir(), () => generatedIds.shift()!)
    store.ensureOccurrence('rabc:2026-10-19', 'rabc', '2026-10-19')
    store.setTask('rabc:2026-10-19', 'tlink01')
    store.recoverMissingTask('tlink01')
    expect(store.occurrence('rabc:2026-10-19')).toMatchObject({
      id: 'rabc:2026-10-19',
      routineId: 'rabc',
      day: '2026-10-19',
      status: 'pending',
    })
    expect(store.occurrence('rabc:2026-10-19')?.taskId).toBeUndefined()
    expect(store.reserve('rabc:2026-10-19', 'rabc', '2026-10-19').taskId).toBe('tnew001')
  })

  it('só atualiza o fingerprint de uma reserva sem tarefa no arquivo; IDs e associações válidas ficam estáveis', () => {
    const data = dir()
    const store = new PersonalRoutineStore(data, () => 'tfirst1')
    store.ensureOccurrence('rabc:2026-10-19', 'rabc', '2026-10-19')
    const originalFingerprint = 'a'.repeat(64)
    const editedFingerprint = 'b'.repeat(64)
    const reserved = store.reserve('rabc:2026-10-19', 'rabc', '2026-10-19', new Set(), originalFingerprint)
    const edited = store.reserve(reserved.id, 'rabc', reserved.day, new Set(), editedFingerprint)
    expect(edited.taskId).toBe(reserved.taskId)
    expect(edited.taskFingerprint).toBe(editedFingerprint)

    store.setTask(reserved.id, reserved.taskId!, editedFingerprint)
    const stillLinked = store.reserve(reserved.id, 'rabc', reserved.day, new Set(), originalFingerprint)
    expect(stillLinked.taskId).toBe(reserved.taskId)
    expect(stillLinked.taskFingerprint).toBe(editedFingerprint)
    expect(readFileSync(join(data, 'personal-routines.json'), 'utf8')).not.toContain('private task title')
  })

  it('recusa estado com chave divergente, taskId duplicado ou duplicação case-insensitive e carrega vazio via fail-safe', () => {
    const base = {
      distributions: {},
      occurrences: {
        first: { id: 'first', routineId: 'rabc', day: '2026-10-19', status: 'pending', taskId: 'tshare1' },
        second: { id: 'second', routineId: 'rdef', day: '2026-10-20', status: 'pending', taskId: 'TSHARE1' },
      },
    }
    expect(isPersonalRoutineData(base)).toBe(false)
    expect(isPersonalRoutineData({ ...base, occurrences: { wrongKey: { ...base.occurrences.first, taskId: undefined } } })).toBe(false)

    const data = dir()
    writeFileSync(join(data, 'personal-routines.json'), JSON.stringify(base), 'utf8')
    expect(new PersonalRoutineStore(data).list()).toEqual([])
    expect(existsSync(join(data, 'personal-routines.json'))).toBe(false)
  })

  it('recusa taskId ativo/retiro em outra ocorrência e preserva a associação válida própria', () => {
    const store = new PersonalRoutineStore(dir(), () => 'tnew001')
    store.ensureOccurrence('rabc:2026-10-19', 'rabc', '2026-10-19')
    store.ensureOccurrence('rdef:2026-10-20', 'rdef', '2026-10-20')
    store.setTask('rabc:2026-10-19', 'tshare1', 'a'.repeat(64))
    store.setTask('rabc:2026-10-19', 'tshare1', 'a'.repeat(64))

    expect(() => store.setTask('rdef:2026-10-20', 'TSHARE1', 'b'.repeat(64))).toThrow(/outra ocorrência/i)
    expect(store.occurrence('rabc:2026-10-19')?.taskId).toBe('tshare1')
    expect(store.occurrence('rdef:2026-10-20')?.taskId).toBeUndefined()

    store.discardTask('tshare1')
    expect(() => store.setTask('rdef:2026-10-20', 'tshare1', 'b'.repeat(64))).toThrow(/outra ocorrência/i)
    store.reopenTask('tshare1')
    expect(store.occurrence('rabc:2026-10-19')?.taskId).toBe('tshare1')
    expect(store.occurrence('rdef:2026-10-20')?.taskId).toBeUndefined()
  })

  it('matches fingerprints only for one active link and fails closed on inconsistent memory state', () => {
    const store = new PersonalRoutineStore(dir())
    store.ensureOccurrence('rabc:2026-10-19', 'rabc', '2026-10-19')
    store.setTask('rabc:2026-10-19', 'tshare1', 'a'.repeat(64))
    const internals = store as unknown as { data: { occurrences: Record<string, PersonalRoutineOccurrence> } }
    internals.data.occurrences['rdef:2026-10-20'] = {
      id: 'rdef:2026-10-20',
      routineId: 'rdef',
      day: '2026-10-20',
      taskId: 'TSHARE1',
      taskFingerprint: 'a'.repeat(64),
      status: 'pending',
    }
    expect(store.matchesTaskFingerprint('tshare1', 'a'.repeat(64))).toBe(false)
    expect(() => store.completeTask('tshare1', '2026-10-21')).toThrow(/mais de uma ocorrência/i)
    expect(store.occurrence('rabc:2026-10-19')?.status).toBe('pending')
    expect(store.occurrence('rdef:2026-10-20')?.status).toBe('pending')
  })
})
