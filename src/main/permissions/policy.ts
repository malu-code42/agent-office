// A matriz de permissões do escritório (ticket 03). Tudo aqui é puro (sem Electron e sem
// SDK) para testar com `npm test`: o main consulta `decide` antes de mostrar um cartão ou
// devolver `allow` ao CLI. O escritório é a autoridade; o CLI nunca relaxa o que aqui
// responde ask — "Sem pedir" (bypassPermissions) só existe porque o consentimento do modo
// aconteceu antes, na escolha do agente.
//
// A ordem importa (a primeira resposta ganha):
//   1. bypassPermissions → allow (o jogador escolheu, sabendo, e pode trocar depois);
//   2. categoria de risco (Bash): apagar arquivo, RODAR CASCA OU INTERPRETADOR (bash -c,
//      cmd, powershell, eval, node…), instalar dependência, rede externa, git e publicação
//      SEMPRE pedem, no Automático e mesmo com "Sempre permitir";
//   3. "Sempre permitir" do projeto: ferramenta ou comando exato — o comando só confirma
//      o que a classificação provou seguro (leitura da lista, scripts fechados); desconhecido,
//      ambíguo ou de efeito externo pede. Risco, fora da pasta, arquivo sensível e sintaxe
//      não interpretável (metacaractere de shell) pulem a regra;
//   4. leitura e escrita dentro da pasta do projeto, pelo modo (Automático e Aceitar
//      edições; Planejar lê em qualquer pasta); escrita em arquivo que roda código pede;
//   5. todo o resto pede.
//
// Os caminhos aceitam os dois formatos (o CLI entrega Windows em Windows: barrras \\, / ou
// mistas): a pasta se compara em caminho ABSOLUTO resolvido por node:path, sem UNC
// (\\servidor), sem drive relativo (D:arq) e sem caracteres de controle. Com `realpath`
// (o main passa fs.realpath), o julgamento vem do arquivo real de verdade: caso de letra
// do Windows e symlink para fora ficam certos.

import { isAbsolute, resolve, sep } from 'node:path'
import { commandRisk as readOnlyBashRisk, sensitivePath, writeRisk } from '@shared/permission-notice'
import type { OfficePermissionMode } from '@shared/types'

/** Regra "Sempre permitir" — a forma vive em @shared/types (tipos compartilhados com a UI). */
export type { AlwaysAllowRule } from '@shared/types'
import type { AlwaysAllowRule } from '@shared/types'

export interface PolicyScope {
  /** Pasta do projeto (a worktree, quando há): leitura e edição in-scope do modo Automático. */
  cwd?: string
  /** Caminho real (symlinks e caixa de letra resolvidos); o main passa fs.realpath. */
  realpath?: (p: string) => string
  /** Regras "Sempre permitir" do projeto do agente. */
  rules?: AlwaysAllowRule[]
}

export type PolicyVerdict = 'allow' | 'ask' | 'deny'

export interface PolicyDecision {
  verdict: PolicyVerdict
  /** Para o cartão, uma linha que diz por que pediu. */
  why?: string
}

const FORA = 'fora da pasta do projeto'

// ---------- comandos Bash ----------

/** Palavras do começo que apagam, movem, mudam permissão ou pretendem o sistema. */
const DESTRUCTIVE = new Set([
  'rm',
  'rmdir',
  'unlink',
  'mv',
  'chmod',
  'chown',
  'chgrp',
  'sudo',
  'doas',
  'kill',
  'pkill',
  'skill',
  'dd',
  'mkfs',
  'shutdown',
  'reboot',
  'halt',
  'poweroff',
  'del',
  'rd',
  'erase',
  'format',
  'remove-item',
  'ren',
  'rename',
])
/** Git que muda histórico, índice ou árvore: commit e push são confirmação garantida pelo ticket. */
const GIT_HARMS = new Set([
  'push',
  'commit',
  'reset',
  'clean',
  'checkout',
  'restore',
  'revert',
  'rebase',
  'merge',
  'cherry-pick',
  'filter-branch',
  'notes',
  'rm',
  'add',
])
/** Instaladores (e publish) que buscam na rede e executam script de terceiros. */
const INSTALLERS = new Set([
  'npm',
  'pnpm',
  'yarn',
  'bun',
  'pip',
  'pip3',
  'poetry',
  'gem',
  'cargo',
  'brew',
  'apt',
  'apt-get',
  'dnf',
  'pacman',
])
const PUBLISH = new Set(['publish', 'dist-tag'])
/** Rede em texto simples: baixa, envia ou conversa com um servidor. */
const NETWORK = new Set(['curl', 'wget', 'nc', 'ncat', 'ssh', 'scp', 'sftp', 'ftp', 'telnet', 'rsync', 'gh'])

