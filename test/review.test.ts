import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAgendaWriter } from '../src/main/agenda-write'
import { PlanningStore } from '../src/main/planning'
import {
  confirmReview,
  draftOf,
  hasDraftToday,
  markOffered,
  offerDue,
  openReview,
  postponeReview,
  saveReviewDraft,
  type ReviewDeps,
} from '../src/main/review'
import { ProposalFailed } from '../src/main/proposals'
import { createTaskWriter } from '../src/main/tasks-write'
import { parse, reviewChoicesSchema, reviewPostponeSchema, reviewStepSchema } from '../src/main/validate'
import { describeOperation } from '../src/shared/proposals'
import {
  addDays,
  daysBetween,
  describeReviewOperations,
  isStale,
  REVIEW_SOURCE,
  REVIEW_STALE_DAYS,
  REVIEW_STEPS,
  reviewNextDay,
  reviewOperations,
  staleText,
  type ReviewChoices,
} from '../src/shared/review'

/**
 * The daily review (AO-12). Every test runs against a temporary vault and a temporary data folder, with the
 * clock injected: no test reads or writes the user's files.
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

const AGENDA = ['# Agenda', '', '## 2026-10-16', '- 09:00 Reunião de pauta', '', '## 2026-10-17', '- 14:00 Dentista', ''].join('\n')

const MORNING = new Date(2026, 9, 17, 9, 0).getTime()
const EVENING = new Date(2026, 9, 17, 18, 0).getTime()
const NEXT_MORNING = new Date(2026, 9, 18, 8, 0).getTime()

let vault: string
let data: string

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), 'ao-review-vault-'))
  data = mkdtempSync(join(tmpdir(), 'ao-review-data-'))
  writeFileSync(join(vault, 'tarefas.md'), TASKS)
  writeFileSync(join(vault, 'agenda.md'), AGENDA)
})

afterEach(() => {
  rmSync(vault, { recursive: true, force: true })
  rmSync(data, { recursive: true, force: true })
})

/** The deps of the review at a clock time. Reopening the planning store with the same clock is a new app session. */
function deps(clock: { t: number }, newId?: () => string): ReviewDeps {
  return {
    planning: new PlanningStore(data, () => clock.t),
    tasks: createTaskWriter({ now: () => new Date(clock.t) }),
    agenda: createAgendaWriter({ now: () => new Date(clock.t) }),
    now: () => new Date(clock.t),
    newId,
  }
}

const tasksFile = () => readFileSync(join(vault, 'tarefas.md'), 'utf8')
const agendaFile = () => readFileSync(join(vault, 'agenda.md'), 'utf8')
const planningFile = () => JSON.parse(readFileSync(join(data, 'planning.json'), 'utf8'))

describe('gate: the offer', () => {
  it('shows on the first open of the day and not again when the app is reopened the same day', () => {
    const clock = { t: MORNING }
    const first = deps(clock)
    expect(offerDue(first.planning, '2026-10-17')).toBe(true)
    markOffered(first.planning, '2026-10-17')

    clock.t = EVENING
    expect(offerDue(new PlanningStore(data, () => clock.t), '2026-10-17')).toBe(false)
  })

  it('shows again on the next local day', () => {
    const clock = { t: MORNING }
    markOffered(deps(clock).planning, '2026-10-17')

    clock.t = NEXT_MORNING
    expect(offerDue(new PlanningStore(data, () => clock.t), '2026-10-18')).toBe(true)
  })

  it('the mark survives a restart: it is written to planning.json', () => {
    const clock = { t: MORNING }
    markOffered(deps(clock).planning, '2026-10-17')
    expect(planningFile().review.offered).toBe('2026-10-17')
  })

  it('showing the offer sets no return date, so it still opens and confirms today (#102)', () => {
    const clock = { t: MORNING }
    const p = deps(clock).planning
    markOffered(p, '2026-10-17')
    expect(p.reviewNextDay()).toBeUndefined()
  })

  it('a postponement still running holds the offer back', () => {
    const clock = { t: MORNING }
    const p = deps(clock).planning
    postponeReview(p, '2026-10-17', 2)
    expect(offerDue(p, '2026-10-18')).toBe(false)
    expect(offerDue(p, '2026-10-19')).toBe(true)
  })
})

