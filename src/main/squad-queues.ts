import { join } from 'node:path'
import { z } from 'zod'
import type { SquadQueue } from '@shared/types'
import { backupCopies, shapeOf } from './backups'
import { loadJson, quarantineParts, reportLoad, writeJsonAtomic } from './fs-safe'
import { log } from './log'

// The queue of every squad: the ticket it works on and the ones waiting for it.
// It lives in the app's data, not in the squad folder: a squad folder is the
// Opensquad definition, and the office does not write anything else in it.

interface Data {
  queues: Record<string, SquadQueue>
}

/**
 * The shape of a queue that came back from the disk. A record that does not fit
 * (null, a field of the wrong type) is dropped: the renderer never sees it and the
 * office never comes down because of it.
 */
const queueSchema = z
  .object({
    code: z.string().regex(/^[\w-]{1,64}$/),
    cwd: z.string().min(1).max(4096),
    active: z.string().min(1).max(200).nullable(),
    queue: z.array(z.string().min(1).max(200)).max(500),
    updatedAt: z.number().finite(),
  })
  .superRefine((queue, ctx) => {
    const ids = [queue.active, ...queue.queue].filter((id): id is string => id !== null)
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: ['queue'], message: 'duplicate ticket id' })
  })

export class SquadQueueStore {
  private file: string
  private dir: string
  private data: Data

  constructor(dir: string) {
    this.dir = dir
    this.file = join(dir, 'squad-queues.json')
    this.data = this.load()
  }

  private load(): Data {
    const r = loadJson<Partial<Data>>(this.file, {
      valid: shapeOf('squad-queues.json'),
      fallbacks: backupCopies(this.dir, 'squad-queues.json'),
    })
    reportLoad(this.file, r)
    const raw: Partial<Data> = r.status === 'ok' || r.status === 'restored' ? r.data : {}
    const source = raw.queues && typeof raw.queues === 'object' && !Array.isArray(raw.queues) ? raw.queues : {}
    const queues: Record<string, SquadQueue> = {}
    const dropped: unknown[] = []
    for (const [code, value] of Object.entries(source)) {
      if (!/^[\w-]{1,64}$/.test(code)) {
        dropped.push({ code, value })
        continue
      }
      const parsed = queueSchema.safeParse(value)
      if (!parsed.success) {
        dropped.push({ code, value })
        continue
      }
      // The key of the file is the code of the squad: it wins over a code inside.
      if (parsed.data.code !== code) {
        dropped.push({ code, value })
        continue
      }
      queues[code] = parsed.data
    }
    // A queue that does not fit is left out, not used: o office abre com as filas
    // em que pode confiar. O que ficou de fora é guardado para o jogador.
    if (dropped.length) {
      const kept = quarantineParts(this.file, dropped)
      log.warn(`Dados: ${dropped.length} fila(s) de squad fora do formato foram descartadas${kept ? ` e guardadas em ${kept}` : ''}.`)
    }
    return { queues }
  }

  /** The queue of a squad; undefined when it has none. */
  get(code: string): SquadQueue | undefined {
    return this.data.queues[code]
  }

  /** Every queue, by squad code. */
  all(): SquadQueue[] {
    return Object.values(this.data.queues)
  }

  /** Saves the queue of a squad. */
  set(queue: SquadQueue): void {
    this.data.queues[queue.code] = queue
    this.save()
  }

  /** Forgets the queue of a squad. */
  remove(code: string): void {
    if (!this.data.queues[code]) return
    delete this.data.queues[code]
    this.save()
  }

  private save(): void {
    writeJsonAtomic(this.file, this.data)
  }
}