/**
 * Cabeças que re-interpretam o resto da linha: todo o sentido da lista de palavras do
 * comando (bash -c, cmd /c, eval, env, python x.py, node x.mjs…) foge do parser. Por isso
 * são categoria de risco por inteiro: pedem e nenhuma regra de "Sempre permitir" alcança.
 */
const WRAPPERS = new Set([
  'bash',
  'sh',
  'zsh',
  'dash',
  'ksh',
  'csh',
  'fish',
  'cmd',
  'command',
  'powershell',
  'pwsh',
  'eval',
  'exec',
  'env',
  'xargs',
  'nohup',
  'nice',
  'setsid',
  'node',
  'nodejs',
  'deno',
  'bun',
  'tsx',
  'python',
  'python3',
  'py',
  'perl',
  'ruby',
  'lua',
  'luajit',
  'awk',
  'php',
  'jshell',
  'groovy',
  'rscript',
])

/** Categoria de risco de um comando Bash completo, ou '' quando entra na lista permitida normal. */
function bashRisk(command: string): string {
  const words = command.split(' ').filter(Boolean)
  // A cabeça vale pelo programa, pelo apelido que ela usar: /bin/bash, /usr/bin/python e
  // cmd.exe são os re-interpretadores bash e python e cmd — o sentido fugido é o mesmo.
  const head = ((words[0] ?? '').toLowerCase().split(/[\\/]/).pop() ?? '').replace(/\.(exe|bat|cmd)$/, '')
  const rest = words.slice(1).map((w) => w.toLowerCase())
  if (WRAPPERS.has(head)) return 'executar programa'
  if (DESTRUCTIVE.has(head)) return 'apagar arquivos'
  // Flags podem deslocar a ação: git -C pasta push. Procura a ação em toda a linha.
  if (head === 'git' && rest.some((w) => GIT_HARMS.has(w))) return 'git'
  if (INSTALLERS.has(head)) {
    if (rest.some((w) => PUBLISH.has(w))) return 'publicar'
    if (head === 'gem' && rest.includes('push')) return 'publicar'
    if (rest.some((w) => INSTALL_WORDS.has(w))) return 'instalar dependências'
    return ''
  }
  if (NETWORK.has(head)) return 'rede externa'
  return ''
}
const INSTALL_WORDS = new Set([
  'install',
  'add',
  'install-global',
  'global',
  'update',
  'upgrade',
  'remove',
  'uninstall',
  'unlink',
  'link',
  'rebuild',
])

/** Caracteres do Bash: todo metacaractere fica de fora (mesma régua da notificação, AO-35). */
const COMMAND_CHARS = /^[A-Za-z0-9 ._/-]+$/

/** Scripts do package.json que o modo Automático roda sem perguntar. */
export const TEST_BUILD_SCRIPTS = new Set(['test', 'build', 'lint', 'typecheck', 'check'])

/** `npm test` e `npm run test|build|lint|typecheck|check`, exatamente, sem extras. */
function testBuildAllow(command: string): boolean {
  if (!command || command.length > 200 || !COMMAND_CHARS.test(command)) return false
  const w = command.split(' ')
  if (w.some((s) => !s)) return false
  if (w[0] !== 'npm') return false
  if (w.length === 2 && w[1] === 'test') return true
  return w.length === 3 && w[1] === 'run' && TEST_BUILD_SCRIPTS.has(w[2])
}

/**
 * A resposta para um Bash: Planejar só lê; categoria de risco pede em todo modo (a regra
 * nada alcança); e a "Sempre permitir" do comando exato só confirma a segurança que a
 * classificação provou — leitura pura da lista (pwd/ls/cat/head/tail/wc, caminho relativo
 * dentro da pasta) ou script fechado de teste/build. Comando desconhecido ou ambíguo
 * (cp, touch, npm run de script fora da lista, interpretador por caminho) pede — a regra
 * não adivinha por cima do que ninguém conseguiu provar (juiz, achado do bypass).
 */
function bashDecision(mode: OfficePermissionMode, command: string, scope: PolicyScope): PolicyDecision {
  const notice = readOnlyBashRisk(command, { cwd: scope.cwd, realpath: scope.realpath })
  if (mode === 'plan') return notice === '' ? { verdict: 'allow' } : { verdict: 'ask', why: 'Planejar só lê' }
  const category = bashRisk(command)
  if (category) return { verdict: 'ask', why: category }
  // As duas provas de segurança que existem de verdade no repo; todo o resto pede.
  const comprovado = notice === '' || testBuildAllow(command)
  if (mode === 'auto') return comprovado ? { verdict: 'allow' } : { verdict: 'ask' }
  // Pedir permissão e Aceitar edições: o exato salvado passa apenas confirmando o comprovado.
  if (comprovado && commandRuleAllows(command, scope.rules)) return { verdict: 'allow' }
  return { verdict: 'ask' }
}

