/**
 * Everything the office does with git: per-agent worktrees (AO-33) and the files an
 * agent changed during a task (AO-34). Every call is execFile with an argument array,
 * never a shell string, and every path that comes back from the renderer is checked
 * against the repo root before git or the disk sees it.
 */

export { runBatch, runGit } from './run'
export { displayPath, insideRoot, repoRoot } from './repo'
export {
  createWorktree,
  excludeSquadRuntime,
  pendingLoss,
  pruneWorktrees,
  removeWorktree,
  slugify,
  validBranch,
  worktreeFromPath,
  worktreeState,
  WORKTREES_DIR,
  type WorktreeState,
} from './worktrees'
export { changesSince, discardChanges, fileDiff, takeSnapshot, type Snapshot } from './changes'
export { commitChanges, findOnPath, openInEditor, openPullRequest, pullRequestForBranch, pullRequestRemoteHost } from './publish'
