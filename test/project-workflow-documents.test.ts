import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readProjectDocuments } from '../src/main/project-workflow-documents'

const dirs: string[] = []
const repo = () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ao-project-docs-'))
  dirs.push(cwd)
  execFileSync('git', ['init', '-q', cwd])
  return cwd
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('readProjectDocuments', () => {
  it('reads only project documentation that Git does not ignore', () => {
    const cwd = repo()
    mkdirSync(join(cwd, 'docs'))
    mkdirSync(join(cwd, 'node_modules', 'private-doc'), { recursive: true })
    writeFileSync(join(cwd, 'README.md'), '# Project\nPublic overview.')
    writeFileSync(join(cwd, 'docs', 'design.md'), '# Design\nApproved architecture.')
    writeFileSync(join(cwd, '.gitignore'), 'docs/private.md\n')
    writeFileSync(join(cwd, 'docs', 'private.md'), 'Do not send this.')
    writeFileSync(join(cwd, 'node_modules', 'private-doc', 'README.md'), 'Do not send dependencies.')
    writeFileSync(join(cwd, '.env'), 'API_KEY=sk-ant-example')

    const result = readProjectDocuments(cwd)

    expect(result.documents.map((doc) => doc.path)).toEqual(['README.md', 'docs/design.md'])
    expect(result.documents.map((doc) => doc.content).join('\n')).not.toContain('Do not send')
    expect(result.skipped).toBeGreaterThanOrEqual(1)
  })

  it('refuses symlinks and skips documents that look like they contain secrets', () => {
    const cwd = repo()
    writeFileSync(join(cwd, 'README.md'), '# Project\nSafe.')
    writeFileSync(join(cwd, 'credentials.md'), '# Credentials')
    writeFileSync(join(cwd, 'secrets.md'), '-----BEGIN PRIVATE KEY-----')
    const external = join(cwd, '..', 'outside-project.md')
    writeFileSync(external, 'Outside project')
    try {
      symlinkSync(external, join(cwd, 'linked.md'))
    } catch {
      // Symlink privileges vary on Windows; the other exclusion assertions still apply.
    }

    const result = readProjectDocuments(cwd)
    expect(result.documents.map((doc) => doc.path)).toEqual(['README.md'])
    expect(result.documents.some((doc) => doc.content.includes('PRIVATE KEY'))).toBe(false)
    rmSync(external, { force: true })
  })

  it('excludes a configured vault even when the vault is nested inside the project root', () => {
    const cwd = repo()
    mkdirSync(join(cwd, 'personal-vault', '.obsidian'), { recursive: true })
    writeFileSync(join(cwd, 'README.md'), 'Project docs')
    writeFileSync(join(cwd, 'personal-vault', 'notes.md'), 'Private vault note')
    writeFileSync(join(cwd, 'personal-vault', '.obsidian', 'app.json'), '{}')

    const result = readProjectDocuments(cwd, [join(cwd, 'personal-vault')])

    expect(result.documents.map((doc) => doc.path)).toEqual(['README.md'])
  })

  it('caps file count, per-file bytes and total bytes', () => {
    const cwd = repo()
    for (let index = 0; index < 45; index++) writeFileSync(join(cwd, `doc-${String(index).padStart(2, '0')}.md`), 'x'.repeat(20_000))

    const result = readProjectDocuments(cwd)

    expect(result.documents.length).toBeLessThanOrEqual(40)
    expect(result.bytes).toBeLessThanOrEqual(400_000)
    expect(result.skipped).toBeGreaterThan(0)
  })
})
