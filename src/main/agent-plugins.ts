// Claude Code plugins and skills for office agents (#106). The SDK runs isolated
// (settingSources: []) so saved permission rules never skip the office's cards;
// plugins and chosen skills are handed over explicitly instead.

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface LocalPlugin {
  type: 'local'
  path: string
}

/** Name of the plugin the office builds from the chosen skills of ~/.claude/skills. */
export const SKILLS_PLUGIN = 'agent-office-skills'

/** A skill folder name: no separators or dots-only names, so it never leaves ~/.claude/skills. */
export const SKILL_NAME_RE = /^(?!\.+$)[\w.-]{1,100}$/

/**
 * User-scope plugins installed in Claude Code, from `<claudeHome>/plugins/installed_plugins.json`:
 * name (`plugin@marketplace`) -> install folder. A missing or broken file means none.
 */
export function installedPlugins(claudeHome: string): Map<string, string> {
  const out = new Map<string, string>()
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(join(claudeHome, 'plugins', 'installed_plugins.json'), 'utf8'))
  } catch {
    return out
  }
  const plugins = (raw as { plugins?: unknown })?.plugins
  if (!plugins || typeof plugins !== 'object') return out
  for (const [name, entries] of Object.entries(plugins)) {
    if (!Array.isArray(entries)) continue
    const entry = entries.find((e) => e && typeof e.installPath === 'string' && (e.scope ?? 'user') === 'user')
    if (entry && existsSync(entry.installPath)) out.set(name, entry.installPath)
  }
  return out
}

/** Skill folders of `<claudeHome>/skills` (those with a SKILL.md), by name. */
export function availableSkills(claudeHome: string, names: string[]): string[] {
  return [...new Set(names)].filter((n) => SKILL_NAME_RE.test(n) && existsSync(join(claudeHome, 'skills', n, 'SKILL.md')))
}

let builtFor: string | undefined

/**
 * Builds a local plugin at `dir` with copies of the chosen skills, so agents get only those
 * and not the whole folder (~1.400 skills would flood every context). Null when none exists.
 * shortcut: rebuilt only when the list changes, not when a skill's files change; restart the office to pick those up.
 */
export function skillsPlugin(claudeHome: string, dir: string, names: string[]): string | null {
  const skills = availableSkills(claudeHome, names)
  if (!skills.length) return null
  const key = `${dir}\n${skills.join('\n')}`
  if (builtFor === key && existsSync(join(dir, '.claude-plugin', 'plugin.json'))) return dir
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(join(dir, '.claude-plugin'), { recursive: true })
  writeFileSync(
    join(dir, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: SKILLS_PLUGIN, version: '1.0.0', description: 'Skills escolhidas no Agent Office.' }, null, 2),
  )
  for (const name of skills) cpSync(join(claudeHome, 'skills', name), join(dir, 'skills', name), { recursive: true, dereference: true })
  builtFor = key
  return dir
}

/** Every plugin an office agent loads: installed ones not turned off, plus the chosen skills. */
export function agentPlugins(claudeHome: string, skillsDir: string, off: string[], skills: string[]): LocalPlugin[] {
  const out: LocalPlugin[] = []
  for (const [name, path] of installedPlugins(claudeHome)) if (!off.includes(name)) out.push({ type: 'local', path })
  try {
    const own = skillsPlugin(claudeHome, skillsDir, skills)
    if (own) out.push({ type: 'local', path: own })
  } catch {
    // A skill that fails to copy must not keep the agent from starting; it runs without them.
    builtFor = undefined
  }
  return out
}
