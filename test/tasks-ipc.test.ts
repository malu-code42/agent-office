import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlanningStore } from '../src/main/planning'

const ipc = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  selectedPath: null as string | null,
  canceled: false,
}))
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => ipc.handlers.set(channel, handler) },
  dialog: {
    showOpenDialog: async () => ({ canceled: ipc.canceled, filePaths: ipc.selectedPath ? [ipc.selectedPath] : [] }),
  },
}))

const { registerTasksIpc } = await import('../src/main/ipc/tasks')
const invoke = (channel: string, ...args: unknown[]) => ipc.handlers.get(channel)!(undefined, ...args)

let vault: string
let data: string
let planning: PlanningStore
let settings: { vaultPath?: string }
let broadcast: ReturnType<typeof vi.fn>

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), 'ao-vault-'))
  data = mkdtempSync(join(tmpdir(), 'ao-focus-data-'))
  planning = new PlanningStore(data)
  settings = {}
  broadcast = vi.fn()
  ipc.handlers.clear()
  ipc.selectedPath = null
  ipc.canceled = false
  registerTasksIpc({
    win: () => ({}) as never,
    store: {
      get settings() {
        return settings
      },
      set settings(value) {
        settings = value
      },
    } as never,
    planning,
    broadcast,
  } as never)
})

afterEach(() => {
  rmSync(vault, { recursive: true, force: true })
  rmSync(data, { recursive: true, force: true })
})

