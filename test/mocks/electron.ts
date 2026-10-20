import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Just enough of Electron for the main process modules under test.
// Every path lives in a temporary folder made per test file; tests may move it with setPath.
const paths: Record<string, string> = { userData: mkdtempSync(join(tmpdir(), 'agent-office-test-')) }

export const app = {
  getPath: (name: string): string => paths[name] ?? paths.userData,
  setPath: (name: string, value: string): void => {
    paths[name] = value
  },
  isPackaged: false,
}

/** The channels the main process registered, so a test can call them. */
export const ipcMain = {
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown): void => {
    ipcMain.handlers.set(channel, fn)
  },
  on: (): void => undefined,
  removeHandler: (channel: string): void => {
    ipcMain.handlers.delete(channel)
  },
}

/** Calls the handler of a channel, the way the renderer would. */
export const callHandler = (channel: string, ...args: unknown[]): unknown => {
  const fn = ipcMain.handlers.get(channel)
  if (!fn) throw new Error(`Nenhum handler para ${channel}`)
  return fn({}, ...args)
}

export const dialog = {
  showMessageBox: async (): Promise<{ response: number }> => ({ response: 1 }),
  showOpenDialog: async (): Promise<{ canceled: boolean; filePaths: string[] }> => ({ canceled: true, filePaths: [] }),
  showSaveDialog: async (): Promise<{ canceled: boolean; filePath?: string }> => ({ canceled: true }),
}

export const shell = {
  openPath: async (): Promise<string> => '',
  openExternal: async (): Promise<void> => undefined,
  showItemInFolder: (): void => undefined,
}

export const clipboard = { writeText: (): void => undefined }

export default { app, ipcMain, dialog, shell, clipboard }
