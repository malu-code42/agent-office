// AO-99: the single source of the commit / push / PR / merge rule. Every agent prompt of the office
// (Luna, Emi, Bonnie, Iris, hired agents, squad orchestrator and members) takes its text from here;
// never copy it into a prompt. Prompts for models are in English, member prompts for squads in pt-BR.

/** The user's standing rule for every agent that changes files in a project (English, for model prompts). */
export const COMMIT_RULE =
  'Whenever you change files in a project, commit the change yourself without waiting to be asked: on a branch of its own, never straight on main. ' +
  "If the project's origin remote (git remote -v) is a repo under one of the user's own GitHub accounts, also push and open a pull request and give the user its link. " +
  'If it is anyone else\'s repo or has no such remote, stop at the local commit: no push, no pull request. ' +
  'Never merge unless the user asks you to in that conversation; commits, pushes and PRs still follow the office permission cards.'

/** The same rule in pt-BR, for prompts written in Portuguese (squad members). Keep it in step with COMMIT_RULE. */
export const COMMIT_RULE_PT =
  'Sempre que você alterar arquivos de um projeto, faça você mesmo o commit da mudança, sem esperar que peçam: em um branch próprio, nunca direto na main. ' +
  'Se o remote origin do projeto (git remote -v) for um repositório de uma das contas GitHub da usuária, faça também o push, abra um pull request e informe o link a ela. ' +
  'Se for repositório de terceiros ou não tiver esse remote, pare no commit local: sem push, sem pull request. ' +
  'Nunca faça merge, a menos que a usuária peça isso nesta conversa; commits, pushes e PRs continuam passando pelos cartões de permissão do escritório.'
