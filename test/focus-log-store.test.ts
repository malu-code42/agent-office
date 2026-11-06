import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DATA_FILES } from '../src/main/backups'
import { FocusLogStore } from '../src/main/focus-log-store'
import { barStart, barView } from '../src/shared/barTimer'
import { dayKeyOf } from '../src/shared/focusLog'

const MIN = 60_000
const T0 = new Date(2026, 10, 5, 9, 0, 0).getTime()
const task = { id: 'tAAA111', text: 'Escrever relatório' }
const DAY = dayKeyOf(T0)

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ao-focus-log-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const running = (at: number) => barView(barStart(25, task, at), at)

describe('FocusLogStore', () => {
  it('arquivo ausente começa vazio e focus-log.json está entre os dados com backup', () => {
    const s = new FocusLogStore(dir, () => T0)
    expect(s.range([DAY])).toEqual({ days: {}, now: T0 })
    expect(DATA_FILES).toContain('focus-log.json')
  })

  it('registra, persiste por dia e sobrevive a reiniciar o app', () => {
    let clock = T0
    const changes: number[] = []
    const a = new FocusLogStore(
      dir,
      () => clock,
      () => changes.push(1),
    )
    a.sync(running(T0))
    clock = T0 + 10 * MIN
    a.sync(null)
    expect(changes).toHaveLength(2)
    const file = JSON.parse(readFileSync(join(dir, 'focus-log.json'), 'utf8'))
    expect(file.days[DAY]).toHaveLength(1)
    expect(readdirSync(dir).filter((n) => n.endsWith('.tmp'))).toEqual([])

    const b = new FocusLogStore(dir, () => clock)
    expect(b.range([DAY]).days[DAY]).toEqual([{ taskId: task.id, taskText: task.text, kind: 'foco', start: T0, end: T0 + 10 * MIN }])
  })

  it('a leitura inclui o trecho em andamento até agora', () => {
    let clock = T0
    const s = new FocusLogStore(dir, () => clock)
    s.sync(running(T0))
    clock = T0 + 5 * MIN
    expect(s.range([DAY]).days[DAY]).toEqual([
      { taskId: task.id, taskText: task.text, kind: 'foco', start: T0, end: T0 + 5 * MIN, running: true },
    ])
  })

  it('prazo vencido com o app fechado não gera foco inventado: conta até a última vez visto', () => {
    let clock = T0
    const a = new FocusLogStore(dir, () => clock)
    a.sync(running(T0))
    clock = T0 + 3 * MIN
    a.heartbeat()
    // O app fecha aqui e só reabre horas depois, com o prazo de 25 min vencido.
    clock = T0 + 5 * 60 * MIN
    const b = new FocusLogStore(dir, () => clock)
    const segs = b.range([DAY]).days[DAY]
    expect(segs).toHaveLength(1)
    expect(segs[0]).toMatchObject({ start: T0, end: T0 + 3 * MIN })
    expect(segs[0].running).toBeUndefined()
  })

  it('timer ainda correndo ao reabrir: o intervalo sem o app não conta e um trecho novo começa', () => {
    let clock = T0
    const a = new FocusLogStore(dir, () => clock)
    const view = running(T0)
    a.sync(view)
    clock = T0 + 2 * MIN
    a.heartbeat()
    clock = T0 + 10 * MIN
    const b = new FocusLogStore(dir, () => clock)
    b.sync(view)
    clock = T0 + 12 * MIN
    const segs = b.range([DAY]).days[DAY]
    expect(segs.map((s) => [s.start, s.end])).toEqual([
      [T0, T0 + 2 * MIN],
      [T0 + 10 * MIN, T0 + 12 * MIN],
    ])
  })

  it('markDone marca o último segmento da tarefa, inclusive o que corre', () => {
    let clock = T0
    const s = new FocusLogStore(dir, () => clock)
    s.sync(running(T0))
    clock = T0 + 8 * MIN
    s.markDone(task.id)
    const segs = s.range([DAY]).days[DAY]
    expect(segs).toHaveLength(1)
    expect(segs[0]).toMatchObject({ end: T0 + 8 * MIN, done: true })
    expect(segs[0].running).toBeUndefined()
  })

  it('markDone de tarefa sem registro não escreve nada', () => {
    const s = new FocusLogStore(
      dir,
      () => T0,
      () => {
        throw new Error('não devia avisar')
      },
    )
    s.markDone('tZZZ999')
    expect(readdirSync(dir)).toEqual([])
  })

  it('arquivo corrompido é posto de lado e o registro começa vazio', () => {
    writeFileSync(join(dir, 'focus-log.json'), '{ isto não é json', 'utf8')
    const s = new FocusLogStore(dir, () => T0)
    expect(s.range([DAY]).days).toEqual({})
    expect(readdirSync(dir).some((n) => n.includes('corrupt'))).toBe(true)
  })

  it('forma que não presta é descartada, sem adivinhar', () => {
    writeFileSync(join(dir, 'focus-log.json'), JSON.stringify({ days: [1, 2] }), 'utf8')
    const s = new FocusLogStore(dir, () => T0)
    expect(s.range([DAY]).days).toEqual({})
  })
})
