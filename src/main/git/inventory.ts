import { execFile } from 'node:child_process'
import { existsSync, lstatSync } from 'node:fs'
import { lstat, readdir, rm } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import type { WorktreeEntry } from '@shared/types'
import { isForgotten as sharedForgotten, isSafeToRemove as sharedSafe } from '@shared/worktrees'
import { headOf } from './repo'
import { git, SHA_RE } from './run'
import { validBranch, worktreeState, WORKTREES_DIR, type WorktreeState } from './worktrees'

// ---------- inventory: every agent copy of a repo (Bastidores → Worktrees) ----------

/** A copy as found on disk, with what removing it would take. */
export interface FoundWorktree extends WorktreeEntry {
  /** Commit the branch shares with the repo's HEAD: the base removeWorktree counts from. */
  base: string
  /** worktreeState at listing time; its fingerprint guards a confirmed removal. */
  state?: WorktreeState
}

/** Same path, whatever slashes git or the disk used (git prints C:/x on Windows). */
const samePath = (p: string) => {
  const r = resolve(p)
  return process.platform === 'win32' ? r.toLowerCase() : r
}

/** `git worktree list --porcelain`, only the entries under <repo>/.agent-office/worktrees. Keys are resolved paths. */
async function registered(repo: string): Promise<Map<string, string>> {
  const out = await git(repo, ['worktree', 'list', '--porcelain'])
  const dir = samePath(join(repo, WORKTREES_DIR)) + sep
  const found = new Map<string, string>()
  let path = ''
  for (const line of out.split(/\r?\n/)) {
    // git prints C:/x/y on Windows: resolve gives the C:\x\y that readdir and join use.
    if (line.startsWith('worktree ')) path = resolve(line.slice(9))
    else if (line.startsWith('branch refs/heads/') && samePath(path).startsWith(dir)) found.set(path, line.slice(18))
    else if (line === 'detached' && samePath(path).startsWith(dir)) found.set(path, '')
  }
  return found
}

/**
 * Commits that live only on this branch: not on any other branch, tag or remote. Those
 * are lost if the branch goes. `--all` can't be used: it counts the copy's own HEAD.
 */
