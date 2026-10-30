import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { agentPlugins, availableSkills, installedPlugins, skillsPlugin } from '../src/main/agent-plugins'

const home = () => mkdtempSync(join(tmpdir(), 'ao-plugins-'))

function install(claudeHome: string, plugins: Record<string, unknown>): void {
  mkdirSync(join(claudeHome, 'plugins'), { recursive: true })
  writeFileSync(join(claudeHome, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins }))
}

function folder(base: string, name: string): string {
  const dir = join(base, 'cache', name)
  mkdirSync(dir, { recursive: true })
  return dir
}

function skill(claudeHome: string, name: string): void {
  mkdirSync(join(claudeHome, 'skills', name), { recursive: true })
  writeFileSync(join(claudeHome, 'skills', name, 'SKILL.md'), `---\nname: ${name}\n---\n`)
}

describe('installedPlugins', () => {
  it('lista plugins de escopo usuário com pasta existente', () => {
    const h = home()
    const caveman = folder(h, 'caveman')
    const ctx = folder(h, 'context-mode')
    install(h, {
      'caveman@caveman': [{ scope: 'user', installPath: caveman }],
      'context-mode@context-mode': [{ installPath: ctx }],
      'gone@x': [{ scope: 'user', installPath: join(h, 'nao-existe') }],
      'proj@x': [{ scope: 'project', installPath: caveman }],
      'bad@x': 'nope',
    })
    expect([...installedPlugins(h)]).toEqual([
      ['caveman@caveman', caveman],
      ['context-mode@context-mode', ctx],
    ])
  })

  it('arquivo ausente ou JSON inválido dá lista vazia', () => {
    const h = home()
    expect(installedPlugins(h).size).toBe(0)
    mkdirSync(join(h, 'plugins'))
    writeFileSync(join(h, 'plugins', 'installed_plugins.json'), '{quebrado')
    expect(installedPlugins(h).size).toBe(0)
  })
})

describe('skills escolhidas', () => {
  it('aceita só pastas com SKILL.md e nomes sem caminho', () => {
    const h = home()
    skill(h, 'tdd')
    mkdirSync(join(h, 'skills', 'vazia'), { recursive: true })
    expect(availableSkills(h, ['tdd', 'tdd', 'vazia', 'falta', '../plugins', '..'])).toEqual(['tdd'])
  })

  it('monta um plugin local com cópia das skills', () => {
    const h = home()
    skill(h, 'tdd')
    const dir = join(h, 'out')
    expect(skillsPlugin(h, dir, ['tdd'])).toBe(dir)
    expect(JSON.parse(readFileSync(join(dir, '.claude-plugin', 'plugin.json'), 'utf8')).name).toBe('agent-office-skills')
    expect(readFileSync(join(dir, 'skills', 'tdd', 'SKILL.md'), 'utf8')).toContain('name: tdd')
    expect(skillsPlugin(h, join(h, 'out2'), ['falta'])).toBeNull()
  })
})

describe('agentPlugins', () => {
  it('pula plugins desligados e inclui o plugin de skills', () => {
    const h = home()
    const caveman = folder(h, 'caveman')
    const ponytail = folder(h, 'ponytail')
    install(h, { 'caveman@caveman': [{ installPath: caveman }], 'ponytail@ponytail': [{ installPath: ponytail }] })
    skill(h, 'tdd')
    const skillsDir = join(h, 'skills-plugin')
    expect(agentPlugins(h, skillsDir, ['ponytail@ponytail'], ['tdd'])).toEqual([
      { type: 'local', path: caveman },
      { type: 'local', path: skillsDir },
    ])
    expect(agentPlugins(h, skillsDir, [], [])).toHaveLength(2)
  })
})
