import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StudyIdeaStore } from '../src/main/study-ideas'
import { specFileName } from '../src/shared/study-ideas'

// AO-36: o handler `office:exportStudySpec` com o diálogo de pasta simulado e a gravação em disco de verdade (pasta temporária).
const ipc = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  folder: null as string | null,
  canceled: false,
  dialog: vi.fn(),
}))
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => ipc.handlers.set(channel, handler) },
  dialog: {
    showOpenDialog: async (...args: unknown[]) => {
      ipc.dialog(...args)
      return { canceled: ipc.canceled, filePaths: ipc.folder ? [ipc.folder] : [] }
    },
    showMessageBox: async () => ({ response: 0 }),
  },
  shell: {},
}))

const { registerTasksIpc } = await import('../src/main/ipc/tasks')
const invoke = (channel: string, ...args: unknown[]) => ipc.handlers.get(channel)!(undefined, ...args)

const TITLE = 'Simulador de Circuitos'
const ID = `sp-${(1).toString(36)}-1`
const MD = '# Especificação: Simulador de Circuitos\n\n## 1. Objetivo\n\ntexto\n'
let data: string
let target: string

beforeEach(() => {
  data = mkdtempSync(join(tmpdir(), 'ao36-data-'))
  target = mkdtempSync(join(tmpdir(), 'ao36-repo-'))
  ipc.handlers.clear()
  ipc.dialog.mockClear()
  ipc.folder = target
  ipc.canceled = false
  registerTasksIpc({ win: () => ({}) as never, store: { dataDirectory: data, settings: {} } as never, broadcast: vi.fn() } as never)
})
afterEach(() => {
  rmSync(data, { recursive: true, force: true })
  rmSync(target, { recursive: true, force: true })
})

function seed(withSpec: boolean): void {
  const store = new StudyIdeaStore(data)
  store.add([{ title: TITLE, description: 'Simula.', topics: ['Circuitos'] }], 0, 'motivo', 1)
  if (withSpec) store.saveSpec(ID, { generatedAt: 2, markdown: MD })
}

describe('office:exportStudySpec (AO-36)', () => {
  it('grava o .md com o texto da spec na pasta escolhida e devolve o caminho', async () => {
    seed(true)
    const file = (await invoke('office:exportStudySpec', ID)) as string
    expect(file).toBe(join(target, specFileName(TITLE)))
    expect(readFileSync(file, 'utf8')).toBe(MD)
    expect(ipc.dialog).toHaveBeenCalledTimes(1)
    expect(ipc.dialog.mock.calls[0]![1]).toMatchObject({ properties: expect.arrayContaining(['openDirectory']) })
  })

  it('não sobrescreve: arquivo existente fica intacto e o novo ganha o sufixo -2, depois -3', async () => {
    seed(true)
    const base = specFileName(TITLE).replace(/\.md$/, '')
    writeFileSync(join(target, `${base}.md`), 'da usuária')
    const second = (await invoke('office:exportStudySpec', ID)) as string
    expect(second).toBe(join(target, `${base}-2.md`))
    const third = (await invoke('office:exportStudySpec', ID)) as string
    expect(third).toBe(join(target, `${base}-3.md`))
    expect(readFileSync(join(target, `${base}.md`), 'utf8')).toBe('da usuária')
    expect(readFileSync(second, 'utf8')).toBe(MD)
    expect(readdirSync(target)).toHaveLength(3)
  })

  it('cancelar o diálogo devolve null e não grava nada', async () => {
    seed(true)
    ipc.canceled = true
    expect(await invoke('office:exportStudySpec', ID)).toBeNull()
    ipc.canceled = false
    ipc.folder = null
    expect(await invoke('office:exportStudySpec', ID)).toBeNull()
    expect(readdirSync(target)).toEqual([])
  })

  it('sem spec gerada dá erro claro e nem abre o diálogo', async () => {
    seed(false)
    await expect(invoke('office:exportStudySpec', ID)).rejects.toThrow('Gere a especificação antes de exportar.')
    expect(ipc.dialog).not.toHaveBeenCalled()
    expect(readdirSync(target)).toEqual([])
  })

  it('projeto que não está mais guardado dá erro e não grava', async () => {
    seed(true)
    await expect(invoke('office:exportStudySpec', 'sp-inexistente')).rejects.toThrow('Esse projeto não está mais guardado.')
    expect(existsSync(join(target, specFileName('Outro projeto')))).toBe(false)
  })
})