describe('tasks IPC', () => {
  it('reads only the vault selected and saved through the native folder dialog', async () => {
    const source = '---\nkanban-plugin: board\n---\n## Casa\n- [ ] Lavar roupa ^t1a2b3c\n## Leituras\n'
    const file = join(vault, 'tarefas.md')
    writeFileSync(file, source, 'utf8')
    ipc.selectedPath = vault

    const selected = (await invoke('office:selectTasksVault')) as {
      vaultPath: string
      board: { lists: { name: string; tasks: { text: string; status: string }[] }[]; warnings: string[] }
    }
    const read = (await invoke('office:readTasks', 'C:/renderer-supplied-path')) as typeof selected.board

    expect(settings.vaultPath).toBe(vault)
    expect(selected.vaultPath).toBe(vault)
    expect(selected.board.lists).toEqual([
      { name: 'Casa', tasks: [{ text: 'Lavar roupa', line: 5, status: 'open', id: 't1a2b3c' }] },
      { name: 'Leituras', tasks: [] },
    ])
    expect(read).toEqual(selected.board)
    expect(readFileSync(file, 'utf8')).toBe(source)
    expect(broadcast).toHaveBeenCalledWith({ type: 'settings', settings: { vaultPath: vault } })
  })

  it('does not change settings when the folder dialog is canceled', async () => {
    settings.vaultPath = 'C:/old-vault'
    ipc.canceled = true

    await expect(invoke('office:selectTasksVault')).resolves.toBeNull()
    expect(settings.vaultPath).toBe('C:/old-vault')
    expect(broadcast).not.toHaveBeenCalled()
  })

  it('does not save a selected folder that has no tarefas.md', async () => {
    ipc.selectedPath = vault

    await expect(invoke('office:selectTasksVault')).rejects.toThrow(`tarefas.md não encontrado em ${vault}`)
    expect(settings.vaultPath).toBeUndefined()
    expect(broadcast).not.toHaveBeenCalled()
  })

  it('creates a task in the saved vault and returns the board read again', async () => {
    const file = join(vault, 'tarefas.md')
    writeFileSync(file, '## Casa\n- [ ] Lavar roupa ^t1a2b3c\n', 'utf8')
    settings.vaultPath = vault
    await invoke('office:readTasks')

    const created = (await invoke('office:createTask', { title: 'Passar pano', list: 'Casa' })) as {
      id: string
      board: { lists: { name: string; tasks: { text: string }[] }[] }
    }

    expect(created.id).toMatch(/^t[a-z0-9]{6}$/)
    expect(readFileSync(file, 'utf8')).toBe(`## Casa\n- [ ] Lavar roupa ^t1a2b3c\n- [ ] Casa | Passar pano ^${created.id}\n`)
    expect(created.board.lists[0]!.tasks.map((task) => task.text)).toEqual(['Lavar roupa', 'Passar pano'])
  })

  it('refuses a task with an empty title and writes nothing', async () => {
    const source = '## Casa\n- [ ] Lavar roupa ^t1a2b3c\n'
    const file = join(vault, 'tarefas.md')
    writeFileSync(file, source, 'utf8')
    settings.vaultPath = vault
    await invoke('office:readTasks')

    await expect(invoke('office:createTask', { title: '  ', list: 'Casa' })).rejects.toThrow('Escreva o título da tarefa.')
    expect(readFileSync(file, 'utf8')).toBe(source)
  })

  it('moves a task in the saved vault and returns the board read again', async () => {
    const file = join(vault, 'tarefas.md')
    writeFileSync(file, '## Estudo\n- [ ] Ler capítulo ^t1a2b3c\n## Casa\n- [ ] Lavar roupa ^t4d5e6f\n', 'utf8')
    settings.vaultPath = vault
    await invoke('office:readTasks')

    const moved = (await invoke('office:moveTask', { line: 2, list: 'Casa' })) as {
      board: { lists: { name: string; tasks: { text: string }[] }[] }
    }

    expect(readFileSync(file, 'utf8')).toBe('## Estudo\n## Casa\n- [ ] Lavar roupa ^t4d5e6f\n- [ ] Ler capítulo ^t1a2b3c\n')
    expect(moved.board.lists.map((list) => list.tasks.map((task) => task.text))).toEqual([[], ['Lavar roupa', 'Ler capítulo']])
  })

  it('refuses a move to the Archive or from a line that is not a number, and writes nothing', async () => {
    const source = '## Estudo\n- [ ] Ler capítulo ^t1a2b3c\n## Archive\n'
    const file = join(vault, 'tarefas.md')
    writeFileSync(file, source, 'utf8')
    settings.vaultPath = vault
    await invoke('office:readTasks')

    await expect(invoke('office:moveTask', { line: 2, list: 'Archive' })).rejects.toThrow('Não é possível mover tarefas para o Archive')
    await expect(invoke('office:moveTask', { line: 0, list: 'Estudo' })).rejects.toThrow('Movimento inválido.')
    expect(readFileSync(file, 'utf8')).toBe(source)
  })

  it('reschedules a task in the saved vault, and refuses a date that is not a day', async () => {
    const file = join(vault, 'tarefas.md')
    writeFileSync(file, '## Casa\n- [ ] Casa | Lavar roupa ^t1a2b3c\n', 'utf8')
    settings.vaultPath = vault
    await invoke('office:readTasks')

    const rescheduled = (await invoke('office:rescheduleTask', { line: 2, date: '17.10.2026' })) as {
      board: { lists: { tasks: { text: string; date?: string }[] }[] }
    }

    expect(readFileSync(file, 'utf8')).toBe('## Casa\n- [ ] 17.10.2026 | Casa | Lavar roupa ^t1a2b3c\n')
    expect(rescheduled.board.lists[0]!.tasks[0]).toMatchObject({ text: 'Lavar roupa', date: '17.10.2026' })
    await expect(invoke('office:rescheduleTask', { line: 2, date: '31.02.2026' })).rejects.toThrow('Reagendamento inválido.')
  })

  it('requires a previously selected vault to read tasks', async () => {
    await expect(invoke('office:readTasks')).rejects.toThrow('Configure a pasta do vault em Ajustes → Tarefas do Obsidian.')
  })

  it('reports a readable error when the saved vault is missing', async () => {
    settings.vaultPath = join(vault, 'missing')

    await expect(invoke('office:readTasks')).rejects.toThrow(`A pasta do vault não existe: ${settings.vaultPath}`)
  })
})

type FocusItemView = { id: string; missing: boolean; text?: string; list?: string; step?: string }

