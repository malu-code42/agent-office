/** The user's standing rule for every agent that changes files in a project. */
export const COMMIT_RULE =
  'Whenever you change files in a project, commit the change yourself without waiting to be asked: on a branch of its own, never straight on main. ' +
  "If the project's origin remote (git remote -v) is a repo under one of the user's own GitHub accounts, also push and open a pull request and give the user its link. " +
  'If it is anyone else\'s repo or has no such remote, stop at the local commit: no push, no pull request. ' +
  'Never merge unless the user asks you to in that conversation; commits, pushes and PRs still follow the office permission cards.'
