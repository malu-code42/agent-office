import type { WorktreeEntry } from './types'

// Bastidores → Worktrees: what each agent copy holds, shared by the main process and the window.

/** A copy younger than this is never "esquecida": a terminal session may have just made it. */
export const FORGOTTEN_AFTER_MS = 24 * 60 * 60 * 1000

export const isBusy = (w: WorktreeEntry) => !!w.agentId

/** Work that lives only in the copy: uncommitted changes or commits on no other branch nor remote. */
export const hasWork = (w: WorktreeEntry) => !w.broken && !w.foreign && (w.dirty > 0 || w.unique > 0)

/** Nothing to lose: nobody in it, git knows it as ours, no uncommitted change, every commit also elsewhere. */
export const isSafeToRemove = (w: WorktreeEntry) => !w.agentId && !w.broken && !w.foreign && w.dirty === 0 && w.unique === 0

/** Safe and old enough to call forgotten: what "Limpar esquecidas" takes. */
export const isForgotten = (w: WorktreeEntry, now = Date.now()) =>
  isSafeToRemove(w) && (w.createdAt === undefined || now - w.createdAt >= FORGOTTEN_AFTER_MS)

/** 1,2 GB · 640 MB · — (not measured). */
export const sizeText = (n?: number) =>
  n === undefined
    ? '—'
    : n >= 1024 ** 3
      ? `${(n / 1024 ** 3).toFixed(1).replace('.', ',')} GB`
      : `${Math.max(n ? 1 : 0, Math.round(n / 1024 ** 2))} MB`

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** What the copy holds, in one line, and the chip tone it gets. */
export function worktreeStatus(w: WorktreeEntry): { text: string; tone: 'ok' | 'warn' | 'fail' | 'idle' } {
  if (w.broken)
    return { text: w.exists ? 'pasta solta: o git não a conhece mais, só ocupa espaço' : 'o git lista, mas a pasta sumiu', tone: 'fail' }
  if (w.foreign) return { text: 'criada fora do escritório (outro branch): remova pelo git', tone: 'idle' }
  if (w.agentId) return { text: `${w.agentName ?? 'um agente'} trabalha aqui`, tone: 'ok' }
  const parts = [
    w.dirty ? plural(w.dirty, 'mudança sem commit', 'mudanças sem commit') : '',
    w.unique ? plural(w.unique, 'commit não enviado', 'commits não enviados') : '',
  ].filter(Boolean)
  if (parts.length) return { text: `sem agente · ${parts.join(' · ')}`, tone: 'warn' }
  if (w.ahead) return { text: `sem agente · ${plural(w.ahead, 'commit', 'commits')} já em outro branch, nada se perde`, tone: 'idle' }
  return { text: 'sem agente · nada pendente', tone: 'idle' }
}
