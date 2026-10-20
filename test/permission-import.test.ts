import { describe, expect, it } from 'vitest'
import { previewClaudePermissions } from '../src/main/permissions/import'

describe('Claude permission import preview', () => {
  it('returns only exact tools and commands from permissions.allow, without applying anything', () => {
    expect(
      previewClaudePermissions({
        permissions: { allow: ['Read', 'Bash(npm test)', 'Bash(rm -rf /)', 'WebSearch', 'mcp__other__tool', 'Bash(npm test)'] },
      }),
    ).toEqual([
      { kind: 'tool', value: 'Read' },
      { kind: 'command', value: 'npm test' },
    ])
  })

  it('ignores malformed, unknown, deny and ask entries', () => {
    expect(
      previewClaudePermissions({ permissions: { allow: ['Read(**)', 'Bash(echo x; rm -rf /)', 42, 'Write', 'Bash(', 'WebFetch'] } }),
    ).toEqual([{ kind: 'tool', value: 'Write' }])
    expect(previewClaudePermissions({ permissions: { deny: ['Read'], ask: ['Bash(npm test)'] } })).toEqual([])
    expect(() => previewClaudePermissions(null)).toThrow()
  })
})
