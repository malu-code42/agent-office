import { describe, expect, it, vi } from 'vitest'
import { decide, type PolicyScope } from '../src/main/permissions/policy'

// Exercise the native POSIX model even when the suite is launched on Windows.
vi.mock('node:path', async (importOriginal) => {
  const path = await importOriginal<typeof import('node:path')>()
  return { ...path, isAbsolute: path.posix.isAbsolute, resolve: path.posix.resolve, sep: path.posix.sep }
})

const scope: PolicyScope = { cwd: '/work/project' }

describe('permission policy with POSIX paths', () => {
  it('allows ordinary files only inside the project', () => {
    expect(decide('auto', 'Read', { file_path: '/work/project/src/a.ts' }, scope)).toEqual({ verdict: 'allow' })
    expect(decide('auto', 'Write', { file_path: '/work/project/README.md' }, scope)).toEqual({ verdict: 'allow' })
    expect(decide('auto', 'Read', { file_path: '/work/project-neighbor/a.ts' }, scope).verdict).toBe('ask')
  })

  it('does not release relative, foreign, sensitive or traversal paths', () => {
    for (const file of ['src/a.ts', 'D:\\work\\project\\a.ts', '/work/project/../outside/a.ts'])
      expect(decide('auto', 'Read', { file_path: file }, scope).verdict, file).toBe('ask')
    expect(decide('auto', 'Read', { file_path: '/work/project/.env' }, scope).verdict).toBe('deny')
    expect(decide('auto', 'Write', { file_path: '/work/project/package.json' }, scope).verdict).toBe('ask')
  })

  it('denies symlinks that resolve outside the project', () => {
    const linked: PolicyScope = {
      ...scope,
      realpath: (file) => (file === '/work/project/link.txt' ? '/outside/private.txt' : file),
    }
    expect(decide('auto', 'Read', { file_path: '/work/project/link.txt' }, linked).verdict).toBe('ask')
  })

  it('allows real files inside the project but fails closed if resolution fails', () => {
    const input = { file_path: '/work/project/src/a.ts' }
    expect(decide('auto', 'Read', input, { ...scope, realpath: (file) => file })).toEqual({ verdict: 'allow' })
    expect(
      decide('auto', 'Read', input, {
        ...scope,
        realpath: () => {
          throw new Error('fixture')
        },
      }).verdict,
    ).toBe('ask')
  })

  it('keeps confirmation for git publishing and dependency installation', () => {
    expect(decide('auto', 'Bash', { command: 'git push origin main' }, scope).verdict).toBe('deny')
    for (const command of ['npm install example'])
      expect(decide('auto', 'Bash', { command }, scope).verdict, command).toBe('ask')
  })
})
