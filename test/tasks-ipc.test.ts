import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlanningStore } from '../src/main/planning'
import { routineId } from '../src/shared/routine-personal'
import { dayKey } from '../src/main/backups'
import { PersonalRoutineStore } from '../src/main/personal-routines-store'
import { personalRoutineTaskFingerprint } from '../src/main/personal-routine-fingerprint'
import { dayLabel } from '../src/shared/tasks'

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
      dataDirectory: data,
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
  it('reading the personal-routine overview does not create occurrence state', async () => {
    writeFileSync(join(vault, 'tarefas.md'), '## Casa\n', 'utf8')
    writeFileSync(join(vault, 'rotinas-pessoais.md'), 'Rotina diária | cadência: diária', 'utf8')
    settings.vaultPath = vault
    await invoke('office:readTasks')
    const occurrencePath = join(data, 'personal-routines.json')

    expect(existsSync(occurrencePath)).toBe(false)
    const overview = (await invoke('office:personalRoutineOverview')) as { candidates: { occurrenceId?: string }[] }

    expect(overview.candidates[0]?.occurrenceId).toBeTruthy()
    expect(existsSync(occurrencePath)).toBe(false)
  })

  it('creates, retries, and completes a daily occurrence through the reserved linked task', async () => {
    const boardFile = join(vault, 'tarefas.md')
    writeFileSync(boardFile, '## Casa\n', 'utf8')
    writeFileSync(join(vault, 'rotinas-pessoais.md'), 'Rotina diária | cadência: diária', 'utf8')
    settings.vaultPath = vault
    await invoke('office:readTasks')
    const overview = (await invoke('office:personalRoutineOverview')) as {
      today: string
      candidates: { item?: { title: string }; occurrenceId?: string }[]
    }
    const candidate = overview.candidates.find((row) => row.item?.title === 'Rotina diária')
    expect(candidate?.occurrenceId).toBeTruthy()
    const input = { occurrenceId: candidate!.occurrenceId!, objective: 'Dez minutos de leitura', list: 'Casa' }
    const first = (await invoke('office:createPersonalRoutineTask', input)) as { id: string }
    await invoke('office:readTasks')
    const retry = (await invoke('office:createPersonalRoutineTask', input)) as { id: string }
    expect(retry.id).toBe(first.id)
    expect(readFileSync(boardFile, 'utf8').match(/Dez minutos de leitura/g)).toHaveLength(1)

    await invoke('office:completeTask', { id: first.id })
    const afterCompletion = (await invoke('office:personalRoutineOverview')) as {
      rows: { title: string; completed: number }[]
      candidates: { item?: { title: string } }[]
    }
    expect(afterCompletion.rows.find((row) => row.title === 'Rotina diária')?.completed).toBe(1)
    expect(afterCompletion.candidates.some((row) => row.item?.title === 'Rotina diária')).toBe(false)
  })

  it('tracks a legacy weekly dias occurrence, enforces its hour, and counts manual completion', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 21, 10, 0))
    try {
      const boardFile = join(vault, 'tarefas.md')
      writeFileSync(boardFile, '## Estudo\n', 'utf8')
      writeFileSync(join(vault, 'rotinas-pessoais.md'), 'Rotina A | cadência: semanal | dias: qua | hora: 09:30', 'utf8')
      settings.vaultPath = vault
      await invoke('office:readTasks')
      const overview = (await invoke('office:personalRoutineOverview')) as {
        today: string
        rows: { title: string; fixedSchedule?: boolean; days?: number[]; target?: number; confirmed: boolean }[]
        candidates: { item?: { title: string; time?: string }; occurrenceId?: string }[]
      }
      expect(overview.today).toBe('2026-10-21')
      expect(overview.rows[0]).toMatchObject({ title: 'Rotina A', fixedSchedule: true, days: [3], target: 1, confirmed: true })
      const candidate = overview.candidates.find((row) => row.item?.title === 'Rotina A')!
      expect(candidate.occurrenceId).toBeTruthy()
      expect(candidate.item?.time).toBe('09:30')

      await expect(
        invoke('office:createPersonalRoutineTask', {
          occurrenceId: candidate.occurrenceId,
          objective: 'Ler o capítulo',
          list: 'Estudo',
          time: '08:00',
        }),
      ).rejects.toThrow(/horário.*definição/i)
      expect(readFileSync(boardFile, 'utf8')).toBe('## Estudo\n')

      const created = (await invoke('office:createPersonalRoutineTask', {
        occurrenceId: candidate.occurrenceId,
        objective: 'Ler o capítulo',
        list: 'Estudo',
        time: '09:30',
      })) as { id: string }
      const tasks = (await invoke('office:readTasks')) as { lists: { tasks: { id?: string; time?: string }[] }[] }
      expect(tasks.lists.flatMap((list) => list.tasks).find((task) => task.id === created.id)?.time).toBe('09:30')
      await invoke('office:completeTask', { id: created.id })
      const after = (await invoke('office:personalRoutineOverview')) as {
        rows: { title: string; completed: number }[]
        candidates: { item?: { title: string } }[]
      }
      expect(after.rows[0]).toMatchObject({ title: 'Rotina A', completed: 1 })
      expect(after.candidates.some((row) => row.item?.title === 'Rotina A')).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('propagates the definition hour into the task/fingerprint and rejects a renderer override', async () => {
    const boardFile = join(vault, 'tarefas.md')
    writeFileSync(boardFile, '## Casa\n', 'utf8')
    writeFileSync(join(vault, 'rotinas-pessoais.md'), 'Rotina com hora | cadência: diária | hora: 09:30', 'utf8')
    settings.vaultPath = vault
    await invoke('office:readTasks')
    const overview = (await invoke('office:personalRoutineOverview')) as {
      candidates: { item?: { title: string; time?: string }; occurrenceId?: string }[]
    }
    const candidate = overview.candidates.find((row) => row.item?.title === 'Rotina com hora')!
    const input = {
      occurrenceId: candidate.occurrenceId!,
      objective: 'Leitura com horário',
      list: 'Casa',
      time: '09:30',
    }
    const created = (await invoke('office:createPersonalRoutineTask', input)) as { id: string }
    const task = ((await invoke('office:readTasks')) as { lists: { tasks: { id?: string; time?: string }[] }[] }).lists
      .flatMap((list) => list.tasks)
      .find((entry) => entry.id === created.id)
    expect(task?.time).toBe('09:30')
    const stateText = readFileSync(join(data, 'personal-routines.json'), 'utf8')
    const occurrence = JSON.parse(stateText).occurrences[candidate.occurrenceId!]
    expect(occurrence.taskFingerprint).toBe(
      personalRoutineTaskFingerprint({
        title: input.objective,
        list: input.list,
        date: dayLabel(new Date()),
        time: '09:30',
      }),
    )
    expect(stateText).not.toContain('Leitura com horário')
    await invoke('office:readTasks')
    const retry = (await invoke('office:createPersonalRoutineTask', input)) as { id: string }
    expect(retry.id).toBe(created.id)
    await invoke('office:readTasks')
    await expect(invoke('office:createPersonalRoutineTask', { ...input, time: '08:00' })).rejects.toThrow(/horário.*definição/i)
    expect(readFileSync(boardFile, 'utf8').match(/Leitura com horário/g)).toHaveLength(1)
  })

  it('refuses to link/resume a reserved id when the existing task draft fingerprint differs', async () => {
    const boardFile = join(vault, 'tarefas.md')
    writeFileSync(boardFile, '## Casa\n', 'utf8')
    writeFileSync(join(vault, 'rotinas-pessoais.md'), 'Rotina diária | cadência: diária', 'utf8')
    settings.vaultPath = vault
    await invoke('office:readTasks')
    const overview = (await invoke('office:personalRoutineOverview')) as {
      candidates: { item?: { title: string }; occurrenceId?: string }[]
    }
    const occurrenceId = overview.candidates.find((row) => row.item?.title === 'Rotina diária')!.occurrenceId!
    const draft = { occurrenceId, objective: 'Objetivo original', list: 'Casa' }
    const created = (await invoke('office:createPersonalRoutineTask', draft)) as { id: string }
    planning.remove(created.id)
    const changed = readFileSync(boardFile, 'utf8').replace('## Casa', '## Lista externa').replace('Objetivo original', 'Objetivo externo')
    writeFileSync(boardFile, changed, 'utf8')
    await invoke('office:readTasks')

    await expect(invoke('office:createPersonalRoutineTask', draft)).rejects.toThrow(/conteúdo.*mudou|não corresponde/i)
    expect(readFileSync(boardFile, 'utf8')).toBe(changed)
    expect(planning.focus()).not.toContain(created.id)
    const saved = JSON.parse(readFileSync(join(data, 'personal-routines.json'), 'utf8'))
    expect(saved.occurrences[occurrenceId].taskId).toBeUndefined()
    expect(saved.occurrences[occurrenceId].status).toBe('pending')
    expect(saved.occurrences[occurrenceId].taskFingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(readFileSync(join(data, 'personal-routines.json'), 'utf8')).not.toContain('Objetivo original')
  })

  it('overview stays read-only; explicit resume releases a foreign task id without changing the task', async () => {
    const boardFile = join(vault, 'tarefas.md')
    writeFileSync(boardFile, '## Casa\n', 'utf8')
    writeFileSync(join(vault, 'rotinas-pessoais.md'), 'Rotina diária | cadência: diária', 'utf8')
    settings.vaultPath = vault
    await invoke('office:readTasks')
    const initial = (await invoke('office:personalRoutineOverview')) as {
      candidates: { item?: { title: string }; occurrenceId?: string }[]
    }
    const candidate = initial.candidates.find((row) => row.item?.title === 'Rotina diária')!
    const created = (await invoke('office:createPersonalRoutineTask', {
      occurrenceId: candidate.occurrenceId!,
      objective: 'Objetivo esperado',
      list: 'Casa',
    })) as { id: string }
    planning.remove(created.id)
    const foreignText = readFileSync(boardFile, 'utf8').replace('Objetivo esperado', 'Tarefa externa')
    writeFileSync(boardFile, foreignText, 'utf8')
    await invoke('office:readTasks')

    const overview = (await invoke('office:personalRoutineOverview')) as {
      pending: { occurrenceId: string; taskId?: string }[]
      rows: { completed: number }[]
    }
    expect(overview.pending.find((row) => row.occurrenceId === candidate.occurrenceId)?.taskId).toBe(created.id)
    expect(overview.rows[0]?.completed).toBe(0)
    expect(planning.focus()).not.toContain(created.id)
    await expect(invoke('office:resumePersonalRoutineOccurrence', candidate.occurrenceId)).rejects.toThrow()
    const afterResume = (await invoke('office:personalRoutineOverview')) as { pending: { occurrenceId: string; taskId?: string }[] }
    expect(afterResume.pending.find((row) => row.occurrenceId === candidate.occurrenceId)?.taskId).toBeUndefined()
    expect(readFileSync(boardFile, 'utf8')).toBe(foreignText)
  })

  it('manual completion of a foreign task proceeds but does not count the routine', async () => {
    const boardFile = join(vault, 'tarefas.md')
    writeFileSync(boardFile, '## Casa\n', 'utf8')
    writeFileSync(join(vault, 'rotinas-pessoais.md'), 'Rotina diária | cadência: diária', 'utf8')
    settings.vaultPath = vault
    await invoke('office:readTasks')
    const initial = (await invoke('office:personalRoutineOverview')) as {
      candidates: { item?: { title: string }; occurrenceId?: string }[]
    }
    const candidate = initial.candidates.find((row) => row.item?.title === 'Rotina diária')!
    const created = (await invoke('office:createPersonalRoutineTask', {
      occurrenceId: candidate.occurrenceId!,
      objective: 'Objetivo esperado',
      list: 'Casa',
    })) as { id: string }
    planning.remove(created.id)
    writeFileSync(boardFile, readFileSync(boardFile, 'utf8').replace('Objetivo esperado', 'Tarefa externa'), 'utf8')
    await invoke('office:readTasks')

    const completed = (await invoke('office:completeTask', { id: created.id })) as {
      board: { lists: { name: string; tasks: { id?: string; status: string }[] }[] }
    }
    expect(completed.board.lists.find((list) => list.name === 'Archive')?.tasks.find((task) => task.id === created.id)?.status).toBe(
      'completed',
    )
    const state = JSON.parse(readFileSync(join(data, 'personal-routines.json'), 'utf8'))
    expect(state.occurrences[candidate.occurrenceId!].status).toBe('pending')
    expect(state.occurrences[candidate.occurrenceId!].taskId).toBeUndefined()
  })

  it('reabre normalmente uma tarefa editada, mas não restaura seu vínculo com a rotina', async () => {
    const boardFile = join(vault, 'tarefas.md')
    writeFileSync(boardFile, '## Casa\n', 'utf8')
    writeFileSync(join(vault, 'rotinas-pessoais.md'), 'Rotina diária | cadência: diária', 'utf8')
    settings.vaultPath = vault
    await invoke('office:readTasks')
    const initial = (await invoke('office:personalRoutineOverview')) as {
      candidates: { item?: { title: string }; occurrenceId?: string }[]
    }
    const candidate = initial.candidates.find((row) => row.item?.title === 'Rotina diária')!
    const created = (await invoke('office:createPersonalRoutineTask', {
      occurrenceId: candidate.occurrenceId!,
      objective: 'Objetivo esperado',
      list: 'Casa',
    })) as { id: string }
    await invoke('office:completeTask', { id: created.id })
    writeFileSync(boardFile, readFileSync(boardFile, 'utf8').replace('Objetivo esperado', 'Tarefa externa'), 'utf8')
    await invoke('office:readTasks')

    const reopened = (await invoke('office:reopenTask', { target: { id: created.id } })) as {
      status: string
      board: { lists: { name: string; tasks: { id?: string; text: string }[] }[] }
    }
    expect(reopened.status).toBe('done')
    expect(reopened.board.lists.find((list) => list.name === 'Casa')?.tasks.find((task) => task.id === created.id)?.text).toBe(
      'Tarefa externa',
    )
    const state = JSON.parse(readFileSync(join(data, 'personal-routines.json'), 'utf8'))
    expect(state.occurrences[candidate.occurrenceId!].status).toBe('pending')
    expect(state.occurrences[candidate.occurrenceId!].taskId).toBeUndefined()
  })

  it('reoffers yesterday’s discarded occurrence for an explicit new task', async () => {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const day = dayKey(yesterday)
    const item = { title: 'Rotina diária', cadence: 'diária' as const }
    const id = routineId(item)
    const occurrenceId = `${id}:${day}`
    const initial = new PersonalRoutineStore(data)
    initial.ensureOccurrence(occurrenceId, id, day)
    initial.setTask(occurrenceId, 'told123')
    writeFileSync(join(vault, 'tarefas.md'), '## Casa\n- [ ] Objetivo antigo ^told123\n', 'utf8')
    writeFileSync(join(vault, 'rotinas-pessoais.md'), 'Rotina diária | cadência: diária', 'utf8')
    settings.vaultPath = vault
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
      planning,
      broadcast,
    } as never)
    await invoke('office:readTasks')
    await invoke('office:discardTask', { target: { id: 'told123' }, reason: 'Adiado ontem' })

    const overview = (await invoke('office:personalRoutineOverview')) as {
      pending: { occurrenceId: string; taskId?: string; day: string }[]
    }
    expect(overview.pending).toContainEqual({ occurrenceId, routineId: id, day })
    const task = (await invoke('office:createPersonalRoutineTask', {
      occurrenceId,
      objective: 'Retomar rotina',
      list: 'Casa',
    })) as { id: string }
    expect(task.id).not.toBe('told123')
    expect(readFileSync(join(vault, 'tarefas.md'), 'utf8').match(/Retomar rotina/g)).toHaveLength(1)
  })

  it('opening overview preserves a missing link; explicit resume recovers it before another task is created', async () => {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const day = dayKey(yesterday)
    const item = { title: 'Rotina diária', cadence: 'diária' as const }
    const id = routineId(item)
    const occurrenceId = `${id}:${day}`
    const initial = new PersonalRoutineStore(data)
    initial.ensureOccurrence(occurrenceId, id, day)
    initial.setTask(occurrenceId, 'tmis001')
    writeFileSync(join(vault, 'tarefas.md'), '## Casa\n', 'utf8')
    writeFileSync(join(vault, 'rotinas-pessoais.md'), 'Rotina diária | cadência: diária', 'utf8')
    settings.vaultPath = vault
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
      planning,
      broadcast,
    } as never)
    await invoke('office:readTasks')
    const overview = (await invoke('office:personalRoutineOverview')) as {
      pending: { occurrenceId: string; taskId?: string }[]
    }
    expect(overview.pending.find((row) => row.occurrenceId === occurrenceId)?.taskId).toBe('tmis001')
    await expect(invoke('office:resumePersonalRoutineOccurrence', occurrenceId)).rejects.toThrow(/não existe mais/)
    const recovered = (await invoke('office:personalRoutineOverview')) as { pending: { occurrenceId: string; taskId?: string }[] }
    expect(recovered.pending.find((row) => row.occurrenceId === occurrenceId)?.taskId).toBeUndefined()
    const task = (await invoke('office:createPersonalRoutineTask', {
      occurrenceId,
      objective: 'Tarefa substituta',
      list: 'Casa',
    })) as { id: string }
    expect(task.id).not.toBe('tmis001')
    expect(readFileSync(join(vault, 'tarefas.md'), 'utf8').match(/Tarefa substituta/g)).toHaveLength(1)
  })

  it('overview preserva uma reserva gravada e retomada explícita a vincula à mesma tarefa', async () => {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const day = dayKey(yesterday)
    const item = { title: 'Rotina diária', cadence: 'diária' as const }
    const id = routineId(item)
    const occurrenceId = `${id}:${day}`
    const seed = new PersonalRoutineStore(data, () => 'tresrv1')
    seed.ensureOccurrence(occurrenceId, id, day)
    const taskDraft = { title: 'Tarefa persistida', list: 'Casa', date: dayLabel(new Date()) }
    const reserved = seed.reserve(occurrenceId, id, day, new Set(), personalRoutineTaskFingerprint(taskDraft))
    writeFileSync(join(vault, 'tarefas.md'), `## Casa\n- [ ] ${taskDraft.date} | Casa | Tarefa persistida ^${reserved.taskId}\n`, 'utf8')
    writeFileSync(join(vault, 'rotinas-pessoais.md'), 'Rotina diária | cadência: diária', 'utf8')
    settings.vaultPath = vault
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
      planning,
      broadcast,
    } as never)
    await invoke('office:readTasks')

    const overview = (await invoke('office:personalRoutineOverview')) as {
      pending: { occurrenceId: string; taskId?: string }[]
    }
    expect(overview.pending.find((row) => row.occurrenceId === occurrenceId)?.taskId).toBe(reserved.taskId)
    const resumed = (await invoke('office:resumePersonalRoutineOccurrence', occurrenceId)) as { id: string }
    expect(resumed.id).toBe(reserved.taskId)
    expect(readFileSync(join(vault, 'tarefas.md'), 'utf8').match(/Tarefa persistida/g)).toHaveLength(1)
  })

  it('requires explicit weekly distribution, then creates one linked task idempotently', async () => {
    const boardFile = join(vault, 'tarefas.md')
    writeFileSync(boardFile, '## Estudo\n', 'utf8')
    writeFileSync(join(vault, 'rotinas-pessoais.md'), 'Rotina A | cadência: semanal | meta: 2', 'utf8')
    settings.vaultPath = vault
    await invoke('office:readTasks')
    const item = { title: 'Rotina A', cadence: 'semanal' as const, target: 2 }
    const id = routineId(item)
    const unconfirmed = (await invoke('office:personalRoutineOverview')) as { rows: { confirmed: boolean }[]; candidates: unknown[] }
    expect(unconfirmed.rows[0]?.confirmed).toBe(false)
    expect(unconfirmed.candidates).toEqual([])
    const today = dayKey()
    const todayWeekday = new Date(`${today}T12:00:00Z`).getUTCDay()
    await invoke('office:confirmPersonalRoutineDistribution', id, [todayWeekday, (todayWeekday + 1) % 7])
    const occurrenceId = `${id}:${today}`
    const occurrenceState = JSON.parse(readFileSync(join(data, 'personal-routines.json'), 'utf8'))
    expect(occurrenceState.occurrences[occurrenceId]).toMatchObject({ status: 'pending', routineId: id, day: today })
    const created = (await invoke('office:createPersonalRoutineTask', { occurrenceId, objective: 'Ler capítulo', list: 'Estudo' })) as {
      id: string
    }
    expect(created.id).toMatch(/^t[a-z0-9]{6}$/)
    expect(readFileSync(boardFile, 'utf8')).toContain(`Ler capítulo ^${created.id}`)
    expect(planning.focus()).toContain(created.id)
    await invoke('office:readTasks')
    const retried = (await invoke('office:createPersonalRoutineTask', { occurrenceId, objective: 'Ler capítulo', list: 'Estudo' })) as {
      id: string
    }
    expect(retried.id).toBe(created.id)
    expect(readFileSync(boardFile, 'utf8').match(/Ler capítulo/g)).toHaveLength(1)
    const occurrencePath = join(data, 'personal-routines.json')
    await invoke('office:completeTask', { id: created.id })
    expect(JSON.parse(readFileSync(occurrencePath, 'utf8')).occurrences[occurrenceId].status).toBe('completed')
    await invoke('office:undoCompleteTask', created.id)
    expect(JSON.parse(readFileSync(occurrencePath, 'utf8')).occurrences[occurrenceId].status).toBe('pending')
    const resumed = (await invoke('office:resumePersonalRoutineOccurrence', occurrenceId)) as { id: string }
    expect(resumed.id).toBe(created.id)
    expect(readFileSync(boardFile, 'utf8').match(/Ler capítulo/g)).toHaveLength(1)
    await invoke('office:completeTask', { id: created.id })
    await invoke('office:reopenTask', { target: { id: created.id } })
    expect(JSON.parse(readFileSync(occurrencePath, 'utf8')).occurrences[occurrenceId].status).toBe('pending')
    await invoke('office:discardTask', { target: { id: created.id }, reason: 'Adiado' })
    expect(JSON.parse(readFileSync(occurrencePath, 'utf8')).occurrences[occurrenceId].status).toBe('pending')
    expect(JSON.parse(readFileSync(occurrencePath, 'utf8')).occurrences[occurrenceId].taskId).toBeUndefined()
  })

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
  it('the old focus timer channels are not registered anymore', () => {
    for (const channel of ['office:startTimer', 'office:pauseTimer', 'office:resumeTimer', 'office:stopTimer', 'office:confirmTimer']) {
      expect(ipc.handlers.has(channel)).toBe(false)
    }
  })
})

