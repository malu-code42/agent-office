// Uso: `npm run lint` verifica só o repo atual. `npm run lint -- --all` (ou AGENT_OFFICE_LINT_ALL=1) varre todos os worktrees Git.
// O ESLint é resolvido subindo pastas a partir do checkout, então worktrees aninhados sem node_modules próprio são varridos; só é pulado (com aviso) o que não acha node_modules em nenhuma pasta acima.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const all = process.argv.includes('--all') || process.env.AGENT_OFFICE_LINT_ALL === '1'
const worktrees = all
  ? execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: root, encoding: 'utf8' })
      .split(/\r?\n/)
      .filter((line) => line.startsWith('worktree '))
      .map((line) => resolve(line.slice('worktree '.length)))
  : [root]
const eslint = findEslint(root)
if (!eslint) throw new Error(`Não encontrei ESLint em node_modules acima de ${root}; instale as dependências no checkout principal.`)
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
  return null
}

let failed = false
for (const worktree of worktrees) {
  if (!existsSync(resolve(worktree, 'eslint.config.js'))) {
    console.error(`lint: no eslint.config.js in ${worktree}`)
    failed = true
    continue
  }
  // A worktree without dependencies cannot be linted (the config imports them); it is not a lint failure.
  if (worktree !== root && !findEslint(worktree)) {
    console.warn(`lint: skipping ${worktree} (no node_modules above it)`)
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