/** Igualdade exata do comando, pela régua de caracteres (sem metacaractere não há o que
 * re-interpretar). Se ele é seguro, quem disse foi a classificação em bashDecision: a
 * regra confirma, jamais libera o desconhecido. */
function commandRuleAllows(command: string, rules?: AlwaysAllowRule[]): boolean {
  if (!rules?.length || !command || !COMMAND_CHARS.test(command)) return false
  return rules.some((r) => r.kind === 'command' && r.value === command)
}

// ---------- caminhos (Windows e POSIX) ----------

/** Control chars (0x00-0x1F, 0x7F) não são válidos em caminho. */
function hasControlChar(raw: string): boolean {
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i)
    if (c <= 0x1f || c === 0x7f) return true
  }
  return false
}

/** Recusa UNC (\\server, //server), control chars, ~, relativo e drive relativo; senão resolve . e .. */
function absPath(raw: string): string | undefined {
  if (raw.length > 4096 || hasControlChar(raw) || raw.startsWith('~')) return undefined
  if (raw.startsWith('\\\\') || raw.startsWith('//')) return undefined
  if (!isAbsolute(raw)) return undefined
  return resolve(raw)
}

/** `file` fica abaixo de `dir` (não é a própria pasta); seps iguais a node:path produziu. */
function strictlyInside(file: string, dir: string): boolean {
  const d = dir.endsWith(sep) ? dir : dir + sep
  return file.length > d.length && file.startsWith(d)
}

/** Caminho validado: `rel` é o relativo à pasta do projeto (com /); `why` diz por que não vale. */
interface ResolvedPath {
  why?: string
  /** Rel à pasta do projeto, com "/" nos separadores. */
  rel?: string
}

function resolveInScope(raw: unknown, scope: PolicyScope, projectCwdResolved: string): ResolvedPath {
  if (typeof raw !== 'string' || !raw) return { why: 'sem arquivo' }
  if (!projectCwdResolved) return { why: FORA }
  const wanted = absPath(raw)
  if (!wanted) return { why: 'caminho estranho' }
  // Com realpath, o julgamento é do arquivo de verdade no disco (caixa de letra e symlink).
  if (scope.realpath) {
    try {
      const realCwd = absPath(scope.realpath(projectCwdResolved)) ?? ''
      const realFile = absPath(scope.realpath(wanted)) ?? ''
      if (!realFile || !realCwd || !strictlyInside(realFile, realCwd)) return { why: FORA }
      return { rel: realFile.slice(realCwd.length + 1).replace(/\\/g, '/') }
    } catch {
      return { why: 'caminho que não deu para resolver' }
    }
  }
  if (!strictlyInside(wanted, projectCwdResolved)) return { why: FORA }
  return { rel: wanted.slice(projectCwdResolved.length + 1).replace(/\\/g, '/') }
}

// ---------- herramientas de arquivo ----------

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
const READ_TOOLS = new Set(['Read', 'Glob', 'Grep'])
/** Allowlist do filtro de busca de conteúdo (Grep em diretório): só extensões de código
 * e docs deste projeto. Lista curta e fechada de propósito — fora dela pede. Não entra
 * config/data genéricos (json, yaml, env, ini, csv...) porque podem carregar segredos,
 * nem chave/cert (pem, p12, key...). */
const EXTENSOES_COMUNS = new Set(['ts', 'tsx', 'js', 'mjs', 'html', 'css', 'md'])
const PATH_KEYS: Record<string, 'file_path' | 'notebook_path'> = {
  Write: 'file_path',
  Edit: 'file_path',
  MultiEdit: 'file_path',
  NotebookEdit: 'notebook_path',
}

/** Padrão que escapa da pasta (/, , ..\\) ou toca arquivo sensível. */
function patternInside(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || !raw) return undefined
  const flat = raw.replace(/\\/g, '/')
  if (flat.startsWith('/') || flat.startsWith('~') || flat.split('/').includes('..')) return undefined
  return flat
}

/** Classificação do pedido de arquivo, independente do modo: allow é seguro por direito
 * próprio, ask é risco (fora, sensível, ambíguo) — pergunta de risco que nenhuma regra
 * alcança. Quem resolve é o modo, depois. */
