import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
let settings: { vaultPath?: string }
let broadcast: ReturnType<typeof vi.fn>

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), 'ao-vault-'))
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
    broadcast,
  } as never)
})

afterEach(() => rmSync(vault, { recursive: true, force: true }))

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

  it('requires a previously selected vault to read tasks', async () => {
    await expect(invoke('office:readTasks')).rejects.toThrow('Configure a pasta do vault em Ajustes → Tarefas do Obsidian.')
  })

  it('reports a readable error when the saved vault is missing', async () => {
    settings.vaultPath = join(vault, 'missing')

    await expect(invoke('office:readTasks')).rejects.toThrow(`A pasta do vault não existe: ${settings.vaultPath}`)
  })
})
