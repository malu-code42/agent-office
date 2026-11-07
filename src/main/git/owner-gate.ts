// AO-109, parte 3: o PORTÃO DO DONO. Antes de o código do escritório publicar (push e PR) ou mesclar, confere QUAL conta do GitHub
// o `gh` está usando agora (a conta ativa, que é a que o git usa pelo helper de credencial do gh) e recusa se não estiver na lista.
//
// - A lista é configurável (Configurações, `githubAccounts`); o padrão é só `malu-code42`. Lista vazia = recusa tudo.
// - Na dúvida, nega: `gh` ausente, sem rede, resposta ilegível ou login fora da lista viram erro e nada é publicado.
// - A conta vem de `gh api user`, ou seja, da identidade que o gh realmente vai usar (inclusive se GH_TOKEN estiver no ambiente),
//   e não de um texto que um agente pudesse informar.

import { run } from './run'

/** Única conta aceita por padrão. */
export const DEFAULT_GITHUB_ACCOUNTS: readonly string[] = ['malu-code42']

/** Login do GitHub: 1 a 39 caracteres, letras, números e hífen. */
const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/

/**
 * A lista efetiva. `undefined` (nunca configurada) = o padrão; qualquer outra coisa que não seja uma lista de logins
 * válidos vira lista vazia (que recusa tudo). Itens inválidos são descartados, repetidos e caixa são unificados.
 */
export function normalizeGithubAccounts(value: unknown): string[] {
  if (value === undefined) return [...DEFAULT_GITHUB_ACCOUNTS]
  if (!Array.isArray(value)) return []
  const out = new Set<string>()
  for (const v of value) if (typeof v === 'string' && LOGIN_RE.test(v.trim())) out.add(v.trim().toLowerCase())
  return [...out]
}

let provider: () => unknown = () => undefined

/** O app liga a lista das Configurações aqui (index.ts). Sem ligar, vale o padrão. */
export function setGithubAccountsProvider(fn: () => unknown): void {
  provider = fn
}

export function allowedGithubAccounts(): string[] {
  try {
    return normalizeGithubAccounts(provider())
  } catch {
    return []
  }
}

export interface OwnerGateDeps {
  /** Devolve o login ativo do gh para o host (padrão: `gh api user`). */
  activeLogin?: (gh: string, cwd: string, host: string, env?: NodeJS.ProcessEnv) => Promise<string>
  accounts?: () => string[]
}

async function ghActiveLogin(gh: string, cwd: string, host: string, env?: NodeJS.ProcessEnv): Promise<string> {
  const out = await run(gh, ['api', `--hostname=${host}`, 'user', '--jq=.login'], cwd, { timeout: 30_000 }, env)
  return out.trim()
}

/**
 * Lança erro (em português) se a conta ativa do gh não estiver na lista. Devolve o login conferido.
 * `host` precisa ser o host do remoto (ex.: github.com); host vazio recusa.
 */
export async function assertOwnerAccount(
  gh: string,
  cwd: string,
  host: string,
  env?: NodeJS.ProcessEnv,
  deps: OwnerGateDeps = {},
): Promise<string> {
  const accounts = (deps.accounts ?? allowedGithubAccounts)()
  if (accounts.length === 0)
    throw new Error('Nenhuma conta do GitHub está autorizada a publicar (a lista em Configurações está vazia); nada foi enviado.')
  if (!host) throw new Error('Não consegui identificar o host do GitHub; nada foi enviado.')
  let login: string
  try {
    login = (await (deps.activeLogin ?? ghActiveLogin)(gh, cwd, host, env)).trim()
  } catch {
    throw new Error('Não consegui confirmar qual conta do GitHub o gh está usando (rode `gh auth status`); nada foi enviado.')
  }
  if (!LOGIN_RE.test(login)) throw new Error('O gh devolveu uma conta ilegível; nada foi enviado.')
  if (!accounts.includes(login.toLowerCase()))
    throw new Error(
      `O gh está na conta "${login}", que não está na lista de contas autorizadas (${accounts.join(', ')}); nada foi enviado. Troque com \`gh auth switch\`.`,
    )
  return login
}