function fileDecision(tool: string, input: Record<string, unknown>, scope: PolicyScope, cwd: string): PolicyDecision | undefined {
  if (READ_TOOLS.has(tool)) {
    const pattern = patternInside(input.pattern ?? input.glob)
    if (tool !== 'Read' && !pattern) return { verdict: 'ask' }
    if (tool === 'Read') {
      const r = resolveInScope(input.file_path, scope, cwd)
      if (r.why) return { verdict: 'ask', why: r.why === FORA ? FORA : undefined }
      if (r.rel && sensitivePath(r.rel)) return { verdict: 'ask', why: 'arquivo sensível' }
    }
    if (tool === 'Glob') {
      // O padrão é o anúncio do que se busca: segredo no padrão pede. O lugar vem do
      // schema real (GlobInput do SDK: path é DIRETÓRIO; sem path é a pasta do agente) e
      // precisa existir de verdade e dentro do escopo — fora, relativo estranho, symlink
      // de saída e pasta do agente desconhecida pedem, com ou sem regra salvada. A raiz
      // é o próprio escopo: não precisa estar "abaixo de si mesma" (como no Grep).
      if (pattern !== undefined && sensitivePath(pattern)) return { verdict: 'ask', why: 'arquivo sensível' }
      const pInput = typeof input.path === 'string' ? input.path : ''
      const lugar = pInput ? absPath(pInput) : undefined
      const naRaiz = lugar !== undefined && lugar === cwd
      const destino: ResolvedPath = naRaiz
        ? { rel: '' }
        : pInput
          ? resolveInScope(pInput, scope, cwd)
          : cwd
            ? { rel: '' }
            : { why: 'sem a pasta do agente' }
      if (destino.why) {
        // Os porquês que explicam valem como resposta: fora e sem pasta do agente. O resto
        // (estranho, que quebrou) é ambíguo — pergunta fria, sem porquê defendível.
        return { verdict: 'ask', why: destino.why === 'sem a pasta do agente' ? destino.why : destino.why === FORA ? FORA : undefined }
      }
      if (destino.rel && sensitivePath(destino.rel)) return { verdict: 'ask', why: 'arquivo sensível' }
      // O padrão fechado: termina em `*.ext` da allowlist de código/docs. `*`, `*.*` e
      // `**/*` conseguem nomes de segredo, e o `*` de `*.env`/`*.pem` passa escondido de
      // SENSITIVE_WORDS (a mesma remenda do Grep: extensão fora da lista pede).
      const fundo = /(?:^|\/)\*\.([A-Za-z0-9]{1,8})$/.exec(pattern ?? '')
      if (fundo === null || !EXTENSOES_COMUNS.has((fundo[1] ?? '').toLowerCase())) {
        return { verdict: 'ask', why: 'busca larga' }
      }
      return { verdict: 'allow' }
    }
    if (tool === 'Grep') {
      // Busca de conteúdo só passa com o lugar anunciado e limitado (decisão da usuária,
      // ticket 03): sem path é busca larga na pasta inteira; diretório sem filtro para
      // arquivos comuns idem. O filtro provável de arquivos comuns é o glob do schema real
      // (GrepInput do SDK, sdk-tools.d.ts: path é arquivo OU diretório; glob = rg --glob) e
      // vale a allowlist exata de extensões comuns (EXTENSOES_COMUNS). Pede mesmo com regra
      // salvada: regra libera o que já era seguro, não esse risco.
      if (typeof input.path !== 'string' || !input.path) return { verdict: 'ask', why: 'busca larga' }
      // A raiz do projeto é o próprio escopo: não é fora; entra na régua do diretório lá embaixo.
      // (a raiz via apelido legítimo cai fora do strictlyInside, por isso o caso próprio aqui)
      const lugar = absPath(input.path)
      const naRaiz = lugar !== undefined && lugar === cwd
      const p = naRaiz ? { rel: '' } : resolveInScope(input.path, scope, cwd)
      if (p.why) return { verdict: 'ask', why: p.why === FORA ? FORA : undefined }
      if (p.rel && sensitivePath(p.rel)) return { verdict: 'ask', why: 'arquivo sensível' }
      // Arquivo comum explícito: o próprio lugar é o limite.
      if (p.rel && /\.[A-Za-z0-9]{1,8}$/.test(p.rel)) return { verdict: 'allow' }
      // Diretório (ou a raiz do projeto): só com filtro provável para arquivos comuns.
      // Glob é PADRÃO, não caminho: sensitivePath() não o valida — sensível lá é palavra
      // com fronteira, e o "*" de "*.env" a esconde; "qualquer extensão" alcança segredo.
      // Validação própria: exatamente "*.ext" com ext na allowlist (case-insensível).
      const filtro = patternInside(input.glob)
      const faixa = /^\*\.([A-Za-z0-9]{1,8})$/.exec(filtro ?? '')
      if (filtro === undefined || faixa === null || !EXTENSOES_COMUNS.has((faixa[1] ?? '').toLowerCase())) {
        return { verdict: 'ask', why: 'busca larga' }
      }
    }
    return { verdict: 'allow' }
  }
  if (WRITE_TOOLS.has(tool)) {
    const r = resolveInScope(input[PATH_KEYS[tool] ?? 'file_path'], scope, cwd)
    if (r.why === 'sem arquivo' || r.why === 'caminho estranho') return { verdict: 'ask' }
    if (r.why) return { verdict: 'ask', why: FORA }
    if (!r.rel || sensitivePath(r.rel)) return { verdict: 'ask' }
    return writeRisk([r.rel]) === '' ? { verdict: 'allow' } : { verdict: 'ask' }
  }
  return undefined
}