async function uniqueCommits(repo: string, branch: string): Promise<number> {
  const own = `refs/heads/${branch}`
  const refs = (await git(repo, ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/tags', 'refs/remotes']))
    .split(/\r?\n/)
    .filter((r) => r && r !== own)
  const out = await git(repo, ['rev-list', '--count', own, '--stdin'], { input: refs.map((r) => `^${r}\n`).join('') })
  return Number(out.trim()) || 0
}

/** Bytes on disk: `du` where there is one (fast on node_modules), else a walk that never follows links. */
export async function folderSize(root: string): Promise<number | undefined> {
  if (process.platform !== 'win32') {
    return new Promise((done) =>
      execFile('du', ['-sk', root], { timeout: 60_000 }, (err, out) => {
        const kb = Number(String(out).split('\t')[0])
        done(err || !Number.isFinite(kb) ? undefined : kb * 1024)
      }),
    )
  }
  let total = 0
  const walk = async (dir: string): Promise<void> => {
    const items = await readdir(dir, { withFileTypes: true }).catch(() => [])
    await Promise.all(
      items.map(async (d) => {
        const p = join(dir, d.name)
        if (d.isDirectory()) return walk(p)
        if (d.isFile()) total += (await lstat(p).catch(() => null))?.size ?? 0
      }),
    )
  }
  await walk(root)
  return total
}

/**
 * Every copy the office made in `repo`: the ones git knows (with branch, changes, commits
 * and size), worktrees someone made by hand on another branch (`foreign`, never removed
 * from here) and loose folders git forgot (`broken`), which still take disk space.
 */
export async function listRepoWorktrees(repo: string): Promise<FoundWorktree[]> {
  repo = resolve(repo)
  const dir = join(repo, WORKTREES_DIR)
  if (!existsSync(dir)) return []
  const known = await registered(repo)
  const head = await headOf(repo)
  const folders = (await readdir(dir, { withFileTypes: true }).catch(() => [])).filter((d) => d.isDirectory()).map((d) => join(dir, d.name))
  const branchOf = (root: string) => {
    for (const [p, b] of known) if (samePath(p) === samePath(root)) return b
    return undefined
  }
  for (const p of known.keys()) if (!folders.some((f) => samePath(f) === samePath(p))) folders.push(p)
  const out: FoundWorktree[] = []
  for (const root of folders.sort()) {
    const createdAt = (() => {
      try {
        const st = lstatSync(root)
        return st.birthtimeMs || st.ctimeMs
      } catch {
        return undefined
      }
    })()
    const branch = branchOf(root)
    const empty = { root, repo, base: '', exists: existsSync(root), dirty: 0, ignored: 0, ahead: 0, unique: 0, createdAt }
    if (branch === undefined) {
      // A folder git no longer lists: only disk space.
      out.push({ ...empty, branch: '', broken: true })
      continue
    }
    if (!validBranch(branch)) {
      // Git lists it, on a branch the office never makes (or detached): not ours to remove.
      out.push({ ...empty, branch, foreign: true })
      continue
    }
    let base = ''
    let ahead = 0
    if (head) {
      base = (await git(repo, ['merge-base', head, `refs/heads/${branch}`]).catch(() => '')).trim()
      ahead = Number((await git(repo, ['rev-list', '--count', `${head}..refs/heads/${branch}`]).catch(() => '0')).trim()) || 0
    }
    if (!SHA_RE.test(base)) base = ''
    const state = await worktreeState({ path: root, root, repo, branch, base }).catch(() => undefined)
    out.push({
      root,
      repo,
      branch,
      base,
      state,
      exists: state?.exists ?? existsSync(root),
      dirty: state?.dirty ?? 0,
      ignored: state?.ignored ?? 0,
      ahead,
      // Any doubt counts as work: a failed count never makes a copy look safe.
      unique: await uniqueCommits(repo, branch).catch(() => Math.max(ahead, 1)),
      createdAt,
    })
  }
  return out
}

/** Safe to remove, and the listing could read it (a copy git would not describe never is). */
export const isSafeToRemove = (w: FoundWorktree) => sharedSafe(w) && !!w.state

/** Safe and old enough to call forgotten: what "Limpar esquecidas" takes. */
export const isForgotten = (w: FoundWorktree, now = Date.now()) => sharedForgotten(w, now) && !!w.state

/**
 * A loose folder under .agent-office/worktrees that git no longer lists: deleted from
 * disk after the player confirmed. Never a folder git still knows as a worktree, never
 * one outside that folder, and never follows a symlink out of the repo.
 */
export async function removeLooseFolder(repo: string, root: string): Promise<void> {
  repo = resolve(repo)
  root = resolve(root)
  const rel = relative(join(repo, WORKTREES_DIR), root)
  if (!rel || rel.startsWith('..') || rel.includes(sep) || rel.includes('/'))
    throw new Error('Essa pasta não está onde o Agent Office cria as cópias.')
  if (lstatSync(join(repo, '.agent-office')).isSymbolicLink() || lstatSync(join(repo, WORKTREES_DIR)).isSymbolicLink()) {
    throw new Error('A pasta .agent-office aponta para fora do repositório.')
  }
  for (const p of (await registered(repo)).keys()) {
    if (samePath(p) === samePath(root)) throw new Error('O git ainda conhece essa pasta como cópia: ela não está solta.')
  }
  if (!existsSync(root)) {
    await git(repo, ['worktree', 'prune']).catch(() => '')
    return
  }
  if (!lstatSync(root).isSymbolicLink()) await rm(root, { recursive: true, force: true })
  else await rm(root, { force: true })
  await git(repo, ['worktree', 'prune']).catch(() => '')
}
