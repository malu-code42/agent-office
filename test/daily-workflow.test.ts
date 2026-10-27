import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DailyWorkflow, localScheduledAt } from '../src/main/daily-workflow'
import { PersonalRoutineStore } from '../src/main/personal-routines-store'

const dirs: string[] = []
const dir = () => {
  const path = mkdtempSync(join(tmpdir(), 'ao-daily-workflow-'))
  dirs.push(path)
  return path
}
afterEach(() => dirs.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })))

describe('horários locais do workflow diário', () => {
  it('resolve horário civil no fuso local e rejeita horário impossível ou inválido', () => {
    const at = localScheduledAt('2026-10-17', '08:00')!
    expect(new Date(at).getHours()).toBe(8)
    expect(new Date(at).getMinutes()).toBe(0)
    expect(localScheduledAt('2026-10-17', '25:00')).toBeNull()
    expect(localScheduledAt('2026-02-30', '08:00')).toBeNull()
  })

  it('recalcula o horário civil no fuso local vigente', () => {
    const originalTimezone = process.env.TZ
    try {
      process.env.TZ = 'UTC'
      const utc = localScheduledAt('2026-10-17', '08:00')!
      process.env.TZ = 'America/Sao_Paulo'
      const saoPaulo = localScheduledAt('2026-10-17', '08:00')!
      expect(saoPaulo - utc).toBe(3 * 60 * 60_000)
      expect(new Date(saoPaulo).getHours()).toBe(8)
      process.env.TZ = 'America/New_York'
      expect(localScheduledAt('2026-03-08', '02:30')).toBeNull()
    } finally {
      if (originalTimezone === undefined) delete process.env.TZ
      else process.env.TZ = originalTimezone
    }
  })

  it('consolida processos matinal/noturno e lembretes vencidos na reabertura', () => {
    const data = dir()
    const now = new Date(2026, 9, 17, 21, 10)
    const store = new PersonalRoutineStore(data)
    store.setDailyTimes({ morning: '08:00', evening: '20:00' })
    store.markWorkflowDay('2026-10-16')
    const questions: { id: string; question: string; options: { label: string; description: string }[] }[] = []
    const answers: ((value: Record<string, string>) => void)[] = []
    const messages: string[] = []
    const workflow = new DailyWorkflow({
      store,
      now: () => new Date(now),
      routineText: () => 'Caminhada | cadência: diária | hora: 18:00',
      morning: () => 'Agenda, aulas e tarefas de hoje',
      evening: () => 'Resumo do dia e pendências',
      chat: (text) => messages.push(text),
      ask: (items, answer) => {
        questions.push(...items)
        answers.push(answer)
      },
    })

    workflow.check()
    expect(messages).toHaveLength(1)
    expect(messages[0]).toContain('Agenda, aulas e tarefas de hoje')
    expect(messages[0]).toContain('Resumo do dia e pendências')
    expect(messages[0]).toContain('Caminhada')
    expect(questions).toHaveLength(3)
    expect(questions.some((item) => item.id.startsWith('priorities:'))).toBe(true)
    expect(questions.some((item) => item.id.startsWith('next-steps:'))).toBe(true)
    answers[0]!({ 'Quais são suas prioridades para hoje?': 'Compromissos e aulas, Rotinas pessoais' })
    expect(new PersonalRoutineStore(data).dailyPriorities('2026-10-17')).toEqual(['Compromissos e aulas', 'Rotinas pessoais'])

    workflow.check()
    expect(messages).toHaveLength(1)
    expect(questions).toHaveLength(3)
    expect(store.list()).toHaveLength(1)
  })

  it('retries an unanswered routine exactly once after 30 minutes; an explicit answer persists', () => {
    const data = dir()
    let now = new Date(2026, 9, 17, 18, 0)
    const store = new PersonalRoutineStore(data)
    const prompts: {
      items: { id: string; question: string; options: { label: string; description: string }[] }[]
      answer: (answers: Record<string, string>) => void
    }[] = []
    const cancelled: string[] = []
    const workflow = new DailyWorkflow({
      store,
      now: () => new Date(now),
      routineText: () => 'Leitura | cadência: diária | hora: 18:00',
      morning: () => '',
      evening: () => '',
      chat: () => undefined,
      ask: (items, answer) => {
        prompts.push({ items, answer })
        return `request-${prompts.length}`
      },
      cancelRequest: (requestId) => cancelled.push(requestId),
    })

    workflow.check()
    const routinePrompts = () => prompts.filter((batch) => batch.items.some((item) => item.id.startsWith('r')))
    expect(routinePrompts()).toHaveLength(1)
    const occurrenceId = routinePrompts()[0]!.items.find((item) => item.id.startsWith('r'))!.id
    expect(store.reminderAttempts(occurrenceId)).toBe(1)
    workflow.check()
    now = new Date(now.getTime() + 29 * 60_000)
    workflow.check()
    expect(routinePrompts()).toHaveLength(1)
    now = new Date(now.getTime() + 60_000)
    workflow.check()
    expect(routinePrompts()).toHaveLength(2)
    expect(store.reminderAttempts(occurrenceId)).toBe(2)
    expect(cancelled).toEqual(['request-2'])
    now = new Date(now.getTime() + 60 * 60_000)
    workflow.check()
    expect(routinePrompts()).toHaveLength(2)

    now = new Date(2026, 9, 18, 0, 30)
    routinePrompts()[1]!.answer({ [routinePrompts()[1]!.items.find((item) => item.id === occurrenceId)!.question]: 'Concluída' })
    expect(new PersonalRoutineStore(data).occurrence(occurrenceId)).toMatchObject({
      status: 'completed',
      response: 'completed',
      completedAt: '2026-10-17',
    })
  })

  it('does not schedule a routine without an explicit time or infer malformed definitions', () => {
    const store = new PersonalRoutineStore(dir())
    let prompts = 0
    const now = new Date(2026, 9, 17, 7, 0)
    new DailyWorkflow({
      store,
      now: () => now,
      routineText: () => 'Meditação | cadência: diária\nErro | cadência: diária | hora: cedo',
      morning: () => '',
      evening: () => '',
      chat: () => undefined,
      ask: () => {
        prompts++
      },
    }).check()
    expect(prompts).toBe(0)
    expect(store.list()).toEqual([])
  })

  it('recovers after restart, rolls over the local day, and leaves unanswered routines pending in closing review', () => {
    const data = dir()
    const store = new PersonalRoutineStore(data)
    store.setDailyTimes({ morning: '08:00', evening: '20:00' })
    store.markWorkflowDay('2026-10-17')
    let now = new Date(2026, 9, 18, 20, 5)
    const messages: string[] = []
    const prompts: string[] = []
    const workflow = new DailyWorkflow({
      store: new PersonalRoutineStore(data),
      now: () => new Date(now),
      routineText: () => 'Leitura | cadência: diária | hora: 18:00',
      morning: () => 'Manhã',
      evening: (day) => `Revisão de ${day}`,
      chat: (text) => messages.push(text),
      ask: (items) => {
        prompts.push(...items.map((item) => item.id))
      },
    })

    workflow.check()
    expect(messages[0]).toContain('Revisão de 2026-10-17')
    expect(messages[0]).toContain('Rotinas pendentes:\n• Leitura')
    const occurrenceId = prompts.find((id) => id.startsWith('r'))!
    expect(occurrenceId).toMatch(/:2026-10-18$/)
    expect(new PersonalRoutineStore(data).occurrence(occurrenceId)).toMatchObject({
      day: '2026-10-18',
      status: 'pending',
      reminderAttempts: 1,
    })

    now = new Date(2026, 9, 19, 7, 0)
    workflow.check()
    expect(messages).toHaveLength(1)
  })
  it('catches up closing reviews across missed days and preserves saved priorities', () => {
    const data = dir()
    const store = new PersonalRoutineStore(data)
    store.setDailyTimes({ morning: '08:00', evening: '20:00' })
    store.markWorkflowDay('2026-10-14')
    store.saveDailyPriorities('2026-10-17', ['Tarefas com data', 'Rotinas pessoais'])
    const messages: string[] = []
    const questions: string[] = []
    new DailyWorkflow({
      store: new PersonalRoutineStore(data),
      now: () => new Date(2026, 9, 17, 21),
      routineText: () => '',
      morning: () => 'Planejamento',
      evening: (day) => `Revisão ${day}`,
      chat: (text) => messages.push(text),
      ask: (items) => { questions.push(...items.map((item) => item.id)) },
    }).check()
    expect(messages[0]).toContain('Revisão 2026-10-15')
    expect(messages[0]).toContain('Revisão 2026-10-16')
    expect(messages[0]).toContain('Revisão 2026-10-17')
    expect(messages[0]).toContain('Prioridades escolhidas: Tarefas com data, Rotinas pessoais')
    expect(messages[0]).toContain('Prioridades escolhidas: Tarefas com data, Rotinas pessoais')
    expect(questions).toContain('next-steps:2026-10-17')
    expect(new PersonalRoutineStore(data).dailyPriorities('2026-10-17')).toEqual(['Tarefas com data', 'Rotinas pessoais'])
  })

  it('retries an unanswered reminder after a workflow restart', () => {
    const data = dir()
    let now = new Date(2026, 9, 17, 18)
    const store = new PersonalRoutineStore(data)
    const captured: { id: string }[] = []
    const makeWorkflow = (activeStore: PersonalRoutineStore) => new DailyWorkflow({
      store: activeStore,
      now: () => new Date(now),
      routineText: () => 'Leitura | cadência: diária | hora: 18:00',
      morning: () => '', evening: () => '', chat: () => undefined,
      ask: (items) => { captured.push(...items.filter((item) => item.id.startsWith('r')).map((item) => ({ id: item.id }))) },
    })
    makeWorkflow(store).check()
    now = new Date(now.getTime() + 30 * 60_000)
    makeWorkflow(new PersonalRoutineStore(data)).check()
    expect(captured).toHaveLength(2)
    expect(captured[0]!.id).toBe(captured[1]!.id)
    expect(new PersonalRoutineStore(data).reminderAttempts(captured[0]!.id)).toBe(2)
  })
})
