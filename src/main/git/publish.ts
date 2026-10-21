import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import type { ResultChanges, WorktreeInfo } from '@shared/types'
import { gitRemoteHost, gitRemoteRepository, isPullRequestUrl } from '@shared/pull-request-url'
import { insideRoot } from './repo'
import { chunked, git, run, runBatch, safeGitEnv } from './run'
import { checkWorktree, worktreeState } from './worktrees'

/**
 * Commits exactly the listed files (not whatever else is staged). The message goes on
 * stdin (-F -), so nothing in it reads as an option. Hooks don't run (core.hooksPath is off for every office git call).
 * Returns the short sha.
 */
export async function commitChanges(c: ResultChanges, message: string): Promise<string> {
  if (!c.git) throw new Error('Essa pasta não é um repositório git.')
  if (c.truncated) throw new Error('São mudanças demais para commitar daqui. Use o terminal.')
  const paths = c.files.map((f) => f.path).filter((p) => insideRoot(c.root, p))
  if (!paths.length) throw new Error('Não há arquivos para commitar.')
  await chunked(c.root, ['add', '-A'], paths)
  await git(c.root, ['commit', '-F', '-', '--', ...paths], { timeout: 120_000, input: message })
  return (await git(c.root, ['rev-parse', '--short', 'HEAD'])).trim()
}

// ---------- tools on PATH ----------

/** First of `names` found on PATH, as an absolute path. Windows executables wear .exe, batch launchers .cmd/.bat. */
export function findOnPath(names: string[]): string | null {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : ['']
  const dirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean)
  for (const n of names) {
    for (const d of dirs) {
      for (const ext of exts) {
        const p = join(d, `${n}${ext}`)
        if (existsSync(p)) return p
      }
    }
  }
  return null
}

/** Opens the folder (and a file of it) in Cursor or VS Code. False when neither is installed. */
export async function openInEditor(root: string, file?: string): Promise<boolean> {
  const editor = findOnPath(['cursor', 'code'])
  if (!editor) return false
  const target = file ? insideRoot(root, file) : null
  try {
    await runBatch(editor, [root, ...(target ? [target] : [])], root, 15_000)
    return true
  } catch (err) {
    throw new Error(`Não consegui abrir o editor: ${err instanceof Error ? err.message : String(err)}`, { cause: err })
  }
}

/**
 * Pushes the agent's branch and opens a pull request with `gh`. Only after the player
 * clicked "Abrir PR" and confirmed. Returns the PR's URL.
 */
export async function openPullRequest(wt: WorktreeInfo, title: string, body: string): Promise<string> {
  checkWorktree(wt)
  const gh = findOnPath(['gh'])
  if (!gh)
    throw new Error(
      'Não achei o GitHub CLI (gh) no PATH. Instale (winget install GitHub.cli, ou scoop/choco no Windows e brew install gh no Mac) e rode `gh auth login`.',
    )
  // gh pr create needs a multiline body. Refuse batch shims before pushing: cmd.exe
  // cannot safely receive arbitrary PR text, and a late failure would leave a pushed branch.
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(gh)) {
    throw new Error('No Windows, instale o GitHub CLI como executável gh.exe; o launcher .cmd/.bat não pode abrir PR com segurança.')
  }
  const st = await worktreeState(wt)
  if (!st.exists) throw new Error('A cópia isolada deste agente não existe mais.')
  if (st.dirty) throw new Error('Tem mudanças não commitadas na cópia. Commite antes de abrir o PR.')
  if (!st.ahead) throw new Error('O branch ainda não tem commits. Commite as mudanças antes.')
  const selected = await selectedRemote(wt.root)
  const { remote, host, repository } = selected
  // Credentials come from gh's own helper only (the repo's credential.helper is wiped by
  // the safe config). gh's path goes inside single quotes, so it can't carry any.
  if (gh.includes("'")) throw new Error('O caminho do gh tem aspas; não dá para usar com segurança.')
  // The ref is spelled out so it can't read as an option.
  try {
    await git(wt.root, ['push', '-u', remote, `refs/heads/${wt.branch}:refs/heads/${wt.branch}`], {
      timeout: 180_000,
      config: [['credential.helper', `!'${gh}' auth git-credential`]],
    })
  } catch (err) {
    throw new Error(`Falhou o envio do branch ${wt.branch}: ${err instanceof Error ? err.message : String(err)}`, { cause: err })
  }
  // gh calls git itself: it gets the same safe config through GIT_CONFIG_*.
  // --flag=value: a title or body starting with '-' stays a value.
  let out: string
  try {
    out = await runBatch(
      gh,
      ['pr', 'create', `--head=${wt.branch}`, `--title=${title}`, `--body=${body}`],
      wt.root,
      120_000,
      await safeGitEnv(wt.root),
    )
  } catch (err) {
    throw new Error(`O gh não conseguiu criar o pull request: ${err instanceof Error ? err.message : String(err)}`, { cause: err })
  }
  const url = out
    .trim()
    .split('\n')
    .reverse()
    .find((l) => /^https:\/\/\S+$/.test(l.trim()))
  if (!url) throw new Error('O gh não devolveu o link do PR.')
  const prUrl = url.trim()
  if (!isPullRequestUrl(prUrl, host, repository)) throw new Error('A URL do PR não corresponde ao repositório remoto; o ticket continua ativo.')
  return prUrl
}

