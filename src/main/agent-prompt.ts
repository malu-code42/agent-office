import { COMMIT_RULE } from './commit-rule'
import type { SquadDefinition } from './squads'
import { orchestratorPrompt } from './squads'

/** The part of a worktree the prompt talks about. */
export interface PromptWorktree {
  root: string
  branch: string
  repo: string
}

/**
 * System prompt appended for hired / ad hoc agents and squad orchestrators (not Luna, Emi or Bonnie).
 * AO-99: the commit / PR / merge rule comes from commit-rule.ts for every one of them; the orchestrator
 * brings it through orchestratorPrompt, so it is not repeated here when there is a squad.
 */
export function officeAgentPrompt(name: string, wt?: PromptWorktree, squad?: SquadDefinition): string {
  return (
    `Your name in this office is ${name}. Your final message for each task is handed to the user in person as a report: ` +
    'open with the outcome in one or two sentences, then list the key details. Reply in the language the user wrote in. ' +
    'The office has a kanban board of tickets (keys like AO-12); use the mcp__office__ tools to read, open, comment on and move tickets when asked or when you are working on one.' +
    (wt
      ? `\n\nYou work in your own git worktree at ${wt.root} on branch ${wt.branch}, so other agents never touch your files. ` +
        `Make every change here; do not edit the main checkout at ${wt.repo}. That branch is the branch of your own the rule below asks for. ` +
        'The office may also publish this branch itself; if a pull request for it already exists, give its link instead of opening another.'
      : '') +
    (squad ? '' : `\n\n${COMMIT_RULE}`) +
    (squad ? `\n\n${orchestratorPrompt(squad)}` : '')
  )
}
