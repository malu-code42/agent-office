// O PISO de permissões (AO-109): o que NENHUM agente faz, em nenhum modo, nem com cartão.
// Diferente de `policy.ts` (que responde allow/ask), aqui a resposta é só "negado" ou
// "nada a dizer". O piso é puro (sem Electron nem SDK) e roda antes de qualquer atalho
// (Luna, Emi, regras "Sempre permitir") e dentro do porteiro (hook PreToolUse), para valer
// mesmo que o Claude decida sozinho.
//
// Cobre:
//   - merge pelo terminal (git merge, gh pr merge, gh api .../merge);
//   - git push (qualquer um: publicar é ferramenta do escritório, não comando solto);
//   - ler ou escrever arquivos de credencial (lista ampliada, caminhos Windows e POSIX);
//   - editar ~/.claude*, a pasta de dados do escritório e o .git.
//
// Limite honesto: o piso vê o que o agente PEDE (comando, caminho). Um script que o agente
// escreve e executa roda fora desse alcance.

import { basename } from 'node:path'

export interface FloorScope {
  /** Pasta pessoal (para ~/.claude*). Opcional: sem ela só vale a regra por nome. */
  homeDir?: string
  /** Pasta de dados do escritório (userData). */
  dataDir?: string
}

export interface FloorDenial {
  /** Frase em português para o agente e para o log. */
  why: string
}

// ---------- arquivos sensíveis ----------

const EXAMPLE_ENV = /^\.env\.(example|sample|template|defaults?|dist)$/i
const KEY_EXT = /\.(pem|p12|pfx|key|keystore|jks)$/i
const SENSITIVE_DIRS = new Set(['.ssh', '.aws', '.gnupg', '.kube', 'secrets'])
const SENSITIVE_NAMES = new Set([
  '.claude.json',
  '.credentials.json',
  'bridge-token',
  'tokens.json',
  '.netrc',
  '.npmrc',
  '.pypirc',
  '.git-credentials',
  'id_rsa',
  'id_ed25519',
  'id_ecdsa',
])

