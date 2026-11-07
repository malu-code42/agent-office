// AO-109, parte 3: o MERGE feito pelo código do escritório (ferramenta `merge_pr`, só no nível 5, com cartão reforçado a cada uso).
//
// O terminal continua negado pelo piso (floor.ts): o merge solto nunca passa. Aqui quem fala com o GitHub é este código,
// sem argumento livre: o agente só informa o NÚMERO do PR; repositório, URL, branch e commit vêm do remoto da pasta e do próprio gh.
// Antes de mesclar: o portão do dono confere a conta do gh; o PR tem de ser do repositório do remoto, estar aberto e ser de branch
// do mesmo repositório (nada de fork); e o commit que a usuária viu no cartão tem de ser o mesmo que está no PR (`--match-head-commit`).

import { isPullRequestUrl } from '@shared/pull-request-url'
import { assertOwnerAccount } from './owner-gate'
import { findOnPath, pullRequestRemoteIdentityForRepo } from './publish'
import { run, safeGitEnv, SHA_RE } from './run'

export interface PullRequestInfo {
  number: number
  url: string
  title: string
  /** `dono/repositório`, minúsculo. */
  repository: string
  host: string
  state: 'OPEN' | 'MERGED' | 'CLOSED'
  /** Branch do PR e branch de destino. */
  head: string
  base: string
  /** Commit da ponta do PR no momento da leitura. */
  sha: string
}

export interface MergeDeps {
  /** Roda o gh com estes argumentos na pasta e devolve a saída. */
  gh?: (args: string[]) => Promise<string>
  identity?: (root: string) => Promise<{ host: string; repository: string }>
  /** Portão do dono; padrão: `assertOwnerAccount` com o gh real. */
  assertOwner?: (host: string) => Promise<unknown>
}

function realGh(root: string): (args: string[]) => Promise<string> {
  return async (args) => {
    const gh = findOnPath(['gh'])
    if (!gh) throw new Error('Não achei o GitHub CLI (gh). Instale e autentique com `gh auth login`.')
    if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(gh)) throw new Error('No Windows, instale o GitHub CLI como executável gh.exe.')
    return run(gh, args, root, { timeout: 60_000 }, await safeGitEnv(root))
  }
}

/** O portão do dono com o gh real da máquina. */
export async function gateOwner(root: string, host: string): Promise<string> {
  const exe = findOnPath(['gh'])
  if (!exe) throw new Error('Não achei o GitHub CLI (gh). Instale e autentique com `gh auth login`.')
  return assertOwnerAccount(exe, root, host, await safeGitEnv(root))
}

const isPositiveInt = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n > 0

/** Lê o PR `number` do repositório da pasta. Qualquer coisa fora do esperado lança erro (nada é mesclado). */
export async function inspectPullRequest(root: string, number: number, deps: MergeDeps = {}): Promise<PullRequestInfo> {
  if (!isPositiveInt(number)) throw new Error('Número de PR inválido.')
  const { host, repository } = await (deps.identity ?? pullRequestRemoteIdentityForRepo)(root)
  const url = `https://${host}/${repository}/pull/${number}`
  if (!isPullRequestUrl(url, host, repository)) throw new Error('Não consegui montar a URL do PR deste repositório.')
  const out = await (deps.gh ?? realGh(root))([
    'pr',
    'view',
    url,
    '--json=number,title,state,headRefName,baseRefName,headRefOid,isCrossRepository,url',
  ])
  let data: Record<string, unknown>
  try {
    data = JSON.parse(out) as Record<string, unknown>
  } catch {
    throw new Error('O gh devolveu uma resposta ilegível sobre o PR; nada foi mesclado.')
  }
  const { state, headRefName, baseRefName, headRefOid, title } = data
  if (data.number !== number || typeof data.url !== 'string' || !isPullRequestUrl(data.url, host, repository))
    throw new Error('O PR devolvido não é deste repositório; nada foi mesclado.')
  if (state !== 'OPEN' && state !== 'MERGED' && state !== 'CLOSED') throw new Error('Estado do PR desconhecido; nada foi mesclado.')
  if (typeof headRefName !== 'string' || typeof baseRefName !== 'string' || typeof headRefOid !== 'string' || !SHA_RE.test(headRefOid))
    throw new Error('O gh não informou branch e commit do PR; nada foi mesclado.')
  if (data.isCrossRepository !== false) throw new Error('Esse PR vem de outro repositório (fork); o escritório não mescla PR de fora.')
  return {
    number,
    url: data.url,
    title: typeof title === 'string' ? title.slice(0, 200) : '',
    repository,
    host,
    state,
    head: headRefName,
    base: baseRefName,
    sha: headRefOid,
  }
}

/**
 * Mescla o PR com merge commit, só se: a conta do gh passa no portão, o PR está aberto e o commit da ponta continua sendo
 * `expectedSha` (o que a usuária viu no cartão). Não apaga branch. Devolve a URL do PR.
 */
export async function mergePullRequest(root: string, number: number, expectedSha: string, deps: MergeDeps = {}): Promise<string> {
  if (!SHA_RE.test(expectedSha)) throw new Error('Commit esperado inválido; nada foi mesclado.')
  const gh = deps.gh ?? realGh(root)
  const info = await inspectPullRequest(root, number, deps)
  await (deps.assertOwner ?? ((host) => gateOwner(root, host)))(info.host)
  if (info.state !== 'OPEN') throw new Error(`O PR #${number} não está aberto (${info.state}); nada foi mesclado.`)
  if (info.sha !== expectedSha) throw new Error('O PR mudou depois que você viu o cartão (há commit novo); nada foi mesclado. Peça de novo.')
  await gh(['pr', 'merge', info.url, '--merge', `--match-head-commit=${expectedSha}`])
  return info.url
}
