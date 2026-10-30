import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const worktrees = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: root, encoding: 'utf8' })
  .split(/\r?\n/)
  .filter((line) => line.startsWith('worktree '))
  .map((line) => resolve(line.slice('worktree '.length)))
const eslint = findEslint(root)
const lintTargets = ['src', 'test', 'scripts']

function findEslint(start) {
  let directory = start
  while (true) {
    const candidate = resolve(directory, 'node_modules/eslint/bin/eslint.js')
    if (existsSync(candidate)) return candidate
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  throw new Error(`Não encontrei ESLint em node_modules acima de ${start}; instale as dependências no checkout principal.`)
}

let failed = false
for (const worktree of worktrees) {
  if (!existsSync(resolve(worktree, 'eslint.config.js'))) {
    console.error(`lint: no eslint.config.js in ${worktree}`)
    failed = true
    continue
  }
  const targets = lintTargets.filter((target) => existsSync(resolve(worktree, target)))
  const result = spawnSync(
    process.execPath,
    [eslint, ...targets],
    { cwd: worktree, stdio: 'inherit' },
  )
  if (result.error || result.status !== 0) {
    console.error(`lint failed: ${worktree}`)
    if (result.error) console.error(result.error)
    failed = true
  }
}

if (failed) process.exitCode = 1
