import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DATA_FILES, shapeOf } from '../src/main/backups'
import { PlanningStore } from '../src/main/planning'
import { parseStepText, parseTimerMinutes } from '../src/main/validate'
import { clockText, focusItems } from '../src/shared/planning'
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

  it('tells the app when the focus changes size, and stays quiet when it does not', () => {
    const told: number[] = []
    const store = new PlanningStore(dir, Date.now, (count) => told.push(count))

    store.add('tabc123')
    store.add('tabc123')
    store.saveStep('tabc123', 'Lavar a máquina', TODAY)
    store.remove('tnao001')

    expect(told).toEqual([1])

    store.remove('tabc123')
    expect(told).toEqual([1, 0])
  })

  it('tells the app when a completed task leaves the focus, and not when the store is read again', () => {
    const told: number[] = []
    const store = new PlanningStore(dir, Date.now, (count) => told.push(count))
    store.add('tabc123')
    store.add('tdef456')

    store.archive('TABC123', { origin: 'Casa', completedAt: '2026-10-17', originalLine: '- [ ] Lavar roupa ^tabc123' })
    expect(told).toEqual([1, 2, 1])

    expect(new PlanningStore(dir, Date.now, (count) => told.push(count)).focus()).toEqual(['tdef456'])
    expect(told).toEqual([1, 2, 1])
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

const MIN = 60_000
const T0 = new Date(2026, 9, 16, 9, 0).getTime()
const BUSY = 'Já há uma sessão de foco em andamento, pausada ou por confirmar. Pare ou confirme essa sessão antes de começar outra.'

describe('PlanningStore timer', () => {
  const lists = parseTasksFile('## Casa\n- [ ] Lavar roupa ^tabc123\n- [ ] Passar pano ^tdef456\n').lists
  let now = T0
  const clock = () => now
  const session = (): Record<string, unknown> | undefined => JSON.parse(readFileSync(join(dir, 'planning.json'), 'utf8')).timer
  const view = (store: PlanningStore, id = 'tabc123') => store.timers().get(id)

  beforeEach(() => {
    now = T0
  })

  it('starts, pauses and resumes a 25-minute session, with the time left taken from the clock', () => {
    const store = new PlanningStore(dir, clock)
    store.add('tabc123')
    store.startTimer('TABC123')
    expect(view(store)).toEqual({ state: 'em andamento', remainingMs: 25 * MIN })

    now = T0 + 5 * MIN
    store.pauseTimer('tabc123')
    now = T0 + 30 * MIN
    expect(view(store)).toEqual({ state: 'pausada', remainingMs: 20 * MIN })

    store.resumeTimer('tabc123')
    now = T0 + 35 * MIN
    expect(view(store)).toEqual({ state: 'em andamento', remainingMs: 15 * MIN })
    expect(session()).toEqual({
      taskId: 'tabc123',
      durationMs: 25 * MIN,
      state: 'em andamento',
      startedAt: T0,
      remainingMs: 20 * MIN,
      resumedAt: T0 + 30 * MIN,
    })
  })

  it('keeps the count when the app is reopened before the deadline', () => {
    const store = new PlanningStore(dir, clock)
    store.add('tabc123')
    store.startTimer('tabc123')

    now = T0 + 10 * MIN
    expect(view(new PlanningStore(dir, clock))).toEqual({ state: 'em andamento', remainingMs: 15 * MIN })
    expect(session()?.state).toBe('em andamento')
  })

  it('a session whose deadline passed while the app was closed is interrompida, never confirmed or completed', () => {
    const store = new PlanningStore(dir, clock)
    store.add('tabc123')
    store.startTimer('tabc123')

    now = T0 + 26 * MIN
    expect(view(new PlanningStore(dir, clock))).toEqual({ state: 'interrompida', remainingMs: 0 })
    expect(session()).toMatchObject({ state: 'interrompida' })
    expect(session()).not.toHaveProperty('confirmedMinutes')

    now = T0 + 3 * 24 * 60 * MIN
    expect(view(new PlanningStore(dir, clock))?.state).toBe('interrompida')
  })

  it('a running session becomes interrompida once its deadline passes, even with the app open', () => {
    const store = new PlanningStore(dir, clock)
    store.add('tabc123')
    store.startTimer('tabc123')

    now = T0 + 25 * MIN
    expect(view(store)).toEqual({ state: 'interrompida', remainingMs: 0 })
  })

  it('a paused session keeps its time and is not interrupted by the clock', () => {
    const store = new PlanningStore(dir, clock)
    store.add('tabc123')
    store.startTimer('tabc123')
    now = T0 + 5 * MIN
    store.pauseTimer('tabc123')

    now = T0 + 5 * 60 * MIN
    expect(view(new PlanningStore(dir, clock))).toEqual({ state: 'pausada', remainingMs: 20 * MIN })
  })

  it('stopping a session interrupts it, and the minutes done are confirmed by the user', () => {
    const store = new PlanningStore(dir, clock)
    store.add('tabc123')
    store.startTimer('tabc123')
    now = T0 + 12 * MIN
    store.stopTimer('tabc123')
    expect(view(store)).toEqual({ state: 'interrompida', remainingMs: 13 * MIN })

    store.confirmTimer('tabc123', 12)
    expect(view(new PlanningStore(dir, clock))).toEqual({ state: 'confirmada', remainingMs: 13 * MIN, confirmedMinutes: 12 })
  })

  it('confirms the minutes of an interrupted session, from 0 to 25, and only an interrupted session can be confirmed', () => {
    const store = new PlanningStore(dir, clock)
    store.add('tabc123')
    store.startTimer('tabc123')
    expect(() => store.confirmTimer('tabc123', 10)).toThrow('Só uma sessão interrompida pode ter os minutos confirmados.')

    now = T0 + 26 * MIN
    new PlanningStore(dir, clock).confirmTimer('tabc123', 0)
    expect(view(new PlanningStore(dir, clock))).toEqual({ state: 'confirmada', remainingMs: 0, confirmedMinutes: 0 })
  })

  it('refuses a second session while one is running, paused or waiting for confirmation', () => {
    const store = new PlanningStore(dir, clock)
    store.add('tabc123')
    store.add('tdef456')
    store.startTimer('tabc123')
    expect(() => store.startTimer('tdef456')).toThrow(BUSY)
    expect(() => store.startTimer('tabc123')).toThrow(BUSY)

    store.pauseTimer('tabc123')
    expect(() => store.startTimer('tdef456')).toThrow(BUSY)

    store.stopTimer('tabc123')
    expect(() => store.startTimer('tdef456')).toThrow(BUSY)

    store.confirmTimer('tabc123', 5)
    store.startTimer('tdef456')
    expect(store.timers().get('tdef456')).toEqual({ state: 'em andamento', remainingMs: 25 * MIN })
  })

  it('keeps the session when its task leaves focus, and the card shows it only while the task is focused', () => {
    const store = new PlanningStore(dir, clock)
    store.add('tabc123')
    store.startTimer('tabc123')
    store.remove('tabc123')

    const reopened = new PlanningStore(dir, clock)
    expect(reopened.focus()).toEqual([])
    expect(view(reopened)).toEqual({ state: 'em andamento', remainingMs: 25 * MIN })
    expect(focusItems(lists, reopened.focus(), new Map(), reopened.timers())).toEqual([])
    expect(() => reopened.pauseTimer('tabc123')).toThrow('Só tarefas em foco podem ter timer de foco.')

    reopened.add('tabc123')
    expect(focusItems(lists, reopened.focus(), new Map(), reopened.timers())).toEqual([
      { id: 'tabc123', missing: false, text: 'Lavar roupa', list: 'Casa', timer: { state: 'em andamento', remainingMs: 25 * MIN } },
    ])
  })

  it('refuses a timer for a task that is not in focus, and writes nothing for it', () => {
    const store = new PlanningStore(dir, clock)
    store.add('tabc123')

    expect(() => store.startTimer('tzzzzzz')).toThrow('Só tarefas em foco podem ter timer de foco.')
    expect(session()).toBeUndefined()
  })

  it('reads a planning.json from before the timer, and drops a timer it cannot use', () => {
    writeFileSync(join(dir, 'planning.json'), JSON.stringify({ focus: ['tabc123'] }), 'utf8')
    expect(new PlanningStore(dir, clock).timers().size).toBe(0)

    writeFileSync(
      join(dir, 'planning.json'),
      JSON.stringify({
        focus: ['tabc123'],
        timer: { taskId: 'tabc123', state: 'em andamento', durationMs: 25 * MIN, startedAt: T0, remainingMs: 25 * MIN },
      }),
      'utf8',
    )
    expect(new PlanningStore(dir, clock).timers().size).toBe(0)
  })

  it('accepts a planning.json with a timer in the backup shape check, and refuses a timer that is not an object', () => {
    expect(shapeOf('planning.json')({ focus: ['tabc123'], steps: {}, timer: { taskId: 'tabc123', state: 'pausada' } })).toBe(true)
    expect(shapeOf('planning.json')({ focus: [], timer: 'nao' })).toBe(false)
  })
})

describe('PlanningStore archive', () => {
  const record = { origin: 'Casa', completedAt: '2026-10-17', originalLine: '- [ ] Lavar roupa ^tabc123' }
  const archived = (): Record<string, unknown> | undefined => JSON.parse(readFileSync(join(dir, 'planning.json'), 'utf8')).archived

  it('takes a completed task out of the focus and keeps its record by id', () => {
    const store = new PlanningStore(dir)
    store.add('tabc123')
    store.add('tdef456')
    store.archive('TABC123', record)

    expect(new PlanningStore(dir).focus()).toEqual(['tdef456'])
    expect(archived()).toEqual({ tabc123: record })
  })

  it('restore gives the record back out, and the focus back when the task had it', () => {
    const store = new PlanningStore(dir)
    store.add('tabc123')
    store.archive('tabc123', record)
    store.restore('tabc123', true)

    expect(new PlanningStore(dir).focus()).toEqual(['tabc123'])
    expect(archived()).toBeUndefined()
  })

  it('restore leaves a task that was not focused out of the focus', () => {
    const store = new PlanningStore(dir)
    store.archive('tabc123', record)
    store.restore('tabc123', false)

    expect(store.focus()).toEqual([])
    expect(archived()).toBeUndefined()
  })

  it('a completed task with a session still open does not block the next session', () => {
    let now = T0
    const store = new PlanningStore(dir, () => now)
    store.add('tabc123')
    store.add('tdef456')
    store.startTimer('tabc123')
    store.archive('tabc123', record)

    now = T0 + MIN
    store.add('tdef456')
    expect(() => store.startTimer('tdef456')).not.toThrow()
    expect(store.timers().get('tdef456')).toEqual({ state: 'em andamento', remainingMs: 25 * MIN })
  })

  it('a planning.json from before the archive loads, and an archive record it cannot use is dropped', () => {
    writeFileSync(join(dir, 'planning.json'), JSON.stringify({ focus: ['tabc123'], steps: {} }), 'utf8')
    expect(new PlanningStore(dir).focus()).toEqual(['tabc123'])
    expect(shapeOf('planning.json')({ focus: ['tabc123'], steps: {} })).toBe(true)

    writeFileSync(
      join(dir, 'planning.json'),
      JSON.stringify({ focus: [], archived: { tabc123: record, tdef456: { origin: 'Casa' } } }),
      'utf8',
    )
    const store = new PlanningStore(dir)
    store.restore('tabc123', false)
    expect(archived()).toBeUndefined()
    expect(shapeOf('planning.json')({ focus: [], archived: 'nao' })).toBe(false)
  })
})

describe('timer helpers', () => {
  it('shows the time left as mm:ss, rounding a part second up', () => {
    expect(clockText(25 * MIN)).toBe('25:00')
    expect(clockText(59_001)).toBe('01:00')
    expect(clockText(1)).toBe('00:01')
    expect(clockText(-5)).toBe('00:00')
  })

  it('accepts whole minutes from 0 to 25, and refuses the rest with a message in pt-BR', () => {
    expect(parseTimerMinutes(0)).toBe(0)
    expect(parseTimerMinutes(18)).toBe(18)
    expect(parseTimerMinutes(25)).toBe(25)

    expect(() => parseTimerMinutes(26)).toThrow('Uma sessão tem no máximo 25 minutos.')
    expect(() => parseTimerMinutes(-1)).toThrow('Os minutos não podem ser negativos.')
    expect(() => parseTimerMinutes(2.5)).toThrow('Os minutos precisam ser um número inteiro.')
    expect(() => parseTimerMinutes('18')).toThrow('Informe os minutos feitos.')
    expect(() => parseTimerMinutes(Number.NaN)).toThrow('Informe os minutos feitos.')
  })

  it('loads a planning.json from before reopening existed: its records pass the shape check and can be let go of', () => {
    const before = {
      focus: ['tabc123'],
      steps: {},
      archived: {
        tabc123: { origin: 'Casa', completedAt: '2026-10-16', originalLine: '- [ ] 16.10.2026 | 09:00 | Casa | Lavar roupa ^tabc123' },
      },
    }
    writeFileSync(join(dir, 'planning.json'), JSON.stringify(before), 'utf8')

    expect(shapeOf('planning.json')(before)).toBe(true)
    const store = new PlanningStore(dir)
    expect(store.archivedOf('TABC123')).toEqual(before.archived.tabc123)

    store.unarchive('tabc123')
    store.unarchive('tabc123')
    expect(new PlanningStore(dir).archivedOf('tabc123')).toBeUndefined()
    expect(new PlanningStore(dir).focus()).toEqual(['tabc123'])
  })
})
