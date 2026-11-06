import type { AgentResult, AgentSummary } from '@shared/types'

/**
 * Enable rules of the changed-files card of a result ("Abrir no editor", "Descartar",
 * "Commitar", "Abrir PR"). Pure so they are testable without the DOM; the result card
 * (dialog.ts) only wires these to the buttons.
 */

export interface ChangeRules {
  /** The files row is rendered; "Abrir no editor" shows with files. */
  editor: boolean
  discard: boolean
  commit: boolean
  /** Only worktree branches can open a PR; false hides the button, not just disables. */
  pr: boolean
}

/** The fields of ResultChanges the rules read (optional, as in the shared type). */
export interface ResultChangesLike {
  git: boolean
  root?: string
  committed?: string | null
  discarded?: boolean
  branch?: string | null
  truncated?: boolean
  files: unknown[]
}

export function changeButtons(c: ResultChangesLike | null | undefined): ChangeRules {
  if (!c) return { editor: false, discard: false, commit: false, pr: false }
  const live = !c.committed && !c.discarded
  const hasFiles = c.files.length > 0
  return {
    editor: hasFiles,
    discard: !!c.git && live && hasFiles && !c.truncated,
    commit: !!c.git && live && hasFiles && !c.truncated,
    // After the commit the branch is ready to push, so "Abrir PR" stays available.
    pr: !!c.git && !!c.branch && !c.discarded,
  }
}

/**
 * Results that opening an agent's conversation receives on its own. Squad deliveries wait
 * for their verified PR, errors stay for the reader, and results with changes keep the
 * commit and PR actions of their card.
 */
export function autoAckResults<T extends AgentResult>(agent: Pick<AgentSummary, 'squad' | 'role'> | undefined, results: T[]): T[] {
  if (!agent || agent.squad || agent.role === 'orchestrator') return []
  return results.filter((r) => !r.isError && !r.changes)
}

/**
 * Note shown when no editor was found and the office fell back to revealing the folder
 * in the file manager. The file manager has its own name per platform (Finder on Mac).
 */
export function editorMissingNote(ua: string): string {
  return ua.includes('Mac') ? 'Mostrei no Finder.' : 'Mostrei a pasta no explorador de arquivos.'
}
