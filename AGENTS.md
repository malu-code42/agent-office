# AGENTS.md — guia para IAs que vão alterar o Agent Office

App Electron (TypeScript, ESM): escritório isométrico em pixel art (Canvas2D) onde agentes do Claude Code trabalham via
`@anthropic-ai/claude-agent-sdk`. Roda em macOS, Windows 10/11 e Linux x64. Produto e uso: `README.md`, `COMO-RODAR.md`.

## Comandos

Scripts em `package.json`. Se `npm install` falhar com "Electron uninstall": `node node_modules/electron/install.js`.
`npm run demo` abre agentes simulados, sem gastar tokens. `npm run lint` cobre o checkout e todas as worktrees Git.

Antes de entregar: `npm run typecheck && npm run lint && npm test && npm run build` (o que o CI roda: macOS e Windows, Node 22).

Variáveis úteis: `AGENT_OFFICE_DEMO=1`, `AGENT_OFFICE_TOUR=1`, `AGENT_OFFICE_FAKE_UPDATE=0.9.0`,
`AGENT_OFFICE_CLAUDE=<caminho>`, `AGENT_OFFICE_DATA_DIR=<pasta>` (troca o userData; use para não mexer nos dados reais).

## Leia antes de começar (obrigatório)

Antes de editar, **leia o arquivo** que bate com a tarefa. Não improvise: as receitas têm passos que o código sozinho não mostra.

- Mexer em pasta que você não conhece, em cadeia de classes (agents, game, board, panel) ou citar um ADR: `docs/agents/mapa-e-armadilhas.md`.
- Novo canal IPC, novo modal, mundo 2D, UI/acessibilidade ou escrever testes: a seção correspondente de `docs/agents/receitas.md`.
- Windows: `docs/adr/`, `docs/prd/windows-primeira-classe.md`. Vários ADRs estão desatualizados; confira o código antes de confiar.

Na dúvida se o arquivo se aplica, leia.

## Regras da casa

### Idioma
- Todo texto visível ao usuário é **pt-BR**: UI, erros, notificações, mensagens de log. Não há i18n.
- Prompts enviados aos agentes são em inglês.
- Comentários: inglês na maior parte, português aceito. Siga o idioma do arquivo.
- Textos que mudam por sistema operacional vão em `src/renderer/src/ui/os-text.ts` (`DARWIN`, `WIN32`, `OTHER`).

### Estilo
- Prettier: sem ponto e vírgula, aspas simples, `trailingComma: all`, `printWidth: 140`.
  O CI não roda Prettier (arquivos antigos falhariam). Formate **só os arquivos que tocar**: `npm run format -- <arquivos>`.
- ESLint: variável não usada é erro; prefixe com `_` para ignorar. TypeScript `strict` + `noUnusedLocals`.
- Classes grandes são divididas em cadeia linear de classes abstratas, uma por arquivo (agents, game, board, panel).
  Para adicionar comportamento, insira um elo na cadeia; não crie classe irmã.
- `index.ts` de pastas reexporta para manter caminhos de import antigos.
- Comentários citam tickets `AO-NN` e ADRs. Comente o porquê, não o quê. `catch {}` vazio precisa de comentário.

### Segurança (não negociável)
- O renderer é **não confiável**. Todo handler IPC recebe `unknown` e valida com zod em `validate.ts`.
- Janela com `sandbox`, `contextIsolation`, navegação e `window.open` bloqueados. CSP estrita em `index.html`. Não afrouxe.
- Processos externos: `execFile`/`spawn` com array de argumentos, **nunca** shell (ver `git/run.ts`, ADR 0006).
- Markdown de agentes passa por `ui/markdown.ts` (marked + DOMPurify). Não use `innerHTML` com conteúdo de agente ou usuário.
  No DOM, use `h()` de `ui/dom.ts`: filhos string viram nós de texto.
- Logs: nunca registre prompts, mensagens ou input de ferramentas. Tudo passa por `redact()`.
- O bridge escuta só em 127.0.0.1, exige token e rejeita `Origin`. Ele faz backup de `~/.claude/settings.json` e preserva hooks do usuário. Mantenha isso.

