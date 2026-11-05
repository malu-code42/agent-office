import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const script = resolve('scripts/release-version.mjs')
let root = ''
let before = ''
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim()
const writePackage = (version: string, dependencies = {}) =>
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version, dependencies }))
const compare = (revision = before) => spawnSync(process.execPath, [script, revision], { cwd: root, encoding: 'utf8', windowsHide: true })

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ao-release-version-'))
  git('init', '-q')
  git('config', 'user.name', 'Fixture')
  git('config', 'user.email', 'fixture@example.org')
  writePackage('0.3.6-beta.2')
  git('add', 'package.json')
  git('commit', '-qm', 'Fixture')
  before = git('rev-parse', 'HEAD')
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('release version guard', () => {
  it('skips dependency-only changes even if the version has no published release', () => {
    writePackage('0.3.6-beta.2', { katex: '0.16.25' })
    const result = compare()
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe('same')
  })

  it('allows an explicit version change to reach the existing release check', () => {
    writePackage('0.3.6-beta.3')
    const result = compare()
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe('changed')
  })

  it('fails closed when the previous commit cannot be read', () => {
    const result = compare('f'.repeat(40))
    expect(result.status).not.toBe(0)
    expect(result.stdout).toBe('')
  })

  it('rejects malformed revisions before invoking git', () => {
    const result = compare('--help')
    expect(result.status).not.toBe(0)
    expect(result.stdout).toBe('')
  })

  it('guards push releases before contacting GitHub and keeps manual dispatch available', () => {
    const workflow = parse(readFileSync('.github/workflows/release.yml', 'utf8')) as {
      on: { workflow_dispatch: unknown }
      jobs: { version: { steps: { with?: { 'fetch-depth'?: number }; env?: Record<string, string>; run?: string }[] } }
    }
    expect(workflow.on).toHaveProperty('workflow_dispatch')
    const [checkout, version] = workflow.jobs.version.steps
    expect(checkout?.with?.['fetch-depth']).toBe(2)
    expect(version?.env?.RELEASE_EVENT).toBe('${{ github.event_name }}')
    expect(version?.env?.RELEASE_BEFORE).toBe('${{ github.event.before }}')
    const run = version!.run!
    expect(run).toContain('if [ "$RELEASE_EVENT" = "push" ]; then')
    expect(run).toContain('comparison="$(node scripts/release-version.mjs "$RELEASE_BEFORE")"')
    expect(run.indexOf('scripts/release-version.mjs')).toBeLessThan(run.indexOf('gh release view'))
    expect(run).toMatch(/comparison.*same[\s\S]*skip=true[\s\S]*exit 0/)
  })
})
