/// <reference types="electron-vite/node" />
import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { Worker } from 'node:worker_threads'
import { writeFileAtomic } from './fs-safe'
import type { StudyOcrState } from '../shared/study-library'
import { pagesWithoutText, type PdfOcrJob } from './study-pdf'
import createOcrWorker from './study-ocr-worker?nodeWorker'

/**
 * Reads the given pages (0-based) of a PDF with OCR and reports each page's text as it goes.
 * Rejects with `transient` when the reader itself stopped (not the file's fault).
 */
export type OcrRunner = (path: string, pages: number[], onPage: (index: number, text: string) => void) => Promise<void>

/** Text kept per page, as for the text layer (study-pdf.ts). */
const MAX_PAGE_TEXT = 64 * 1024

/**
 * OCR of scanned study PDFs, one file at a time in the background. The pages read so far are
 * kept in `<key>.ocr-progress.json` next to the PDF cache, so a closed app picks up where it
 * stopped. When a file is done its cache entry is rewritten with the recognised text (pages that
 * had text keep it). Nothing leaves the computer except the one-time download of the language data.
 */
export function pdfOcrQueue(cacheDir: string, run: OcrRunner, onState?: (state: StudyOcrState) => void): (job: PdfOcrJob) => void {
  const queued = new Set<string>()
  const jobs: PdfOcrJob[] = []
  let busy = false
  let current: { name: string; done: number; total: number } | null = null
  const report = () => onState?.(current ? { ...current, waiting: jobs.length } : null)

  const progressFile = (key: string) => join(cacheDir, `${key}.ocr-progress.json`)
  const readProgress = (key: string): Record<string, string> => {
    try {
      const file = progressFile(key)
      return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>) : {}
    } catch {
      return {}
    }
  }

  const work = async (job: PdfOcrJob): Promise<void> => {
    const progress = readProgress(job.key)
    const todo = pagesWithoutText(job.pages).filter((i) => progress[i] === undefined)
    let sinceSave = 0
    const total = pagesWithoutText(job.pages).length
    current = { name: basename(job.path), done: total - todo.length, total }
    report()
    const save = () => {
      try {
        writeFileAtomic(progressFile(job.key), JSON.stringify(progress))
      } catch {
        // Progress is a speed-up only: a failed write means re-reading those pages later.
      }
    }
    try {
      if (todo.length)
        await run(job.path, todo, (index, text) => {
          progress[index] = text.replace(/\s+\n/g, '\n').slice(0, MAX_PAGE_TEXT)
          if (++sinceSave >= 5) {
            sinceSave = 0
            save()
          }
        })
    } catch (error) {
      save()
      // The reader stopped: leave the job for the next time the file is looked up.
      if ((error as { transient?: boolean }).transient) return
    }
    job.finish(job.pages.map((text, i) => (progress[i] && progress[i]!.trim().length > text.trim().length ? progress[i]! : text)))
    try {
      unlinkSync(progressFile(job.key))
    } catch {
      // Nothing saved yet.
    }
  }

  const next = (): void => {
    if (busy) return
    const job = jobs.shift()
    if (!job) return
    busy = true
    void work(job).finally(() => {
      queued.delete(job.key)
      busy = false
      current = null
      report()
      next()
    })
  }

  return (job) => {
    if (queued.has(job.key)) return
    queued.add(job.key)
    jobs.push(job)
    report()
    next()
  }
}

/** The OCR runner of the app: a worker thread (pdf.js renders the page, Tesseract reads it). */
export function workerOcrRunner(langDir: string): OcrRunner {
  let worker: Worker | null = null
  return (path, pages, onPage) =>
    new Promise<void>((resolve, reject) => {
      const w = worker ?? createOcrWorker({})
      worker = w
      w.unref()
      const stop = (error: Error) => {
        w.off('message', onMessage)
        if (worker === w) worker = null
        reject(Object.assign(error, { transient: true }))
      }
      const onMessage = (message: { type: 'page'; index: number; text: string } | { type: 'done' } | { type: 'error'; message: string }) => {
        if (message.type === 'page') onPage(message.index, message.text)
        else {
          w.off('message', onMessage)
          w.off('error', stop)
          w.off('exit', onExit)
          if (message.type === 'done') resolve()
          else reject(new Error(message.message))
        }
      }
      const onExit = () => stop(new Error('A leitura por OCR foi interrompida.'))
      w.on('message', onMessage)
      w.once('error', stop)
      w.once('exit', onExit)
      w.postMessage({ path, pages, langDir })
    })
}
