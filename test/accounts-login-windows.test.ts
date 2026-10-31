import { describe, expect, it } from 'vitest'
import { windowsLoginScript } from '../src/main/accounts'

describe('login de conta no Windows', () => {
  it('roda o login com a pasta da conta, sem herdar a de outra conta', () => {
    const extra = { id: 'x', name: 'Trabalho "2"', provider: 'claude' as const, color: '#fff', configDir: 'C:\\Users\\M\\.claude-trabalho' }
    const script = windowsLoginScript(extra, 'C:\\bin\\claude.exe')
    expect(script).toContain('set "CLAUDE_CONFIG_DIR=C:\\Users\\M\\.claude-trabalho"')
    expect(script).toContain('"C:\\bin\\claude.exe" auth login --claudeai')
    expect(script).toContain('entrando na conta "Trabalho 2"')
    const main = windowsLoginScript({ ...extra, configDir: undefined }, 'claude')
    expect(main).toContain('set CLAUDE_CONFIG_DIR=\r\n')
  })
})
