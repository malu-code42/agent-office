import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DATA_FILES } from '../src/main/backups'
import { PlanningStore } from '../src/main/planning'
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
    expect(JSON.parse(readFileSync(join(dir, 'planning.json'), 'utf8'))).toEqual({ focus: ['tabc123', 'tqwerty'] })
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