/** Selects the same remote used for publishing and fails closed without a derivable host. */
export async function pullRequestRemoteHost(wt: WorktreeInfo): Promise<string> {
  checkWorktree(wt)
  return (await selectedRemote(wt.root)).host
}

export async function pullRequestRemoteIdentity(wt: WorktreeInfo): Promise<{ host: string; repository: string }> {
  checkWorktree(wt)
  const { host, repository } = await selectedRemote(wt.root)
  return { host, repository }
}

/** Resolves the publishing host for an existing project folder without requiring a worktree. */
export async function pullRequestRemoteHostForRepo(root: string): Promise<string> {
  return (await selectedRemote(root)).host
}

export async function pullRequestRemoteIdentityForRepo(root: string): Promise<{ host: string; repository: string }> {
  const { host, repository } = await selectedRemote(root)
  return { host, repository }
}

async function selectedRemote(root: string): Promise<{ remote: string; host: string; repository: string }> {
  const remotes = (await git(root, ['remote'])).split('\n').map((r) => r.trim()).filter(Boolean)
  const remote = remotes.includes('origin') ? 'origin' : remotes[0]
  if (!remote || !/^\w[\w.-]*$/.test(remote)) throw new Error('Esse repositório não tem remoto para onde enviar o branch.')
  const remoteUrl = (await git(root, ['remote', 'get-url', remote])).trim()
  const host = gitRemoteHost(remoteUrl)
  const repository = gitRemoteRepository(remoteUrl)
  if (!host || !repository) throw new Error('Não foi possível identificar host e repositório do remoto; o ticket continua ativo.')
  return { remote, host, repository }
}

/** Returns the existing PR URL for an exact branch, or null when none is open. */
export async function pullRequestForBranch(wt: WorktreeInfo): Promise<string | null> {
  checkWorktree(wt)
  const { host, repository } = await selectedRemote(wt.root)
  const gh = findOnPath(['gh'])
  if (!gh) throw new Error('Não achei o GitHub CLI (gh). Instale e autentique com `gh auth login`.')
  const out = await run(
    gh,
    ['pr', 'list', `--head=${wt.branch}`, '--state=all', '--json=url', '--limit=1'],
    wt.root,
    { timeout: 30_000 },
    await safeGitEnv(wt.root),
  )
  let rows: unknown
  try {
    rows = JSON.parse(out)
  } catch {
    throw new Error('O GitHub CLI devolveu uma lista de PRs inválida; o ticket continua ativo.')
  }
  if (!Array.isArray(rows) || !rows.length) return null
  const url = (rows[0] as { url?: unknown })?.url
  if (typeof url !== 'string' || !isPullRequestUrl(url, host, repository))
    throw new Error('A URL do PR existente não passou na validação; o ticket continua ativo.')
  return url
}
