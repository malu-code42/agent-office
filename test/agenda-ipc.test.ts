import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlanningStore } from '../src/main/planning'

const ipc = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
}))
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => ipc.handlers.set(channel, handler) },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
}))

const { registerTasksIpc } = await import('../src/main/ipc/tasks')
const invoke = (channel: string, ...args: unknown[]) => ipc.handlers.get(channel)!(undefined, ...args)

let vault: string
let data: string
let settings: { vaultPath?: string }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 17, 12))
  vault = mkdtempSync(join(tmpdir(), 'ao-agenda-vault-'))
  data = mkdtempSync(join(tmpdir(), 'ao-agenda-data-'))
  settings = {}
  ipc.handlers.clear()
  registerTasksIpc({
    win: () => ({}) as never,
    store: {
      dataDirectory: data,
      get settings() {
        return settings
      },
      set settings(value) {
        settings = value
      },
    } as never,
    planning: new PlanningStore(data),
    broadcast: vi.fn(),
  } as never)
})

afterEach(() => {
  vi.useRealTimers()
  rmSync(vault, { recursive: true, force: true })
  rmSync(data, { recursive: true, force: true })
})

type View = {
  found: boolean
  today: { date: string; entries: unknown[] }
  week: { date: string; entries: unknown[] }[]
  undated: unknown[]
}

describe('agenda IPC', () => {
  it('shows the day and the week from agenda.md, resolves the task ids, and leaves both files byte-identical', async () => {
    const agendaSource = Buffer.from(
      '## 2026-10-17\r\n- 09:00 Reunião com Ana\r\n- 10:30 ↦ ^tabc123\r\n- 11:00 ↦ ^tzzzzzz\r\nAnotar\r\n',
      'utf8',
    )
    const tasksSource = Buffer.from('## Casa\n- [ ] Lavar roupa ^tabc123\n', 'utf8')
    writeFileSync(join(vault, 'agenda.md'), agendaSource)
    writeFileSync(join(vault, 'tarefas.md'), tasksSource)
    settings.vaultPath = vault

    const view = (await invoke('office:readAgenda')) as View

    expect(view.found).toBe(true)
    expect(view.today.date).toBe('2026-10-17')
    expect(view.today.entries).toEqual([
      { kind: 'commitment', time: '09:00', title: 'Reunião com Ana' },
      { kind: 'task', time: '10:30', id: 'tabc123', text: 'Lavar roupa' },
      { kind: 'task', time: '11:00', id: 'tzzzzzz', text: null },
      { kind: 'unknown', text: 'Anotar' },
    ])
    expect(view.week).toHaveLength(7)
    expect(view.week[0]!.date).toBe('2026-10-12')
    expect(readFileSync(join(vault, 'agenda.md'))).toEqual(agendaSource)
    expect(readFileSync(join(vault, 'tarefas.md'))).toEqual(tasksSource)
    expect(existsSync(join(vault, 'backups'))).toBe(false)
  })

  it('shows a change made to agenda.md in Obsidian on the next read', async () => {
    writeFileSync(join(vault, 'agenda.md'), '## 2026-10-17\n- 09:00 Reunião\n')
    settings.vaultPath = vault
    expect(((await invoke('office:readAgenda')) as View).today.entries).toHaveLength(1)

    writeFileSync(join(vault, 'agenda.md'), '## 2026-10-17\n- 09:00 Reunião\n- 15:00 Dentista\n')
    const second = (await invoke('office:readAgenda')) as View

    expect(second.today.entries).toEqual([
      { kind: 'commitment', time: '09:00', title: 'Reunião' },
      { kind: 'commitment', time: '15:00', title: 'Dentista' },
    ])
  })

  it('reads the vault from the saved settings, never from a path the renderer sends', async () => {
    writeFileSync(join(vault, 'agenda.md'), '## 2026-10-17\n- 09:00 Reunião\n')
    settings.vaultPath = vault

    const view = (await invoke('office:readAgenda', 'C:/outra-pasta')) as View

    expect(view.today.entries).toHaveLength(1)
  })

  it('says there is no agenda.md when the vault has none, and does not fail', async () => {
    settings.vaultPath = vault

    const view = (await invoke('office:readAgenda')) as View

    expect(view).toMatchObject({ found: false, today: { date: '2026-10-17', entries: [] }, undated: [] })
  })

  it('reads aulas.md from the configured vault even without agenda.md, without writing either file', async () => {
    const source = Buffer.from('- id: aula-a | dia: sábado | hora: 09:00 | título: Aula A (SIMULADO)\n')
    writeFileSync(join(vault, 'aulas.md'), source)
    settings.vaultPath = vault

    const view = (await invoke('office:readAgenda', 'C:/ignorado')) as View & { classesFound: boolean }

    expect(view).toMatchObject({ found: false, classesFound: true })
    expect(view.today.entries).toEqual([{ kind: 'class', id: 'aula-a', time: '09:00', title: 'Aula A (SIMULADO)' }])
    expect(readFileSync(join(vault, 'aulas.md'))).toEqual(source)
    expect(existsSync(join(vault, 'agenda.md'))).toBe(false)
  })

  it('shows a missing id when tarefas.md is not in the vault, and does not fail', async () => {
    writeFileSync(join(vault, 'agenda.md'), '## 2026-10-17\n- 10:30 ↦ ^tabc123\n')
    settings.vaultPath = vault

    const view = (await invoke('office:readAgenda')) as View

    expect(view.today.entries).toEqual([{ kind: 'task', time: '10:30', id: 'tabc123', text: null }])
    expect(existsSync(join(vault, 'tarefas.md'))).toBe(false)
  })

  it('refuses to read with no vault configured, with a message in pt-BR', async () => {
    await expect(invoke('office:readAgenda')).rejects.toThrow('Configure a pasta do vault em Ajustes → Tarefas do Obsidian.')
  })

  it('readAgendaForDate lê a semana que contém a data pedida, navegando entre semanas', async () => {
    writeFileSync(join(vault, 'agenda.md'), '## 2026-10-28\n- 09:00 Reunião na próxima semana\n')
    settings.vaultPath = vault

    const view = (await invoke('office:readAgendaForDate', '2026-10-28')) as View

    expect(view.today.date).toBe('2026-10-28')
    expect(view.today.entries).toEqual([{ kind: 'commitment', time: '09:00', title: 'Reunião na próxima semana' }])
    expect(view.week[0]!.date).toBe('2026-10-26')
    expect(view.week[6]!.date).toBe('2026-11-01')
  })

  it('readAgendaForDate recusa datas impossíveis (ex. 2026-02-31)', async () => {
    settings.vaultPath = vault

    await expect(invoke('office:readAgendaForDate', '2026-02-31')).rejects.toThrow('Dia inválido.')
    await expect(invoke('office:readAgendaForDate', '2026-02-29')).rejects.toThrow('Dia inválido.') // 2026 não é bissexto
    // datas válidas não são recusadas
    await expect(invoke('office:readAgendaForDate', '2024-02-29')).resolves.toBeDefined() // 2024 é bissexto
    await expect(invoke('office:readAgendaForDate', '2026-10-17')).resolves.toBeDefined()
  })
})