/** Caminho em minúsculas, com / e sem aspas nas pontas. */
function flat(p: string): string {
  return p
    .trim()
    .replace(/^['"`]+|['"`]+$/g, '')
    .replace(/\\/g, '/')
    .toLowerCase()
}

/** O caminho (ou padrão de busca) aponta para credencial? `.env.example` e afins passam. */
export function isCredentialPath(raw: string): boolean {
  // `@.env` (curl -d @arquivo) e `--file=.env`: o caminho é o que vem depois do @ ou do =
  const eq = raw.lastIndexOf('=')
  if (eq > 0 && eq < raw.length - 1 && isCredentialPath(raw.slice(eq + 1))) return true
  const s = flat(raw.replace(/^@/, ''))
  if (!s) return false
  const parts = s.split('/').filter(Boolean)
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!
    if (SENSITIVE_DIRS.has(part)) return true
    if (SENSITIVE_NAMES.has(part)) return true
    if (/^\.env(\..+)?$/.test(part) && !EXAMPLE_ENV.test(part)) return true
    // O padrão de busca fala de .env mesmo com curinga (**/.env*, .env?)
    if (/^\.env[*?]/.test(part)) return true
    if (/^service-account.*\.json$/.test(part)) return true
    if (part === 'hosts.yml' && (parts[i - 1] === 'gh' || parts[i - 1] === 'github-cli')) return true
    if (part === 'config.json' && parts[i - 1] === '.docker') return true
  }
  return KEY_EXT.test(s)
}

// ---------- terminal ----------

/** Cabeças de comando que leem, copiam ou enviam o conteúdo de um arquivo. */
const READERS = new Set([
  'cat',
  'type',
  'get-content',
  'gc',
  'head',
  'tail',
  'less',
  'more',
  'sed',
  'awk',
  'grep',
  'egrep',
  'fgrep',
  'rg',
  'ag',
  'findstr',
  'select-string',
  'sls',
  'cp',
  'copy',
  'copy-item',
  'xcopy',
  'robocopy',
  'mv',
  'move',
  'bat',
  'nl',
  'od',
  'xxd',
  'hexdump',
  'strings',
  'base64',
  'certutil',
  'source',
  'curl',
  'wget',
  'scp',
  'sftp',
  'rsync',
  'tee',
  'sort',
  'uniq',
  'cut',
  'tar',
  'zip',
  '7z',
])

/** Opções globais do git que consomem o argumento seguinte. */
const GIT_OPT_WITH_VALUE = new Set(['-c', '-C', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--super-prefix', '--config-env'])

/** Quebra a linha em segmentos (;, &, |, nova linha, $( ), crases) e cada segmento em palavras. */
function segments(command: string): string[][] {
  return command
    .split(/;|&|\||\r?\n|\$\(|\)|`/)
    .map((seg) =>
      seg
        // redirecionamentos viram palavras próprias: `cat<.env` → cat < .env
        .replace(/([<>])/g, ' $1 ')
        .split(/\s+/)
        .map((w) => w.trim().replace(/^['"`(]+|['"`)]+$/g, ''))
        .filter(Boolean),
    )
    .filter((words) => words.length > 0)
}

function head(word: string): string {
  return basename(word.replace(/\\/g, '/')).toLowerCase().replace(/\.(exe|bat|cmd|ps1)$/, '')
}

/** A ação do git depois das opções globais (`git -C dir push` → push). */
function gitAction(args: string[]): { action: string; rest: string[]; aliasInjected: boolean } {
  let aliasInjected = false
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (GIT_OPT_WITH_VALUE.has(a)) {
      if (a === '-c' && /^alias\./i.test(args[i + 1] ?? '')) aliasInjected = true
      i++
      continue
    }
    if (a.startsWith('-')) {
      if (/^--(git-dir|work-tree|namespace|exec-path|super-prefix|config-env)=/.test(a)) continue
      if (/^-c.+/.test(a) && /^-calias\./i.test(a)) aliasInjected = true
      continue
    }
    return { action: a.toLowerCase(), rest: args.slice(i + 1), aliasInjected }
  }
  return { action: '', rest: [], aliasInjected }
}

const MERGE_WORD = /(^|[/=:-])merge($|[/?&=:])/i

/** Nega um comando de terminal (Bash, PowerShell) que fira o piso. */
export function floorBash(command: string): FloorDenial | undefined {
  if (!command) return undefined
  for (const words of segments(command)) {
    // A cabeça pode vir depois de env/sudo/bash -c: olha toda posição que seja git ou gh.
    for (let i = 0; i < words.length; i++) {
      const h = head(words[i]!)
      if (h === 'git') {
        const { action, aliasInjected } = gitAction(words.slice(i + 1))
        if (aliasInjected) return { why: 'git com alias injetado na linha de comando não é aceito' }
        if (action === 'merge') return { why: 'merge pelo terminal é negado; a usuária mescla pelo app ou pelo GitHub' }
        if (action === 'push') return { why: 'git push solto é negado; publicar é feito só pelo escritório' }
      } else if (h === 'gh') {
        const args = words.slice(i + 1).map((w) => w.toLowerCase())
        if (args[0] === 'pr' && args.includes('merge')) return { why: 'gh pr merge é negado; a usuária mescla pelo app ou pelo GitHub' }
        if (args[0] === 'api' && args.some((w) => MERGE_WORD.test(w))) return { why: 'merge pela API do GitHub é negado' }
        if (args[0] === 'auth' && args.includes('token')) return { why: 'ler o token do gh é negado' }
        if (args[0] === 'auth' && args.some((w) => w === '-t' || w === '--show-token')) return { why: 'ler o token do gh é negado' }
      }
    }
    // Credenciais: leitura/cópia por qualquer leitor, ou redirecionamento de/para o arquivo.
    const first = head(words[0] ?? '')
    const reader = words.slice(0, 4).some((w) => READERS.has(head(w))) || READERS.has(first)
    const redirected = words.some((w, i) => (w === '<' || w === '>') && isCredentialPath(words[i + 1] ?? ''))
    const bad = reader ? words.find((w) => isCredentialPath(w)) : undefined
    if (bad || redirected) return { why: 'arquivos de credencial não podem ser lidos nem copiados por agentes' }
  }
  return undefined
}

// ---------- ferramentas de arquivo ----------

const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'NotebookRead', 'LS'])
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
const TERMINAL_TOOLS = new Set(['Bash', 'PowerShell'])

function strings(input: Record<string, unknown>, keys: string[]): string[] {
  const out: string[] = []
  for (const k of keys) {
    const v = input[k]
    if (typeof v === 'string' && v) out.push(v)
  }
  return out
}

/** Zonas onde ninguém escreve: ~/.claude*, pasta de dados do escritório, .git. */
function protectedWriteZone(raw: string, scope: FloorScope): string | undefined {
  const s = flat(raw)
  const parts = s.split('/').filter(Boolean)
  if (parts.includes('.git')) return 'a pasta .git não é editada por agentes'
  const home = scope.homeDir ? flat(scope.homeDir).replace(/\/+$/, '') : ''
  if (home && s.startsWith(home + '/')) {
    const first = s.slice(home.length + 1).split('/')[0] ?? ''
    if (first === '.claude' || first.startsWith('.claude.') || first.startsWith('.claude-')) {
      return 'as configurações e o login do Claude (~/.claude*) não são editados por agentes'
    }
  }
  const data = scope.dataDir ? flat(scope.dataDir).replace(/\/+$/, '') : ''
  if (data && (s === data || s.startsWith(data + '/'))) return 'a pasta de dados do escritório não é editada por agentes'
  return undefined
}

/**
 * O piso para um pedido de ferramenta. Devolve a negação, ou undefined quando o piso não
 * tem nada a dizer (o resto da política decide).
 */
export function floorCheck(tool: string, input: Record<string, unknown> = {}, scope: FloorScope = {}): FloorDenial | undefined {
  if (TERMINAL_TOOLS.has(tool)) return floorBash(typeof input.command === 'string' ? input.command : '')
  if (READ_TOOLS.has(tool)) {
    for (const p of strings(input, ['file_path', 'path', 'pattern', 'glob', 'notebook_path'])) {
      if (isCredentialPath(p)) return { why: 'arquivos de credencial não podem ser lidos por agentes' }
    }
    return undefined
  }
  if (WRITE_TOOLS.has(tool)) {
    for (const p of strings(input, ['file_path', 'notebook_path'])) {
      if (isCredentialPath(p)) return { why: 'arquivos de credencial não podem ser alterados por agentes' }
      const zone = protectedWriteZone(p, scope)
      if (zone) return { why: zone }
    }
    return undefined
  }
  // Ferramentas que rodam código (context-mode): o texto vale como terminal.
  if (/(^|__)ctx_(batch_)?execute(_file)?$/.test(tool)) {
    const texts: string[] = strings(input, ['code', 'command'])
    const cmds = input.commands
    if (Array.isArray(cmds)) {
      for (const c of cmds) {
        if (typeof c === 'string') texts.push(c)
        else if (c && typeof c === 'object' && typeof (c as { command?: unknown }).command === 'string') texts.push((c as { command: string }).command)
      }
    }
    for (const t of texts) {
      const d = floorBash(t)
      if (d) return d
    }
    for (const p of strings(input, ['path', 'file_path'])) {
      if (isCredentialPath(p)) return { why: 'arquivos de credencial não podem ser lidos por agentes' }
    }
  }
  return undefined
}
