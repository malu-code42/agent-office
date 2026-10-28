import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlanningStore } from '../src/main/planning'
import { createTaskWriter } from '../src/main/tasks-write'
import { createAgendaWriter } from '../src/main/agenda-write'
import { offerDue } from '../src/main/review'

const ipc = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
}))
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => ipc.handlers.set(channel, handler) },
}))

const { registerReviewIpc } = await import('../src/main/ipc/review')
const invoke = (channel: string, ...args: unknown[]): Promise<unknown> => ipc.handlers.get(channel)!(undefined, ...args) as Promise<unknown>

let vault: string
let data: string
let planning: PlanningStore
let tasksWriter: ReturnType<typeof createTaskWriter>

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 17, 12)) // 2026-10-17
  vault = mkdtempSync(join(tmpdir(), 'ao-review-ipc-'))
  data = mkdtempSync(join(tmpdir(), 'ao-review-ipc-data-'))
  writeFileSync(join(vault, 'tarefas.md'), '## Casa\n- [ ] Tarefa ^tabc123\n')
  writeFileSync(join(vault, 'agenda.md'), '')
  ipc.handlers.clear()
  planning = new PlanningStore(data, () => Date.now())
  tasksWriter = createTaskWriter({ now: () => new Date() })
  // popula o cache de leitura do escritor de tarefas (current exige remember prévio)
  tasksWriter.remember(vault, readFileSync(join(vault, 'tarefas.md'), 'utf8'))
  registerReviewIpc(
    {
      store: { dataDirectory: data, get settings() { return { vaultPath: vault } }, set settings(_v) {} } as never,
      planning,
      broadcast: vi.fn(),
    } as never,
    { tasks: tasksWriter, agenda: createAgendaWriter({ now: () => new Date() }), vault: () => vault } as never,
    {} as never,
  )
})

afterEach(() => {
  vi.useRealTimers()
  rmSync(vault, { recursive: true, force: true })
  rmSync(data, { recursive: true, force: true })
})

afterEach(() => {
  rmSync(vault, { recursive: true, force: true })
  rmSync(data, { recursive: true, force: true })
})

describe('confirmReview IPC: não confirma enquanto o rascunho está adiado', () => {
  const draft = { day: '2026-10-17', step: 0, choices: {} }

  it('recusa a confirmação quando o retorno está no futuro', async () => {
    planning.saveReviewDraft(draft)
    planning.setReviewNextDay('2026-10-20')

    await expect(invoke('office:confirmReview', {})).rejects.toThrow('data de retorno')

    // o rascunho não é limpo pela confirmação recusada
    expect(planning.reviewDraft()?.day).toBe('2026-10-17')
    expect(planning.reviewNextDay()).toBe('2026-10-20')
  })

  it('permite confirmar quando a data de retorno já chegou', async () => {
    planning.saveReviewDraft(draft)
    planning.setReviewNextDay('2026-10-17')

    const result = await invoke('office:confirmReview', {})

    expect(result).toEqual({ applied: 0 })
    expect(planning.reviewDraft()).toBeUndefined() // limpo pela confirmação
  })

  it('permite confirmar quando nunca foi adiado (reviewNextDay nulo)', async () => {
    planning.saveReviewDraft(draft)
    expect(planning.reviewNextDay()).toBeUndefined()

    const result = await invoke('office:confirmReview', {})

    expect(result).toEqual({ applied: 0 })
    expect(planning.reviewDraft()).toBeUndefined()
  })

  it('não aplica o gate de adiamento quando não há rascunho', async () => {
    // sem rascunho: não há o que confirmar, o gate de data não se aplica
    const result = await invoke('office:confirmReview', {})

    expect(result).toEqual({ applied: 0 })
  })

  it('openReview recusa quando o retorno está no futuro (sem rascunho)', async () => {
    planning.setReviewNextDay('2026-10-20')

    await expect(invoke('office:openReview')).rejects.toThrow('data de retorno')
  })

  it('openReview permite quando a data de retorno já chegou (sem rascunho)', async () => {
    planning.setReviewNextDay('2026-10-17')

    const result = (await invoke('office:openReview')) as { day: string; entries: unknown[]; focus: unknown[] }

    expect(result.day).toBe('2026-10-17')
    expect(result.focus).toEqual([])
  })

  it('confirmReview recusa quando o retorno está no futuro (sem rascunho)', async () => {
    planning.setReviewNextDay('2026-10-20')

    await expect(invoke('office:confirmReview', {})).rejects.toThrow('data de retorno')
  })

  it('confirmReview permite quando a data de retorno já chegou (sem rascunho)', async () => {
    planning.setReviewNextDay('2026-10-17')

    const result = await invoke('office:confirmReview', {})

    expect(result).toEqual({ applied: 0 })
  })
})

describe('PlanningStore persiste reviewNextDay após reinício', () => {
  it('recupera reviewNextDay num novo PlanningStore sobre o mesmo data dir', async () => {
    planning.setReviewNextDay('2026-10-20')
    planning.saveReviewDraft({ day: '2026-10-17', step: 0, choices: {} })

    // novo PlanningStore lendo o mesmo diretório de dados (simula reinício do app)
    const restored = new PlanningStore(data, () => Date.now())

    expect(restored.reviewNextDay()).toBe('2026-10-20')
    expect(restored.reviewDraft()?.day).toBe('2026-10-17')
    // offerDue respeita a data de retorno: ainda não chegou em 2026-10-18
    expect(offerDue(restored, '2026-10-18')).toBe(false)
    expect(offerDue(restored, '2026-10-20')).toBe(true)
  })
})
