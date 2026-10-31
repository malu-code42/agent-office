import { readFileSync } from 'node:fs'
import { parentPort } from 'node:worker_threads'

// Worker thread of the OCR queue (study-ocr.ts): renders the pages of a scanned PDF with pdf.js
// and reads them with Tesseract (Portuguese and English), one page at a time, off the main
// process' event loop. The Tesseract worker stays up between files.

type Recognizer = { recognize(image: Buffer): Promise<{ data: { text: string } }> }
let recognizer: Promise<Recognizer> | null = null

const tesseract = (langDir: string): Promise<Recognizer> => {
  recognizer ??= import('tesseract.js').then(({ createWorker }) => createWorker(['por', 'eng'], 1, { cachePath: langDir }))
  return recognizer
}

parentPort?.on('message', (message: { path: string; pages: number[]; langDir: string }) => {
  void (async () => {
    const { getDocumentProxy, renderPageAsImage } = await import('unpdf')
    const pdf = await getDocumentProxy(new Uint8Array(readFileSync(message.path)))
    try {
      const ocr = await tesseract(message.langDir)
      for (const index of message.pages) {
        let text = ''
        try {
          const image = await renderPageAsImage(pdf, index + 1, { canvasImport: () => import('@napi-rs/canvas'), scale: 2 })
          text = (await ocr.recognize(Buffer.from(image))).data.text
        } catch {
          // One unreadable page: it stays empty, the rest of the file goes on.
        }
        parentPort?.postMessage({ type: 'page', index, text })
      }
    } finally {
      const doc = pdf as unknown as { destroy?: () => Promise<void> }
      await doc.destroy?.().catch(() => undefined)
    }
  })().then(
    () => parentPort?.postMessage({ type: 'done' }),
    (error: unknown) => parentPort?.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) }),
  )
})
