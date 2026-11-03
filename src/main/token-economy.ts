import { installedPlugins } from './agent-plugins'

/** Plugins that save tokens; no setting turns them off for an office agent (Bonnie loads no plugins at all). */
export const ECONOMY_PLUGINS = ['caveman@caveman', 'ponytail@ponytail', 'context-mode@context-mode']

/** Appended to every agent's system prompt (not Bonnie's): the plugin hooks inject the modes, this makes them binding. */
export const ECONOMY_RULE =
  'Token economy, binding: answer terse (caveman style, in the language the user wrote), answer first, no recap or closing offer. ' +
  'Make the smallest change that fully solves the task (ponytail): reuse what exists, add nothing unasked. ' +
  'Run anything whose output you will filter, count or summarise through the context-mode tools (ctx_batch_execute, ctx_execute, ctx_execute_file) ' +
  'instead of Bash/Read/PowerShell, so raw output stays out of the conversation; use Read only to prepare an Edit. ' +
  'Search with Grep/Glob before reading whole files, and read only the lines you need.'

/** Economy plugins missing from this computer's Claude install. */
export function missingEconomyPlugins(claudeHome: string): string[] {
  const have = installedPlugins(claudeHome)
  return ECONOMY_PLUGINS.filter((p) => !have.has(p))
}
