/// <reference types="electron-vite/node" />
import type { Worker } from 'node:worker_threads'
import createPdfWorker from './study-pdf-worker?nodeWorker'
import type { PdfExtractor } from './study-pdf'

/** A PDF that takes longer than this to parse is given up (and the worker restarted). */
const PARSE_TIMEOUT_MS = 90_000

/**
 * PDF text extraction in one worker thread, started on first use and shared by Cora and the
 * question scan. Requests queue in the worker; a crash or a stuck file fails the requests in
 * flight and the next request starts a fresh worker. The worker never keeps the app open.
 */
export function workerPdfExtractor(): PdfExtractor {
  let worker: Worker | null = null
  let next = 0
  const waiting = new Map<number, { resolve: (pages: string[]) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>()
  const failAll = (error: Error) => {
    for (const { reject, timer } of waiting.values()) {
      clearTimeout(timer)
      reject(error)
    }
    waiting.clear()
  }
  const start = (): Worker => {
    if (worker) return worker
    const w = createPdfWorker({})
    w.unref()
    w.on('message', (message: { id: number; pages?: string[]; error?: string }) => {
      const job = waiting.get(message.id)
      if (!job) return
      waiting.delete(message.id)
      clearTimeout(job.timer)
      if (message.pages) job.resolve(message.pages)
      else job.reject(new Error(message.error ?? 'PDF ilegível.'))
    })
    w.on('error', (error) => {
      if (worker === w) worker = null
      failAll(Object.assign(error, { transient: true }))
    })
    w.on('exit', () => {
      if (worker === w) worker = null
      // Not the file's fault: these are not remembered as unreadable (see PdfTextCache).
      failAll(Object.assign(new Error('A leitura de PDF foi interrompida.'), { transient: true }))
    })
    worker = w
    return w
  }
  return (bytes) =>
    new Promise<string[]>((resolve, reject) => {
      const id = ++next
      const timer = setTimeout(() => {
        // A stuck parse would hold every later PDF: restart the worker.
        waiting.delete(id)
        reject(new Error('PDF demorou demais para ser lido.'))
        void worker?.terminate()
      }, PARSE_TIMEOUT_MS)
      timer.unref()
      waiting.set(id, { resolve, reject, timer })
      // A copy is transferred: the caller's buffer may share memory with Node's pool.
      const copy = new Uint8Array(bytes)
      start().postMessage({ id, bytes: copy }, [copy.buffer])
    })
}