describe('postpone: Adiar and Dispensar hoje', () => {
  it('adiar 1, 2 and 3 days and 1 week compute the right local day', () => {
    const clock = { t: MORNING }
    const p = deps(clock).planning
    expect(postponeReview(p, '2026-10-17', 1)).toBe('2026-10-18')
    expect(postponeReview(p, '2026-10-17', 2)).toBe('2026-10-19')
    expect(postponeReview(p, '2026-10-17', 3)).toBe('2026-10-20')
    expect(postponeReview(p, '2026-10-17', 7)).toBe('2026-10-24')
  })

  it('crosses the month end by the calendar', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02')
    expect(reviewNextDay('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('"dispensar hoje" offers again the next day, not later', () => {
    expect(reviewNextDay('2026-10-17', 'dispensar')).toBe('2026-10-18')
  })

  it('dispensar (or Esc, which is the same) gives no offer again that day and changes nothing else', () => {
    const clock = { t: MORNING }
    const p = deps(clock).planning
    markOffered(p, '2026-10-17')
    const before = JSON.parse(readFileSync(join(data, 'planning.json'), 'utf8'))
    postponeReview(p, '2026-10-17', 'dispensar')

    expect(offerDue(new PlanningStore(data, () => clock.t), '2026-10-17')).toBe(false)
    expect(offerDue(new PlanningStore(data, () => clock.t), '2026-10-18')).toBe(true)
    // Only the return date is new.
    expect(JSON.parse(readFileSync(join(data, 'planning.json'), 'utf8'))).toEqual({
      ...before,
      review: { ...before.review, next: '2026-10-18' },
    })
  })

  it('the postpone options are checked: 4 days and "concluir" are refused', () => {
    expect(reviewPostponeSchema.safeParse(4).success).toBe(false)
    expect(reviewPostponeSchema.safeParse('concluir').success).toBe(false)
    for (const option of [1, 2, 3, 7, 'dispensar']) expect(reviewPostponeSchema.safeParse(option).success).toBe(true)
  })
})

describe('draft: kept until the end of the day', () => {
  it('starting persists an empty draft immediately; reopening reads current tasks and keeps saved step and choices', () => {
    const clock = { t: MORNING }
    const d = deps(clock)
    d.planning.add('tabc123')

    // This is the save performed by Começar before the wizard opens.
    saveReviewDraft(d.planning, '2026-10-17', 0, {})
    expect(hasDraftToday(new PlanningStore(data, () => clock.t), new Date(clock.t))).toBe(true)

    saveReviewDraft(d.planning, '2026-10-17', 2, { tabc123: { kind: 'revisar' } })
    writeFileSync(join(vault, 'tarefas.md'), TASKS.replace('Lavar roupa', 'Lavar roupa hoje'))
    clock.t = EVENING

    const resumed = openReview(vault, deps(clock))
    expect(resumed.resumed).toBe(true)
    expect(resumed.step).toBe(2)
    expect(resumed.choices).toEqual({ tabc123: { kind: 'revisar' } })
    expect(resumed.focus.find((task) => task.id === 'tabc123')?.title).toBe('Lavar roupa hoje')
  })

  it('postpone and dismiss do not create a review draft', () => {
    const clock = { t: MORNING }
    const d = deps(clock)
    postponeReview(d.planning, '2026-10-17', 2)
    expect(hasDraftToday(new PlanningStore(data, () => clock.t), new Date(clock.t))).toBe(false)

    postponeReview(d.planning, '2026-10-17', 'dispensar')
    expect(hasDraftToday(new PlanningStore(data, () => clock.t), new Date(clock.t))).toBe(false)
  })

  it('a draft is saved and resumed the same day, at the same step with the same choices', () => {
    const clock = { t: MORNING }
    const first = deps(clock)
    first.planning.add('tabc123')
    first.planning.add('tdef456')
    const choices: ReviewChoices = {
      tabc123: { kind: 'reagendar', date: '20.10.2026' },
      tdef456: { kind: 'descartar', reason: 'Não vale mais' },
    }
    saveReviewDraft(first.planning, '2026-10-17', 2, choices)

    clock.t = EVENING
    const view = openReview(vault, deps(clock))
    expect(view.resumed).toBe(true)
    expect(view.step).toBe(2)
    expect(view.choices).toEqual(choices)
    expect(hasDraftToday(new PlanningStore(data, () => clock.t), new Date(clock.t))).toBe(true)
  })

  it('a draft from yesterday is not resumed, and is dropped', () => {
    const clock = { t: MORNING }
    const p = deps(clock).planning
    p.add('tabc123')
    p.saveReviewDraft({ day: '2026-10-16', step: 3, choices: { tabc123: { kind: 'revisar' } } })

    clock.t = NEXT_MORNING
    const view = openReview(vault, deps(clock))
    expect(view.resumed).toBe(false)
    expect(view.step).toBe(0)
    expect(view.choices).toEqual({})
    expect(planningFile().review?.draft).toBeUndefined()
    expect(draftOf(new PlanningStore(data, () => clock.t), '2026-10-18')).toBeUndefined()
  })

  it('a choice for a task that left the focus is not shown when the review resumes', () => {
    const clock = { t: MORNING }
    const d = deps(clock)
    d.planning.add('tabc123')
    d.planning.add('tdef456')
    saveReviewDraft(d.planning, '2026-10-17', 1, { tabc123: { kind: 'revisar' }, tdef456: { kind: 'revisar' } })
    d.planning.remove('tdef456')

    clock.t = EVENING
    expect(openReview(vault, deps(clock)).choices).toEqual({ tabc123: { kind: 'revisar' } })
  })

  it('choices of tasks that are not in focus are not kept in the draft', () => {
    const clock = { t: MORNING }
    const d = deps(clock)
    d.planning.add('tabc123')
    saveReviewDraft(d.planning, '2026-10-17', 1, { tabc123: { kind: 'revisar' }, tzzzzzz: { kind: 'revisar' } })
    expect(Object.keys(new PlanningStore(data, () => clock.t).reviewDraft()!.choices)).toEqual(['tabc123'])
  })
})

describe('steps', () => {
  it('the four steps come in this order', () => {
    expect(REVIEW_STEPS).toEqual(['agenda', 'foco', 'estudos', 'confirmar'])
    expect(parse(reviewStepSchema, 3, 'x')).toBe(3)
    expect(reviewStepSchema.safeParse(4).success).toBe(false)
  })

  it('the agenda step shows the commitments of today from agenda.md, and nothing from other days', () => {
    const clock = { t: MORNING }
    const view = openReview(vault, deps(clock))
    expect(view.agenda).toEqual({ found: true, items: [{ time: '14:00', title: 'Dentista' }] })
  })

  it('the agenda step says so when there is no agenda.md', () => {
    rmSync(join(vault, 'agenda.md'))
    expect(openReview(vault, deps({ t: MORNING })).agenda).toEqual({ found: false, items: [] })
  })

  it('the confirm step lists the exact operations before anything is applied', () => {
    const clock = { t: MORNING }
    const d = deps(clock)
    d.planning.add('tabc123')
    d.planning.add('tdef456')
    const choices: ReviewChoices = {
      tabc123: { kind: 'reagendar', date: '20.10.2026' },
      tdef456: { kind: 'descartar', reason: 'Não vale mais' },
    }
    const view = openReview(vault, d)
    const titles = new Map(view.focus.map((r) => [r.id, r.title]))
    const ops = reviewOperations(choices, ['tabc123', 'tdef456'], (id) => titles.get(id))
    const lines = describeReviewOperations(ops, (id) => titles.get(id))

    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('Reagendar')
    expect(lines[0]).toContain('20.10.2026')
    expect(lines[1]).toContain('Descartar')
    expect(lines[1]).toContain('Não vale mais')
    expect(tasksFile()).toBe(TASKS)
  })

  it('the reschedule and discard choices need a date and a reason before the review can confirm', () => {
    expect(() => reviewOperations({ tabc123: { kind: 'descartar', reason: '  ' } }, ['tabc123'])).toThrow(/motivo/)
    expect(() => reviewOperations({ tabc123: { kind: 'reagendar', date: '' } }, ['tabc123'])).toThrow(/data/)
  })
})

describe('closing without confirming', () => {
  it('writes nothing to tarefas.md and agenda.md, and keeps the draft', () => {
    const clock = { t: MORNING }
    const d = deps(clock)
    d.planning.add('tabc123')
    openReview(vault, d)
    saveReviewDraft(d.planning, '2026-10-17', 1, { tabc123: { kind: 'descartar', reason: 'Vou ver depois' } })

    expect(tasksFile()).toBe(TASKS)
    expect(agendaFile()).toBe(AGENDA)
    clock.t = EVENING
    const again = openReview(vault, deps(clock))
    expect(again.resumed).toBe(true)
    expect(again.choices).toEqual({ tabc123: { kind: 'descartar', reason: 'Vou ver depois' } })
  })
})

describe('confirmar', () => {
  it('applies every choice through the proposal mechanism: tarefas.md changes, the focus follows, the draft ends', () => {
    const clock = { t: MORNING }
    const d = deps(clock)
    d.planning.add('tabc123')
    d.planning.add('tdef456')
    openReview(vault, d)
    const choices: ReviewChoices = {
      tabc123: { kind: 'reagendar', date: '20.10.2026' },
      tdef456: { kind: 'descartar', reason: 'Não vale mais' },
    }
    saveReviewDraft(d.planning, '2026-10-17', 3, choices)

    expect(confirmReview(vault, choices, d)).toEqual({ applied: 2 })
    expect(tasksFile()).toContain('- [ ] 20.10.2026 | 09:00 | Casa | Lavar roupa ^tabc123')
    expect(tasksFile()).toContain('Não vale mais ^tdef456')
    expect(new PlanningStore(data, () => clock.t).focus()).toEqual(['tabc123'])
    expect(planningFile().proposals).toBeUndefined()
    expect(planningFile().review?.draft).toBeUndefined()
    expect(REVIEW_SOURCE).toBe('revisão')
  })

  it('one failure applies none: tarefas.md, the focus and the pending proposals stay as they were', () => {
    const clock = { t: MORNING }
    const d = deps(clock)
    d.planning.add('tabc123')
    d.planning.add('tzzzzzz')
    openReview(vault, d)
    const choices: ReviewChoices = {
      tabc123: { kind: 'reagendar', date: '20.10.2026' },
      tzzzzzz: { kind: 'descartar', reason: 'Sumiu do arquivo' },
    }

    let caught: unknown
    try {
      confirmReview(vault, choices, d)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(ProposalFailed)
    expect((caught as Error).message).toMatch(/Nada foi escrito/)
    expect(tasksFile()).toBe(TASKS)
    expect(new PlanningStore(data, () => clock.t).focus()).toEqual(['tabc123', 'tzzzzzz'])
    expect(new PlanningStore(data, () => clock.t).pendingProposals()).toEqual([])
  })

  it('with no operations (everything continues), no file changes and the day is done', () => {
    const clock = { t: MORNING }
    const d = deps(clock)
    d.planning.add('tabc123')
    openReview(vault, d)
    saveReviewDraft(d.planning, '2026-10-17', 3, {})

    expect(confirmReview(vault, {}, d)).toEqual({ applied: 0 })
    expect(tasksFile()).toBe(TASKS)
    expect(agendaFile()).toBe(AGENDA)
    expect(planningFile().review?.draft).toBeUndefined()
  })

  it('refuses a choice for a task that is not in focus', () => {
    const d = deps({ t: MORNING })
    d.planning.add('tabc123')
    openReview(vault, d)
    expect(() => confirmReview(vault, { tqqqqqq: { kind: 'revisar' } }, d)).toThrow(/não está mais em foco/)
  })

  it('refuses when tarefas.md changed since the review read it, and writes nothing', () => {
    const clock = { t: MORNING }
    const d = deps(clock)
    d.planning.add('tabc123')
    openReview(vault, d)
    writeFileSync(join(vault, 'tarefas.md'), TASKS.replace('Lavar roupa', 'Lavar a roupa'))
    const changed = tasksFile()

    expect(() => confirmReview(vault, { tabc123: { kind: 'reagendar', date: '20.10.2026' } }, d)).toThrow()
    expect(tasksFile()).toBe(changed)
    expect(new PlanningStore(data, () => clock.t).pendingProposals()).toEqual([])
  })
})

describe('Concluir is never produced by the review', () => {
  it('the choices schema refuses a "concluir" choice, and the operations never carry one', () => {
    expect(reviewChoicesSchema.safeParse({ tabc123: { kind: 'concluir' } }).success).toBe(false)
    expect(reviewChoicesSchema.safeParse({ tabc123: { kind: 'complete' } }).success).toBe(false)
    const ops = reviewOperations(
      { tabc123: { kind: 'reagendar', date: '20.10.2026' }, tdef456: { kind: 'descartar', reason: 'x' }, t1a2b3c: { kind: 'revisar' } },
      ['tabc123', 'tdef456', 't1a2b3c'],
    )
    expect(ops.map((op) => op.kind).sort()).toEqual(['discard', 'reschedule'])
  })
})

describe('the focus and the day', () => {
  it('the focus is not cleared when the day changes', () => {
    const clock = { t: MORNING }
    deps(clock).planning.add('tabc123')
    clock.t = NEXT_MORNING
    expect(new PlanningStore(data, () => clock.t).focus()).toEqual(['tabc123'])
    expect(openReview(vault, deps(clock)).focus.map((r) => r.id)).toEqual(['tabc123'])
  })
})

describe('the stale suggestion', () => {
  it('the constant is 3 days', () => {
    expect(REVIEW_STALE_DAYS).toBe(3)
    expect(staleText()).toContain(`${REVIEW_STALE_DAYS} dias`)
  })

  it('counts whole days, today is day 0', () => {
    expect(daysBetween('2026-10-14', '2026-10-17')).toBe(REVIEW_STALE_DAYS)
    expect(isStale(addDays('2026-10-17', -(REVIEW_STALE_DAYS - 1)), '2026-10-17')).toBe(false)
    expect(isStale(addDays('2026-10-17', -REVIEW_STALE_DAYS), '2026-10-17')).toBe(true)
    expect(isStale(undefined, '2026-10-17')).toBe(true)
  })

  it('a focused task with a step in the last REVIEW_STALE_DAYS days gets no suggestion; one without gets it', () => {
    const clock = { t: MORNING }
    const d = deps(clock)
    d.planning.add('tabc123')
    d.planning.add('tdef456')
    d.planning.add('t1a2b3c')
    d.planning.saveStep('tabc123', 'Separar as roupas', addDays('2026-10-17', -(REVIEW_STALE_DAYS - 1)))
    d.planning.saveStep('tdef456', 'Pano limpo', '2026-10-10')
    const rows = openReview(vault, d).focus
    expect(rows.find((r) => r.id === 'tabc123')?.stale).toBe(false)
    expect(rows.find((r) => r.id === 'tdef456')?.stale).toBe(true)
    expect(rows.find((r) => r.id === 't1a2b3c')?.stale).toBe(true)
  })

  it('a task completed is not suggested', () => {
    const clock = { t: MORNING }
    const d = deps(clock)
    d.planning.add('t1a2b3c')
    d.planning.archive('t1a2b3c', { origin: 'Estudo', completedAt: '2026-10-01', originalLine: '- [ ] Ler capítulo 3 ^t1a2b3c' })
    expect(openReview(vault, d).focus).toEqual([])
  })
})

describe('the review modules do not call an AI client', () => {
  const entries = ['src/shared/review.ts', 'src/main/review.ts', 'src/main/ipc/review.ts']
  const forbidden = /anthropic|claude-agent|openai|gemini|generative-ai|(^|\/)agents\/|session-process|claude-messages/i

  /**
   * The modules a file loads when it runs: its value imports. `import type` and `export type` are erased by the
   * compiler, so the SDK types squads.ts and ledger.ts take do not load anything.
   */
  const importsOf = (file: string): string[] => {
    const text = readFileSync(file, 'utf8')
    const out: string[] = []
    for (const m of text.matchAll(/\bimport\s+(type\s+)?[^'";]*?from\s*['"]([^'"]+)['"]/g)) if (!m[1]) out.push(m[2]!)
    for (const m of text.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push(m[1]!)
    for (const m of text.matchAll(/\bimport\s+['"]([^'"]+)['"]/g)) out.push(m[1]!)
    for (const m of text.matchAll(/\bexport\s+(type\s+)?[^'";]*?from\s*['"]([^'"]+)['"]/g)) if (!m[1]) out.push(m[2]!)
    return out
  }

  /** Where a specifier points inside src/, or null for a package or a built-in. */
  const localOf = (from: string, spec: string): string | null => {
    const base = spec.startsWith('@shared/')
      ? resolve('src/shared', spec.slice(8))
      : spec.startsWith('.')
        ? resolve(dirname(from), spec)
        : null
    if (!base) return null
    return [`${base}.ts`, join(base, 'index.ts'), `${base}.tsx`].find((p) => existsSync(p)) ?? null
  }

  it('no module the review loads at run time, directly or through the app, reaches an AI client', () => {
    const seen = new Set<string>()
    const hits: string[] = []
    const walk = (file: string) => {
      if (seen.has(file)) return
      seen.add(file)
      for (const spec of importsOf(file)) {
        if (forbidden.test(spec)) hits.push(`${file} -> ${spec}`)
        const next = localOf(file, spec)
        if (next) walk(next)
      }
    }
    for (const entry of entries) walk(resolve(entry))
    expect(hits).toEqual([])
    expect(seen.size).toBeGreaterThan(entries.length)
  })
})

describe('files', () => {
  it('tarefas.md and agenda.md stay byte-identical until a confirmed proposal changes them', () => {
    const clock = { t: MORNING }
    const d = deps(clock)
    d.planning.add('tabc123')
    markOffered(d.planning, '2026-10-17')
    openReview(vault, d)
    saveReviewDraft(d.planning, '2026-10-17', 2, { tabc123: { kind: 'reagendar', date: '20.10.2026' } })
    postponeReview(d.planning, '2026-10-17', 2)

    expect(tasksFile()).toBe(TASKS)
    expect(agendaFile()).toBe(AGENDA)
  })

  it('a confirmed review changes only what its operations name', () => {
    const clock = { t: MORNING }
    const d = deps(clock)
    d.planning.add('tabc123')
    openReview(vault, d)
    confirmReview(vault, { tabc123: { kind: 'reagendar', date: '20.10.2026' } }, d)
    expect(agendaFile()).toBe(AGENDA)
    expect(tasksFile()).not.toBe(TASKS)
  })
})

describe('the operation texts come from the proposal words', () => {
  it('reschedule and discard are described as proposals describe them', () => {
    const titleOf = (id: string) => (id === 'tabc123' ? 'Lavar roupa' : undefined)
    const text = describeOperation({ kind: 'reschedule', id: 'tabc123', date: '20.10.2026' }, titleOf)
    expect(text).toContain('Lavar roupa')
    expect(text).toContain('20.10.2026')
  })
})