// ---------- regras "Sempre permitir" ----------

const SIDE_EFFECT_TOOLS = new Set(['WebFetch', 'WebSearch'])

/**
 * Ferramenta exata de uma regra de ferramenta. A regra só é consultada DEPOIS da
 * classificação: o que ela libera já era seguro, a pergunta era só do modo. Para o Bash
 * vale kind command (o Bash decide pela cabeça do comando: regra tool Bash não libera
 * comando nenhum), e rede externa pede sempre antes da regra. Ferramenta sem classificação
 * (MCP etc.) nunca chega aqui — o contrato por categoria fecha no seam 2/3; enquanto isso
 * o fallback é pedir.
 */
function ruleAllows(tool: string, rules?: AlwaysAllowRule[]): boolean {
  if (!rules?.length || SIDE_EFFECT_TOOLS.has(tool)) return false
  return rules.some((r) => r.kind === 'tool' && r.value === tool)
}

// ---------- decidir ----------

const MODES: readonly OfficePermissionMode[] = ['default', 'acceptEdits', 'auto', 'plan', 'bypassPermissions']

/**
 * A decisão do escritório para um pedido do agente. `mode` vem do modo do agente (com a
 * herança do projeto aplicada); `scope.cwd` é a pasta de trabalho do agente (a worktree).
 */
export function decide(
  mode: OfficePermissionMode,
  tool: string,
  input: Record<string, unknown> = {},
  scope: PolicyScope = {},
): PolicyDecision {
  const m = MODES.includes(mode) ? mode : 'default'
  if (m === 'bypassPermissions') return { verdict: 'allow' }

  if (tool === 'Bash') return bashDecision(m, typeof input.command === 'string' ? input.command : '', scope)

  // Classificação primeiro (independente do modo): risco e não interpretável pedem, sem regra.
  const cwd = absPath(scope.cwd ?? '') ?? ''
  const file = fileDecision(tool, input, scope, cwd)

  // Planejar: só leitura comum classificada dentro da pasta; o resto pede — quando a
  // classificação explica (fora, sensível), o porquê dela é a resposta, senão o aviso fixo.
  if (m === 'plan') {
    if (READ_TOOLS.has(tool) && file?.verdict === 'allow') return { verdict: 'allow' }
    return { verdict: 'ask', why: file?.why ?? 'Planejar só lê' }
  }

  // Rede externa (WebFetch/WebSearch) pede sempre, como um rm: antes de qualquer regra.
  if (SIDE_EFFECT_TOOLS.has(tool)) return { verdict: 'ask', why: 'rede externa' }

  if (file) {
    if (file.verdict === 'allow') {
      // Leitura comum in-scope passa em todo modo de trabalho: Pedir permissão anuncia
      // perguntar antes de editar/rodar, não antes de ler o projeto.
      if (READ_TOOLS.has(tool) || m === 'auto' || m === 'acceptEdits') return { verdict: 'allow' }
      // Pedir permissão: a pergunta era só do modo, e a regra do exato responde.
      if (ruleAllows(tool, scope.rules)) return { verdict: 'allow' }
      return { verdict: 'ask' }
    }
    return file // fora, sensível, padrão estranho: pergunta de risco à qual regra salvada não vale.
  }

  // Ferramenta sem classificação (MCP etc.): nem o nome de regra salva diz o que a ação
  // faz — o contrato por categoria fecha no seam 2/3; enquanto isso, sempre pedir.
  return { verdict: 'ask' }
}
