import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ECONOMY_PLUGINS, ECONOMY_RULE, missingEconomyPlugins } from '../src/main/token-economy'

describe('token economy', () => {
  it('names the three plugins and the context-mode tools in the rule', () => {
    expect(ECONOMY_PLUGINS).toEqual(['caveman@caveman', 'ponytail@ponytail', 'context-mode@context-mode'])
    expect(ECONOMY_RULE).toContain('ctx_batch_execute')
  })

  it('lists the plugins missing from the Claude install', () => {
    const home = mkdtempSync(join(tmpdir(), 'eco-'))
    const dir = join(home, 'caveman')
    mkdirSync(dir)
    mkdirSync(join(home, 'plugins'))
    writeFileSync(
      join(home, 'plugins', 'installed_plugins.json'),
      JSON.stringify({ plugins: { 'caveman@caveman': [{ installPath: dir }] } }),
    )
    expect(missingEconomyPlugins(home)).toEqual(['ponytail@ponytail', 'context-mode@context-mode'])
  })
})
