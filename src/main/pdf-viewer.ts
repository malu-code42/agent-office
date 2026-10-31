import { BrowserWindow } from 'electron'
import { basename } from 'node:path'
import { pathToFileURL } from 'node:url'

/** `file:///…/livro.pdf#page=12`: Chromium's PDF viewer opens at that page. */
export function pdfPageUrl(path: string, page: number): string {
  const n = Number.isInteger(page) && page > 0 ? page : 1
  return `${pathToFileURL(path).href}#page=${n}`
}

/**
 * Opens a study PDF at a page in a window of its own, with Electron's built-in PDF viewer (the
 * system app can't be told a page on every platform). The window shows only that file: no
 * preload, no popups, no navigation away.
 */
export function openPdfAtPage(path: string, page: number): void {
  const w = new BrowserWindow({
    width: 1000,
    height: 900,
    title: basename(path),
    backgroundColor: '#1f1b24',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, plugins: true },
  })
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  w.webContents.on('will-navigate', (e) => e.preventDefault())
  void w.loadURL(pdfPageUrl(path, page))
}
