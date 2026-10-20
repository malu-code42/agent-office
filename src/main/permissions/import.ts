import type { AlwaysAllowRule } from '@shared/types'

const SAFE_TOOLS = new Set(['Read', 'Glob', 'Grep', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
const SAFE_COMMAND_TEXT = /^[A-Za-z0-9 ._/-]{1,200}$/
const SAFE_BUILD_COMMANDS = new Set(['npm test', 'npm run test', 'npm run build', 'npm run lint', 'npm run typecheck', 'npm run check'])

/** Extracts only exact Claude permissions that the Office policy can safely re-check.
 * It never applies them: callers must show this preview and get an explicit selection.
 */
export function previewClaudePermissions(raw: unknown): Array<Pick<AlwaysAllowRule, 'kind' | 'value'>> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('O arquivo não contém configurações Claude válidas.')
  const root = raw as Record<string, unknown>
  const permissions = root.permissions
  if (!permissions || typeof permissions !== 'object' || Array.isArray(permissions)) return []
  const allow = (permissions as Record<string, unknown>).allow
  if (!Array.isArray(allow)) return []
  const out: Array<Pick<AlwaysAllowRule, 'kind' | 'value'>> = []
  for (const entry of allow) {
    if (typeof entry !== 'string' || entry.length > 512) continue
    if (SAFE_TOOLS.has(entry)) out.push({ kind: 'tool', value: entry })
    else {
      const bash = /^Bash\((.*)\)$/.exec(entry)
      const command = bash?.[1]
      if (
        command &&
        SAFE_COMMAND_TEXT.test(command) &&
        SAFE_BUILD_COMMANDS.has(command) &&
        !out.some((r) => r.kind === 'command' && r.value === command)
      ) {
        out.push({ kind: 'command', value: command })
      }
    }
  }
  return out.filter((rule, i) => out.findIndex((x) => x.kind === rule.kind && x.value === rule.value) === i).slice(0, 100)
}
