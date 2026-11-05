import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

// A dependency-only merge must not release an unpublished copy of the same version.
try {
  const before = process.argv[2]
  if (!before || !/^[a-f0-9]{40}$/i.test(before)) throw new Error('Commit anterior inválido.')
  const current = JSON.parse(readFileSync('package.json', 'utf8')).version
  const previous = JSON.parse(
    execFileSync('git', ['show', `${before}:package.json`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
  ).version
  if (typeof current !== 'string' || !current || typeof previous !== 'string' || !previous) throw new Error('Versão ausente.')
  console.log(current === previous ? 'same' : 'changed')
} catch {
  console.error('Não foi possível comparar as versões. O release automático foi interrompido por segurança.')
  process.exitCode = 1
}