describe('tasks focus IPC', () => {
  it('puts a task without an id in focus: its line gains the id, the rest of the file stays, and one backup is kept', async () => {
    const source = '## Casa\n- [ ] Lavar roupa\n- [ ] Passar pano ^t1a2b3c\n'
    const file = join(vault, 'tarefas.md')
    writeFileSync(file, source, 'utf8')
    settings.vaultPath = vault
    await invoke('office:readTasks')

    const focused = (await invoke('office:focusTask', 2)) as { focus: FocusItemView[] }
    const id = focused.focus[0]!.id
    const after = readFileSync(file, 'utf8')

    expect(focused.focus).toEqual([{ id, missing: false, text: 'Lavar roupa', list: 'Casa' }])
    expect(after.split('\n')).toEqual(['## Casa', `- [ ] Lavar roupa ^${id}`, '- [ ] Passar pano ^t1a2b3c', ''])
    expect(planning.focus()).toEqual([id])
    expect(readdirSync(join(vault, 'backups', 'tarefas'))).toHaveLength(1)
  })

  it('a task that already has an id keeps it and tarefas.md is not written', async () => {
    const source = '## Casa\n- [ ] Passar pano ^t1a2b3c\n'
    writeFileSync(join(vault, 'tarefas.md'), source, 'utf8')
    settings.vaultPath = vault
    await invoke('office:readTasks')

    await invoke('office:focusTask', 2)

    expect(readFileSync(join(vault, 'tarefas.md'), 'utf8')).toBe(source)
    expect(planning.focus()).toEqual(['t1a2b3c'])
    expect(existsSync(join(vault, 'backups'))).toBe(false)
  })

  it('a change to tarefas.md since the board read it cancels the focus, and nothing is recorded', async () => {
    writeFileSync(join(vault, 'tarefas.md'), '## Casa\n- [ ] Lavar roupa\n', 'utf8')
    settings.vaultPath = vault
    await invoke('office:readTasks')
    const changed = '## Casa\n- [ ] Lavar louça\n'
    writeFileSync(join(vault, 'tarefas.md'), changed, 'utf8')

    await expect(invoke('office:focusTask', 2)).rejects.toThrow('mudou desde que você abriu o quadro')
    expect(planning.focus()).toEqual([])
    expect(readFileSync(join(vault, 'tarefas.md'), 'utf8')).toBe(changed)
  })

  it('shows a focused task that is gone from tarefas.md as missing, and takes it out without writing the file', async () => {
    const source = '## Casa\n- [ ] Lavar roupa ^t1a2b3c\n'
    writeFileSync(join(vault, 'tarefas.md'), source, 'utf8')
    settings.vaultPath = vault
    planning.add('tzzzzzz')

    expect(await invoke('office:readFocus')).toEqual([{ id: 'tzzzzzz', missing: true }])
    expect(await invoke('office:unfocusTask', 'tzzzzzz')).toEqual([])
    expect(planning.focus()).toEqual([])
    expect(readFileSync(join(vault, 'tarefas.md'), 'utf8')).toBe(source)
  })

  it('refuses to focus a task on the Archive or a task that is not open', async () => {
    const source = ['## Estudo', '- [x] Ler ✅ 2026-10-12 ^t1a2b3c', '## Archive', '- [-] Velho ❌ 2026-10-10 ^t4d5e6f', ''].join('\n')
    writeFileSync(join(vault, 'tarefas.md'), source, 'utf8')
    settings.vaultPath = vault
    await invoke('office:readTasks')

    await expect(invoke('office:focusTask', 2)).rejects.toThrow('Só tarefas abertas podem ir para o foco.')
    await expect(invoke('office:focusTask', 4)).rejects.toThrow('As tarefas do Archive não podem ir para o foco.')
    expect(planning.focus()).toEqual([])
  })

  describe('completing a task', () => {
    const file = () => join(vault, 'tarefas.md')

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date(2026, 9, 17, 10, 30))
    })

    afterEach(() => vi.useRealTimers())

    it('completes a task from the focus, and undo within 10 s gives back the line and the focus', async () => {
      const source = '## Casa\n- [ ] Lavar roupa ^tabc123\n'
      writeFileSync(file(), source, 'utf8')
      settings.vaultPath = vault
      await invoke('office:readTasks')
      await invoke('office:focusTask', 2)

      const done = (await invoke('office:completeTask', { id: 'tabc123' })) as { id: string; focus: unknown[] }

      expect(done.id).toBe('tabc123')
      expect(done.focus).toEqual([])
      expect(readFileSync(file(), 'utf8')).toBe('## Casa\n\n## Archive\n- [x] Lavar roupa ✅ 17.10.2026 ^tabc123\n')
      expect(planning.focus()).toEqual([])
      expect(new PlanningStore(data).focus()).toEqual([])

      vi.setSystemTime(new Date(2026, 9, 17, 10, 30, 9))
      await invoke('office:undoCompleteTask', 'tabc123')
      expect(readFileSync(file(), 'utf8')).toBe(source)
      expect(planning.focus()).toEqual(['tabc123'])
    })

    it('completes a task from the board by its line, and gives a task without an id one', async () => {
      writeFileSync(file(), '## Casa\n- [ ] Lavar roupa\n', 'utf8')
      settings.vaultPath = vault
      await invoke('office:readTasks')

      const done = (await invoke('office:completeTask', { line: 2 })) as { id: string; board: { lists: { name: string }[] } }

      expect(done.id).toMatch(/^t[a-z0-9]{6}$/)
      expect(readFileSync(file(), 'utf8')).toContain(`- [x] Lavar roupa ✅ 17.10.2026 ^${done.id}`)
      expect(done.board.lists.map((l) => l.name)).toEqual(['Casa', 'Archive'])
    })

    it('does not offer the undo after 10 seconds, and the task stays completed', async () => {
      writeFileSync(file(), '## Casa\n- [ ] Lavar roupa ^tabc123\n', 'utf8')
      settings.vaultPath = vault
      await invoke('office:readTasks')
      await invoke('office:completeTask', { id: 'tabc123' })
      const after = readFileSync(file(), 'utf8')

      vi.setSystemTime(new Date(2026, 9, 17, 10, 30, 10))
      await expect(invoke('office:undoCompleteTask', 'tabc123')).rejects.toThrow('Passaram os 10 segundos para desfazer.')
      expect(readFileSync(file(), 'utf8')).toBe(after)
    })

    it('refuses the undo when tarefas.md changed since the completion, and writes nothing', async () => {
      writeFileSync(file(), '## Casa\n- [ ] Lavar roupa ^tabc123\n', 'utf8')
      settings.vaultPath = vault
      await invoke('office:readTasks')
      await invoke('office:completeTask', { id: 'tabc123' })
      const edited = readFileSync(file(), 'utf8') + '- [ ] Outra coisa\n'
      writeFileSync(file(), edited, 'utf8')

      await expect(invoke('office:undoCompleteTask', 'tabc123')).rejects.toThrow('nada foi desfeito')
      expect(readFileSync(file(), 'utf8')).toBe(edited)
      expect(planning.focus()).toEqual([])
    })

    it('refuses a target that is neither a line nor an id, and writes nothing', async () => {
      const source = '## Casa\n- [ ] Lavar roupa ^tabc123\n'
      writeFileSync(file(), source, 'utf8')
      settings.vaultPath = vault
      await invoke('office:readTasks')

      await expect(invoke('office:completeTask', { line: 'dois' })).rejects.toThrow('Tarefa inválida.')
      expect(readFileSync(file(), 'utf8')).toBe(source)
    })
  })

  it('saves and clears the step of a focused task without writing tarefas.md', async () => {
    const source = '## Casa\n- [ ] Lavar roupa ^tabc123\n'
    const file = join(vault, 'tarefas.md')
    writeFileSync(file, source, 'utf8')
    settings.vaultPath = vault
    await invoke('office:readTasks')
    await invoke('office:focusTask', 2)

    const saved = (await invoke('office:saveStep', 'tabc123', '  Lavar a máquina  ')) as FocusItemView[]

    expect(saved).toEqual([{ id: 'tabc123', missing: false, text: 'Lavar roupa', list: 'Casa', step: 'Lavar a máquina' }])
    expect(await invoke('office:readFocus')).toEqual(saved)
    expect(readFileSync(file, 'utf8')).toBe(source)

    const cleared = (await invoke('office:clearStep', 'tabc123')) as FocusItemView[]

    expect(cleared).toEqual([{ id: 'tabc123', missing: false, text: 'Lavar roupa', list: 'Casa' }])
    expect(readFileSync(file, 'utf8')).toBe(source)
    expect(planning.focus()).toEqual(['tabc123'])
  })

  it('refuses a step for a task that is not in focus, an empty or long step, and writes nothing', async () => {
    const source = '## Casa\n- [ ] Lavar roupa ^tabc123\n'
    writeFileSync(join(vault, 'tarefas.md'), source, 'utf8')
    settings.vaultPath = vault
    await invoke('office:readTasks')
    await invoke('office:focusTask', 2)

    await expect(invoke('office:saveStep', 'tzzzzzz', 'Ler')).rejects.toThrow('Só tarefas em foco podem ter passo de hoje.')
    await expect(invoke('office:saveStep', 'tabc123', '   ')).rejects.toThrow('Escreva o passo de hoje.')
    await expect(invoke('office:saveStep', 'tabc123', 'a'.repeat(201))).rejects.toThrow(
      'O passo de hoje pode ter no máximo 200 caracteres.',
    )
    await expect(invoke('office:saveStep', '../tarefas', 'Ler')).rejects.toThrow('Identificador inválido.')
    expect(readFileSync(join(vault, 'tarefas.md'), 'utf8')).toBe(source)
    expect(await invoke('office:readFocus')).toEqual([{ id: 'tabc123', missing: false, text: 'Lavar roupa', list: 'Casa' }])
  })

  it('refuses a bad line or id from the renderer', async () => {
    settings.vaultPath = vault

    await expect(invoke('office:focusTask', '2')).rejects.toThrow('Tarefa inválida.')
    await expect(invoke('office:unfocusTask', '../tarefas')).rejects.toThrow('Identificador inválido.')
  })

  it('reads the focus only with a vault configured', async () => {
    await expect(invoke('office:readFocus')).rejects.toThrow('Configure a pasta do vault em Ajustes → Tarefas do Obsidian.')
  })
})

