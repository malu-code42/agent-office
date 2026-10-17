import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DATA_FILES, shapeOf } from '../src/main/backups'
import { PlanningStore } from '../src/main/planning'
import { parseStepText } from '../src/main/validate'
import { focusItems } from '../src/shared/planning'
import { parseTasksFile } from '../src/shared/tasks'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ao-planning-'))
})

afterEach(() => {
  vi.useRealTimers()
  rmSync(dir, { recursive: true, force: true })
})

describe('PlanningStore', () => {
  it('adds and takes out task ids; a repeated add changes nothing', () => {
    const store = new PlanningStore(dir)
    store.add('tAbC123')
    store.add('tabc123')
    store.add('tqwerty')

    expect(store.focus()).toEqual(['tabc123', 'tqwerty'])

    store.remove('TQWERTY')
    store.remove('tnao001')
    expect(store.focus()).toEqual(['tabc123'])
  })

  it('keeps the focus after a reload of the store, and writes planning.json as JSON', () => {
    const first = new PlanningStore(dir)
    first.add('tabc123')
    first.add('tqwerty')

    expect(new PlanningStore(dir).focus()).toEqual(['tabc123', 'tqwerty'])
    expect(JSON.parse(readFileSync(join(dir, 'planning.json'), 'utf8'))).toEqual({ focus: ['tabc123', 'tqwerty'], steps: {} })
    expect(readdirSync(dir).filter((n) => n.endsWith('.tmp'))).toEqual([])
  })

  it('is not cleared when the day changes', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 16, 23, 50))
    new PlanningStore(dir).add('tabc123')

    vi.setSystemTime(new Date(2026, 9, 17, 8, 0))
    expect(new PlanningStore(dir).focus()).toEqual(['tabc123'])

    vi.setSystemTime(new Date(2026, 10, 2, 8, 0))
    expect(new PlanningStore(dir).focus()).toEqual(['tabc123'])
  })

  it('moves a broken planning.json aside and starts with an empty focus', () => {
    writeFileSync(join(dir, 'planning.json'), '{ isto não é json', 'utf8')

    expect(new PlanningStore(dir).focus()).toEqual([])
    expect(readdirSync(dir).some((n) => n.startsWith('planning.corrupt-'))).toBe(true)
  })

  it('lists planning.json among the data files that are backed up', () => {
    expect(DATA_FILES).toContain('planning.json')
  })
})

describe('focusItems', () => {
  const lists = parseTasksFile('## Estudo\n- [ ] Ler capítulo 3 ^t1a2b3c\n## Casa\n- [ ] Lavar roupa ^tabc123\n').lists

  it('gives the title and the list of each focused task, in the order it was focused', () => {
    expect(focusItems(lists, ['tabc123', 't1a2b3c'])).toEqual([
      { id: 'tabc123', missing: false, text: 'Lavar roupa', list: 'Casa' },
      { id: 't1a2b3c', missing: false, text: 'Ler capítulo 3', list: 'Estudo' },
    ])
  })

  it('marks an id that is no longer in the file as missing', () => {
    expect(focusItems(lists, ['tzzzzzz'])).toEqual([{ id: 'tzzzzzz', missing: true }])
  })

  it('matches an id in the file whatever its case', () => {
    const upper = parseTasksFile('## Casa\n- [ ] Lavar roupa ^tABC123\n').lists

    expect(focusItems(upper, ['tabc123'])).toEqual([{ id: 'tabc123', missing: false, text: 'Lavar roupa', list: 'Casa' }])
  })
})

const TODAY = '2026-10-16'
const YESTERDAY = '2026-10-15'
const stored = (): Record<string, unknown> => JSON.parse(readFileSync(join(dir, 'planning.json'), 'utf8')).steps

