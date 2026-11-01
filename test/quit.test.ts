import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSummary } from '../src/shared/types'
import type { BackgroundTask } from '../src/main/quit'

const h = vi.hoisted(() => ({
  quit: vi.fn(),
  answers: [] as { response: number; checkboxChecked: boolean }[],
  shown: [] as { message?: string; checkboxLabel?: string; detail?: string }[],
}))

vi.mock('electron', () => ({
  app: { quit: h.quit, isPackaged: false, getPath: () => '' },
  dialog: {
    showMessageBox: async (...args: unknown[]) => {
      const opts = args.at(-1) as { message?: string; checkboxLabel?: string }
      h.shown.push(opts)
      return h.answers.shift() ?? { response: 1, checkboxChecked: false }
    },
  },
}))

const { QuitFlow } = await import('../src/main/quit')

const agent = (name: string) => ({ id: `id-${name}`, name, activity: 'editando', status: 'working', source: 'office' }) as AgentSummary
const task = (agentName: string): BackgroundTask => ({ agentId: `id-${agentName}`, agentName, description: 'rodar a suíte' })

function flow(working: AgentSummary[] = [], bg: BackgroundTask[] = [], headless = false) {
  const deps = {
    win: () => null,
    working: vi.fn(() => [...working]),
    pending: vi.fn(() => 0),
    interrupt: vi.fn(async (_id: string) => undefined),
    background: vi.fn(() => [...bg]),
    holdRoutines: vi.fn(),
    broadcast: vi.fn(),
    headless,
  }
  return { q: new QuitFlow(deps), deps }
}

beforeEach(() => {
  h.quit.mockReset()
  h.answers = []
  h.shown = []
})

describe('sair do Agent Office', () => {
  it('⌘Q ou fechar a janela sem ninguém trabalhando sai direto; com agente ou tarefa em segundo plano pergunta', () => {
    expect(flow().q.intercept()).toBe(false)
    expect(flow([agent('Ada')]).q.intercept()).toBe(true)
    expect(flow([], [task('Ada')]).q.intercept()).toBe(true)
    // Screenshot and bench runs never ask.
    expect(flow([agent('Ada')], [], true).q.intercept()).toBe(false)
  })

  it('sem agentes: o botão Sair confirma e sai; depois before-quit deixa passar', async () => {
    const { q, deps } = flow()
    h.answers.push({ response: 0, checkboxChecked: false })
    expect(await q.ask()).toBe('quit')
    expect(h.shown[0].message).toBe('Sair do Agent Office?')
    expect(deps.interrupt).not.toHaveBeenCalled()
    expect(h.quit).toHaveBeenCalledOnce()
    expect(q.intercept()).toBe(false)
  })

  it('cancelar não sai nem interrompe nada', async () => {
    const { q, deps } = flow([agent('Ada')], [task('Bia')])
    h.answers.push({ response: 2, checkboxChecked: true })
    expect(await q.ask()).toBe('cancelled')
    expect(h.quit).not.toHaveBeenCalled()
    expect(deps.interrupt).not.toHaveBeenCalled()
  })

  it('interromper e sair: interrompe quem trabalha e quem tem tarefa em segundo plano', async () => {
    const { q, deps } = flow([agent('Ada'), agent('Barbara')], [task('Barbara'), task('Carla')])
    h.answers.push({ response: 1, checkboxChecked: false })
    expect(await q.ask()).toBe('quit')
    expect(h.shown[0].checkboxLabel).toContain('2 tarefas em segundo plano')
    expect(deps.interrupt.mock.calls.map((c) => c[0]).sort()).toEqual(['id-Ada', 'id-Barbara', 'id-Carla'])
    expect(h.quit).toHaveBeenCalledOnce()
  })

  describe('esperar terminarem', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('segura as rotinas, avisa e sai quando o último termina', async () => {
      const working = [agent('Ada')]
      const { q, deps } = flow(working)
      h.answers.push({ response: 0, checkboxChecked: false })
      expect(await q.ask()).toBe('waiting')
      expect(deps.holdRoutines).toHaveBeenCalledWith(true)
      expect(deps.broadcast).toHaveBeenLastCalledWith({ working: 1, pending: 0, background: 0 })
      expect(h.quit).not.toHaveBeenCalled()
      working.length = 0
      await vi.advanceTimersByTimeAsync(2100)
      expect(h.quit).toHaveBeenCalledOnce()
    })

    it('espera também as tarefas em segundo plano, a menos que o jogador marque para pará-las', async () => {
      const bg = [task('Ada')]
      const waits = flow([], bg)
      h.answers.push({ response: 0, checkboxChecked: false })
      expect(await waits.q.ask()).toBe('waiting')
      expect(waits.deps.broadcast).toHaveBeenLastCalledWith({ working: 0, pending: 0, background: 1 })
      waits.q.cancelWait()

      const stops = flow([], bg)
      h.answers.push({ response: 0, checkboxChecked: true })
      expect(await stops.q.ask()).toBe('waiting')
      await vi.advanceTimersByTimeAsync(10)
      expect(stops.deps.interrupt).toHaveBeenCalledWith('id-Ada')
      expect(h.quit).toHaveBeenCalledOnce()
    })

    it('"Ficar" cancela a espera e solta as rotinas', async () => {
      const { q, deps } = flow([agent('Ada')])
      h.answers.push({ response: 0, checkboxChecked: false })
      await q.ask()
      q.cancelWait()
      expect(deps.holdRoutines).toHaveBeenLastCalledWith(false)
      expect(deps.broadcast).toHaveBeenLastCalledWith(null)
      await vi.advanceTimersByTimeAsync(10_000)
      expect(h.quit).not.toHaveBeenCalled()
    })

    it('"Interromper e sair agora" no aviso interrompe e sai', async () => {
      const { q, deps } = flow([agent('Ada')])
      h.answers.push({ response: 0, checkboxChecked: false })
      await q.ask()
      await q.now()
      expect(deps.interrupt).toHaveBeenCalledWith('id-Ada')
      expect(h.quit).toHaveBeenCalledOnce()
    })
  })
})