describe('tasks focus timer IPC', () => {
  it('runs the timer of a focused task through its actions, and tarefas.md stays byte-identical', async () => {
    const source = '## Casa\n- [ ] Lavar roupa ^tabc123\n- [ ] Passar pano ^tdef456\n'
    const file = join(vault, 'tarefas.md')
    writeFileSync(file, source, 'utf8')
    settings.vaultPath = vault
    await invoke('office:readTasks')
    await invoke('office:focusTask', 2)
    await invoke('office:focusTask', 3)

    const started = (await invoke('office:startTimer', 'tabc123')) as FocusItemView[]
    expect(started[0]).toMatchObject({ id: 'tabc123', timer: { state: 'em andamento' } })
    expect(started[1]).not.toHaveProperty('timer')

    await expect(invoke('office:startTimer', 'tdef456')).rejects.toThrow(
      'Já há uma sessão de foco em andamento, pausada ou por confirmar. Pare ou confirme essa sessão antes de começar outra.',
    )
    expect(await invoke('office:pauseTimer', 'tabc123')).toMatchObject([{ timer: { state: 'pausada' } }, {}])
    expect(await invoke('office:resumeTimer', 'tabc123')).toMatchObject([{ timer: { state: 'em andamento' } }, {}])
    expect(await invoke('office:stopTimer', 'tabc123')).toMatchObject([{ timer: { state: 'interrompida' } }, {}])

    await expect(invoke('office:confirmTimer', 'tabc123', 26)).rejects.toThrow('Uma sessão tem no máximo 25 minutos.')
    await expect(invoke('office:confirmTimer', 'tabc123', 2.5)).rejects.toThrow('Os minutos precisam ser um número inteiro.')
    await expect(invoke('office:confirmTimer', 'tabc123', '18')).rejects.toThrow('Informe os minutos feitos.')
    await expect(invoke('office:confirmTimer', 'tabc123', -1)).rejects.toThrow('Os minutos não podem ser negativos.')
    await expect(invoke('office:confirmTimer', '../tarefas', 5)).rejects.toThrow('Identificador inválido.')

    const confirmed = (await invoke('office:confirmTimer', 'tabc123', 18)) as FocusItemView[]
    expect(confirmed[0]).toMatchObject({ id: 'tabc123', timer: { state: 'confirmada', confirmedMinutes: 18 } })
    expect(JSON.parse(readFileSync(join(data, 'planning.json'), 'utf8')).timer).toMatchObject({ state: 'confirmada', confirmedMinutes: 18 })
    expect(readFileSync(file, 'utf8')).toBe(source)
  })

  it('refuses the timer of a task that is not in focus, and the timer actions with no vault', async () => {
    const source = '## Casa\n- [ ] Lavar roupa ^tabc123\n'
    writeFileSync(join(vault, 'tarefas.md'), source, 'utf8')
    settings.vaultPath = vault
    await invoke('office:readTasks')
    await invoke('office:focusTask', 2)

    await expect(invoke('office:startTimer', 'tzzzzzz')).rejects.toThrow('Só tarefas em foco podem ter timer de foco.')
    await expect(invoke('office:confirmTimer', 'tzzzzzz', 5)).rejects.toThrow('Só tarefas em foco podem ter timer de foco.')
    expect(readFileSync(join(vault, 'tarefas.md'), 'utf8')).toBe(source)

    settings.vaultPath = undefined
    await expect(invoke('office:startTimer', 'tabc123')).rejects.toThrow('Configure a pasta do vault em Ajustes → Tarefas do Obsidian.')
  })
})