describe('PlanningStore steps', () => {
  const lists = parseTasksFile('## Casa\n- [ ] Lavar roupa ^tabc123\n').lists

  it('saves the step of a focused task with its id and the day, and shows it on the card of that day', () => {
    const store = new PlanningStore(dir)
    store.add('tAbC123')
    store.saveStep('TABC123', 'Lavar a máquina', TODAY)

    expect(store.todaySteps(TODAY)).toEqual(new Map([['tabc123', 'Lavar a máquina']]))
    expect(focusItems(lists, store.focus(), store.todaySteps(TODAY))).toEqual([
      { id: 'tabc123', missing: false, text: 'Lavar roupa', list: 'Casa', step: 'Lavar a máquina' },
    ])
    expect(stored()).toEqual({ tabc123: { date: TODAY, text: 'Lavar a máquina' } })
    expect(new PlanningStore(dir).todaySteps(TODAY)).toEqual(new Map([['tabc123', 'Lavar a máquina']]))
  })

  it('replaces the step of the same task on the same day', () => {
    const store = new PlanningStore(dir)
    store.add('tabc123')
    store.saveStep('tabc123', 'Primeiro', TODAY)
    store.saveStep('tabc123', 'Segundo', TODAY)

    expect(store.todaySteps(TODAY)).toEqual(new Map([['tabc123', 'Segundo']]))
    expect(stored()).toEqual({ tabc123: { date: TODAY, text: 'Segundo' } })
  })

  it('does not show a step of another day, but keeps it in the file', () => {
    const store = new PlanningStore(dir)
    store.add('tabc123')
    store.saveStep('tabc123', 'Ontem', YESTERDAY)

    expect(store.todaySteps(TODAY).size).toBe(0)
    expect(focusItems(lists, store.focus(), store.todaySteps(TODAY))[0]).not.toHaveProperty('step')
    expect(new PlanningStore(dir).todaySteps(YESTERDAY)).toEqual(new Map([['tabc123', 'Ontem']]))
    expect(stored()).toEqual({ tabc123: { date: YESTERDAY, text: 'Ontem' } })
  })

  it("an empty save clears today's step; clearing a day with no step keeps the step of another day", () => {
    const store = new PlanningStore(dir)
    store.add('tabc123')
    store.saveStep('tabc123', 'Ontem', YESTERDAY)
    store.clearStep('tabc123', TODAY)
    expect(stored()).toEqual({ tabc123: { date: YESTERDAY, text: 'Ontem' } })

    store.saveStep('tabc123', 'Hoje', TODAY)
    store.clearStep('tabc123', TODAY)
    expect(store.todaySteps(TODAY).size).toBe(0)
    expect(stored()).toEqual({})
  })

  it('refuses a step for a task that is not in focus, and writes nothing', () => {
    const store = new PlanningStore(dir)
    store.add('tabc123')

    expect(() => store.saveStep('tnao001', 'Ler', TODAY)).toThrow('Só tarefas em foco podem ter passo de hoje.')
    expect(() => store.clearStep('tnao001', TODAY)).toThrow('Só tarefas em foco podem ter passo de hoje.')
    expect(stored()).toEqual({})
  })

  it('keeps the step when the task is taken out of focus', () => {
    const store = new PlanningStore(dir)
    store.add('tabc123')
    store.saveStep('tabc123', 'Lavar a máquina', TODAY)
    store.remove('tabc123')

    expect(new PlanningStore(dir).focus()).toEqual([])
    expect(stored()).toEqual({ tabc123: { date: TODAY, text: 'Lavar a máquina' } })
  })

  it('a planning.json from before the step field loads, with no steps, and passes the backup shape check', () => {
    writeFileSync(join(dir, 'planning.json'), JSON.stringify({ focus: ['tabc123'] }), 'utf8')

    expect(new PlanningStore(dir).focus()).toEqual(['tabc123'])
    expect(new PlanningStore(dir).todaySteps(TODAY).size).toBe(0)
    expect(shapeOf('planning.json')({ focus: ['tabc123'] })).toBe(true)
    expect(shapeOf('planning.json')({ focus: ['tabc123'], steps: 'nao' })).toBe(false)
  })
})

describe('step text', () => {
  it('refuses empty and only-spaces text, and text over 200 characters, with a message in pt-BR', () => {
    expect(() => parseStepText('')).toThrow('Escreva o passo de hoje.')
    expect(() => parseStepText('   ')).toThrow('Escreva o passo de hoje.')
    expect(() => parseStepText('a'.repeat(201))).toThrow('O passo de hoje pode ter no máximo 200 caracteres.')
    expect(() => parseStepText(3)).toThrow('O passo de hoje precisa ser um texto.')
  })

  it('trims the text and accepts exactly 200 characters', () => {
    expect(parseStepText('  Ler capítulo 3  ')).toBe('Ler capítulo 3')
    expect(parseStepText('a'.repeat(200))).toBe('a'.repeat(200))
  })
})