describe('discarding and reopening IPC', () => {
  const file = () => join(vault, 'tarefas.md')

  // A new session: the same registration again, so the writer starts with nothing read.
  const registerAgain = () =>
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
      planning,
      broadcast,
    } as never)

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 17, 10, 30))
  })

  afterEach(() => vi.useRealTimers())

  it('discards a focused task: it leaves the focus, the Archive gets it with ❌ and no ✅, and the other focused task keeps its step and timer', async () => {
    writeFileSync(file(), '## Casa\n- [ ] Lavar roupa ^tabc123\n- [ ] Passar pano ^tdef456\n## Archive\n', 'utf8')
    settings.vaultPath = vault
    await invoke('office:readTasks')
    await invoke('office:focusTask', 2)
    await invoke('office:focusTask', 3)
    await invoke('office:saveStep', 'tdef456', 'Passar a pano')

    const out = (await invoke('office:discardTask', { target: { id: 'tabc123' }, reason: 'Sem tempo' })) as {
      id: string
      focus: FocusItemView[]
    }

    expect(out.id).toBe('tabc123')
    expect(readFileSync(file(), 'utf8')).toBe(
      '## Casa\n- [ ] Passar pano ^tdef456\n## Archive\n- [-] Lavar roupa ❌ 17.10.2026 — Sem tempo ^tabc123\n',
    )
    expect(out.focus).toMatchObject([{ id: 'tdef456', missing: false, step: 'Passar a pano' }])
    expect(out.focus[0]).not.toHaveProperty('timer')
    expect(planning.focus()).toEqual(['tdef456'])
    expect(planning.archivedOf('tabc123')).toEqual({
      origin: 'Casa',
      completedAt: '2026-10-17',
      originalLine: '- [ ] Lavar roupa ^tabc123',
    })
  })

  it('refuses a discard with an empty reason or a reason of the wrong type, and writes nothing', async () => {
    const source = '## Casa\n- [ ] Lavar roupa ^tabc123\n'
    writeFileSync(file(), source, 'utf8')
    settings.vaultPath = vault
    await invoke('office:readTasks')
    await invoke('office:focusTask', 2)

    await expect(invoke('office:discardTask', { target: { id: 'tabc123' }, reason: '   ' })).rejects.toThrow(
      'Escreva o motivo para descartar a tarefa.',
    )
    await expect(invoke('office:discardTask', { target: { id: 'tabc123' }, reason: 7 })).rejects.toThrow('Descarte inválido.')
    expect(readFileSync(file(), 'utf8')).toBe(source)
    expect(planning.focus()).toEqual(['tabc123'])
  })

  it('discards from the focus popup without the board open: reading the focus is enough', async () => {
    writeFileSync(file(), '## Casa\n- [ ] Lavar roupa ^tabc123\n## Archive\n', 'utf8')
    settings.vaultPath = vault
    planning.add('tabc123')
    registerAgain()
    await invoke('office:readFocus')

    await invoke('office:discardTask', { target: { id: 'tabc123' }, reason: 'Sem tempo' })

    expect(readFileSync(file(), 'utf8')).toContain('- [-] Lavar roupa ❌ 17.10.2026 — Sem tempo ^tabc123')
  })

  it('reopens a discarded task to its origin list, and its record goes', async () => {
    const source = '## Casa\n- [ ] Lavar roupa ^tabc123\n## Archive\n- [-] Velho ❌ 2026-10-10 — descartada: x ^t7e8f9a\n'
    writeFileSync(file(), source, 'utf8')
    settings.vaultPath = vault
    await invoke('office:readTasks')
    await invoke('office:discardTask', { target: { line: 2 }, reason: 'Sem tempo' })

    const back = await invoke('office:reopenTask', { target: { id: 'tabc123' } })

    expect(back).toMatchObject({ status: 'done', list: 'Casa', focus: [] })
    expect(readFileSync(file(), 'utf8')).toBe(source)
    expect(planning.archivedOf('tabc123')).toBeUndefined()
    expect(new PlanningStore(data).archivedOf('tabc123')).toBeUndefined()
  })

  it('asks for a list when the origin list is gone, and writes nothing until one is sent', async () => {
    writeFileSync(file(), '## Casa\n- [ ] Lavar roupa ^tabc123\n## Archive\n', 'utf8')
    settings.vaultPath = vault
    await invoke('office:readTasks')
    await invoke('office:discardTask', { target: { id: 'tabc123' }, reason: 'Sem tempo' })
    writeFileSync(file(), readFileSync(file(), 'utf8').replace('## Casa', '## Casa nova'), 'utf8')
    await invoke('office:readTasks')
    const edited = readFileSync(file(), 'utf8')

    expect(await invoke('office:reopenTask', { target: { id: 'tabc123' } })).toEqual({ status: 'choose', lists: ['Casa nova'] })
    expect(readFileSync(file(), 'utf8')).toBe(edited)
    await expect(invoke('office:reopenTask', { target: { id: 'tabc123' }, list: 'Leitura' })).rejects.toThrow(
      'Não encontrei a lista “Leitura”',
    )

    const done = await invoke('office:reopenTask', { target: { id: 'tabc123' }, list: 'Casa nova' })
    expect(done).toMatchObject({ status: 'done', list: 'Casa nova' })
    expect(readFileSync(file(), 'utf8')).toBe('## Casa nova\n- [ ] Lavar roupa ^tabc123\n## Archive\n')
  })

  it('refuses to reopen a task that is open, an unknown task, or a malformed request, and writes nothing', async () => {
    const source = '## Casa\n- [ ] Lavar roupa ^tabc123\n'
    writeFileSync(file(), source, 'utf8')
    settings.vaultPath = vault
    await invoke('office:readTasks')

    await expect(invoke('office:reopenTask', { target: { line: 2 } })).rejects.toThrow('Essa tarefa não está concluída nem descartada')
    await expect(invoke('office:reopenTask', { target: { id: 'tzzzzzz' } })).rejects.toThrow('Não encontrei essa tarefa no tarefas.md.')
    await expect(invoke('office:reopenTask', { target: 'tabc123' })).rejects.toThrow('Reabertura inválida.')
    expect(readFileSync(file(), 'utf8')).toBe(source)
  })

  it('keeps the record when planning.json fails after tarefas.md was written, and the next reopen lets it go', async () => {
    writeFileSync(file(), '## Casa\n- [ ] Lavar roupa ^tabc123\n## Archive\n', 'utf8')
    settings.vaultPath = vault
    await invoke('office:readTasks')
    await invoke('office:discardTask', { target: { line: 2 }, reason: 'Sem tempo' })
    const failing = vi.spyOn(planning, 'unarchive').mockImplementationOnce(() => {
      throw new Error('disco cheio')
    })

    await expect(invoke('office:reopenTask', { target: { id: 'tabc123' } })).rejects.toThrow(
      'não consegui apagar o registro dela no planning.json',
    )
    expect(readFileSync(file(), 'utf8')).toBe('## Casa\n- [ ] Lavar roupa ^tabc123\n## Archive\n')
    expect(planning.archivedOf('tabc123')).toBeDefined()

    await invoke('office:reopenTask', { target: { id: 'tabc123' } })
    expect(planning.archivedOf('tabc123')).toBeUndefined()
    failing.mockRestore()
  })
})