### Dados do usuário
- Ficam em `app.getPath('userData')` (arquivos de dados listados em `DATA_FILES` de `backups.ts`; também `stats.json`,
  `bridge-token`, `logs/`, `backups/`, `study-pdf-cache/` — texto dos PDFs da Cora, lido em worker thread; só trechos vão a modelos, na montagem do banco iniciada pela usuária; `study-bank-job.json` — andamento da montagem do banco de questões).
- Banco de questões: montado só pela IA (cadeia de agentes, sem revisão manual) e questões respondidas nunca se repetem. Ver §2.5 da spec do centro de controle antes de mexer em `study-*`.
- Escreva sempre com `writeJsonAtomic`/`writeFileAtomic` (`fs-safe.ts`). Nunca `fs.writeFile` direto em arquivo de dados.
- `loadJson` move arquivo corrompido para `.corrupt-<ts>.json` e recupera de `.bak` ou backup diário. Erro de dados para o app em vez de sobrescrever.
- Não há versão de schema nos arquivos. Campo novo: dê default e trate a migração em `migrateSettings` (`store.ts`).
  Mudança que quebra formato antigo exige migração e teste.
- Store salva com debounce de 800 ms; `lock()` bloqueia escrita durante restore/import.
- Exportação: `format: 'agent-office-dados'`, `EXPORT_VERSION = 1`. Mudou o formato? Suba a versão e mantenha leitura da antiga.
- Claude é o único motor ativo. `engine: 'opencode'`, logs, resultados e uso correspondentes são registros históricos somente para leitura; nunca retomar/converter sem pedido explícito. Não reinstalar runtime, seletor ou consentimento OpenCode.

### Plataformas
- Checagens inline com `process.platform === 'win32' | 'darwin'`; Linux costuma ser o `else`.
- Funções puras recebem `platform`/`env` como parâmetro para serem testáveis (ex.: `claudeCandidates(env, platform, home)`).
- Módulos só Windows: `win-processes.ts`, `terminal-launch.ts`, `badge.ts`. Só macOS: `mac-jobs.ts` (somente leitura).
- Toda mudança deve funcionar nas três plataformas. Decisão nova de plataforma vira ADR em `docs/adr/NNNN-titulo.md`.

## Git, versão e release

- Commits em português, presente na 3ª pessoa, sem prefixo convencional e sem ponto final:
  `Adiciona…`, `Corrige…`, `Mostra…`. Corpo explica o porquê. Cite `AO-NN` quando houver.
- Branches: `agent/<nome>-<hash>`, `squad/<data>-<slug>`, `fix/...`. Tudo entra na `main` por PR.
- **Release automático**: push na `main` que mexe em `package.json` dispara `release.yml`. Se não existir release
  `v<version>`, ele gera instaladores e publica (após aprovação no ambiente `release`). Versão com `-` vira prerelease (canal beta).
- **Não suba a versão sem pedido explícito.** Merge de integração mantém uma versão já publicada.
  Para lançar: `npm version patch --no-git-tag-version`.
- `electron-builder.yml`: appId `dev.allef.agentoffice`, publica em `allefrodrigo/agent-office`. Windows: NSIS x64.

## Ao terminar uma mudança

1. Rode a checagem de "Antes de entregar" e formate só os arquivos tocados.
2. Mudou texto/cor de UI: `npm run contrast -- --check`. Mudou o mundo 2D: `__leakTest()`.
3. Mudou comportamento por plataforma: pense em macOS, Windows e Linux; registre ADR se for decisão.
4. Mudou algo descrito aqui ou em `docs/agents/`: atualize o arquivo.

## Agent skills

- Specs e tickets: GitHub Issues de `malu-code42/agent-office`, via `gh`. PRs não são triagem. Ver `docs/agents/issue-tracker.md`.
- Rótulos: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. Ver `docs/agents/triage-labels.md`.
- Contexto: `GLOSSARY.md` e ADRs relevantes em `docs/adr/`. Ver `docs/agents/domain.md`.
