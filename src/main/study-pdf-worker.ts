import { parentPort } from 'node:worker_threads'
import { pdfPages } from './study-pdf'

// Worker thread of the PDF pool (study-pdf-pool.ts): parses one PDF at a time, so pdf.js never
// holds the main process' event loop (the window and IPC stay responsive during a cold scan).

parentPort?.on('message', (message: { id: number; bytes: Uint8Array }) => {
  pdfPages(message.bytes).then(
    (pages) => parentPort?.postMessage({ id: message.id, pages }),
    (error: unknown) => parentPort?.postMessage({ id: message.id, error: error instanceof Error ? error.message : String(error) }),
  )
})
