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
let review: ReturnType<typeof registerReviewIpc>
let broadcast: ReturnType<typeof vi.fn>

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
  broadcast = vi.fn()
  review = registerReviewIpc(
    {
      store: {
        dataDirectory: data,
        get settings() {
          return { vaultPath: vault }
        },
        set settings(_v) {},
      } as never,
      planning,
      broadcast,
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

describe('revisão do dia no chat da Luna: o que as ferramentas dela chamam', () => {
  it('o portão oferece uma vez por dia; concluir tira o aviso e apaga o rascunho antigo', async () => {
    expect(await invoke('office:reviewGate')).toBe(true)
    expect(await invoke('office:reviewGate')).toBe(false)
    planning.saveReviewDraft({ day: '2026-10-17', step: 1, choices: {} })
    broadcast.mockClear()

    review.done()

    expect(offerDue(planning, '2026-10-17')).toBe(false)
    expect(planning.reviewDraft()).toBeUndefined()
    expect(broadcast).toHaveBeenCalledWith({ type: 'review:due', due: false })
    expect(broadcast).toHaveBeenCalledWith({ type: 'review:draft', draft: false })
  })

  it('adiar grava a data de retorno e segura o portão até ela', async () => {
    expect(review.postpone(3)).toBe('2026-10-20')
    expect(broadcast).toHaveBeenCalledWith({ type: 'review:nextDay', nextDay: '2026-10-20' })
    expect(await invoke('office:reviewGate')).toBe(false)
    expect(offerDue(planning, '2026-10-20')).toBe(true)
  })

  it('o foco vem como a revisão lê: título, lista e tarefa parada', () => {
    planning.add('tabc123')
    expect(review.focus()).toEqual([{ id: 'tabc123', title: 'Tarefa', list: 'Casa', missing: false, stale: true }])
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
