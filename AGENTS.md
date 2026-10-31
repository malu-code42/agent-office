# AGENTS.md — guia para IAs que vão alterar o Agent Office

Leia este arquivo inteiro antes de mudar qualquer coisa. Ele resume a arquitetura, as regras da casa e as armadilhas conhecidas.
Detalhes de produto e uso: `README.md` e `COMO-RODAR.md`. Decisões de Windows: `docs/adr/` e `docs/prd/windows-primeira-classe.md`.

## O que é

App Electron (TypeScript, ESM) que mostra um escritório isométrico em pixel art (Canvas2D) onde agentes do Claude Code trabalham,
pedem permissão e entregam resultados. Os agentes rodam via `@anthropic-ai/claude-agent-sdk` usando o `claude` instalado
pelo usuário (o binário de ~220 MB do SDK é excluído do pacote). Roda em macOS, Windows 10/11 e Linux x64.

## Comandos

```sh
npm install          # se falhar com "Electron uninstall": node node_modules/electron/install.js
npm run dev          # app em modo dev
npm run demo         # escritório com agentes simulados, sem gastar tokens
npm run typecheck    # tsc em tsconfig.node, tsconfig.web e tsconfig.test
   npm run lint         # lint no checkout e em todas as worktrees Git registradas
npm test             # vitest run (test/**/*.test.ts)
npm run build        # electron-vite build
npm run contrast     # contraste WCAG das cores do HUD (--check falha abaixo de 4.5:1)
npm run bench        # stress de 30 s, grava out/bench.json
```

Antes de entregar: `npm run typecheck && npm run lint && npm test && npm run build`. É o que o CI roda (macOS e Windows, Node 22).

Variáveis úteis: `AGENT_OFFICE_DEMO=1`, `AGENT_OFFICE_TOUR=1`, `AGENT_OFFICE_FAKE_UPDATE=0.9.0`,
`AGENT_OFFICE_CLAUDE=<caminho>`, `AGENT_OFFICE_DATA_DIR=<pasta>` (troca o userData; use para não mexer nos dados reais).

## Mapa do código

```
src/main/       processo principal (Node/Electron)
  index.ts        entrada: env, log, serviços, IPC, janela
  agents/         AgentManager em cadeia de classes: base → office → sdk → rotation → subagents → decisions → index
  ipc/            um register<Area>Ipc(ctx) por área; context.ts define IpcContext
  git/            git/gh via execFile (nunca shell): worktrees, changes, publish
  routines/       rotinas agendadas (store + scheduler)
  stats/          lê ~/.claude/projects/**/*.jsonl (só disco), cache em stats.json
  store.ts        office.json (settings, agentes, resultados, ledger) + migrateSettings
  tickets.ts      quadro kanban + ferramentas MCP mcp__office__* para os agentes
  validate.ts     schemas zod de toda entrada vinda do renderer
  fs-safe.ts, backups.ts, data.ts   persistência (ver abaixo)
  bridge.ts       HTTP em 127.0.0.1 que recebe hooks de sessões de terminal
  log.ts          log em arquivo com redact()
src/preload/    index.ts expõe window.office (precisa compilar em CJS); api.d.ts só tipa
src/shared/     código puro usado por main e renderer; types/ipc.ts define OfficeAPI, OfficeState, OfficeEvent
src/renderer/   UI sem framework (DOM puro + Canvas2D)
  src/main.ts     boot, atalhos globais, loop de render
  src/state.ts    espelho observável do estado do main (apply(OfficeEvent), onChange)
  src/game/       classe Game em cadeia: base → floors → boards → actors → lounge → deliveries → subagents → squads → skull → movement → input → index
  src/world2d/    o mundo em pixel art (Canvas2D): renderer, avatar (quem anda), plan/layout/casa/estudos
                  (plantas), pathfinding, overlays (tags HTML), skins (cores do Look); ver docs/specs/motor-2d.md
  src/assets/pixel/  atlas, layout e fonte gerados por scripts/pixel-art (não edite à mão)
  src/ui/         HUD, modais, painel do agente, quadro, relatórios, rotinas, a11y
  src/styles/     um CSS por componente, importados por index.css
test/           vitest, um arquivo por módulo: test/<modulo>.test.ts
scripts/        demo, bench, contrast, dist-mac, ícone e fundo do dmg; pixel-art/ gera a arte 2D (Python + Pillow)
docs/adr/       decisões (pt-BR); docs/prd/ requisitos
mockups/        HTML estático de exploração visual (fora do lint)
```

Alias `@shared/*` → `src/shared/*` em main, preload, renderer e testes.

## Regras da casa

### Idioma
- Todo texto visível ao usuário é **pt-BR**: UI, erros, notificações, mensagens de log. Não há biblioteca de i18n.
- Prompts enviados aos agentes são em inglês.
- Comentários: inglês na maior parte, português aceito. Siga o idioma do arquivo.
- Textos que mudam por sistema operacional vão em `src/renderer/src/ui/os-text.ts` (`DARWIN`, `WIN32`, `OTHER`).

### Estilo
- Prettier: sem ponto e vírgula, aspas simples, `trailingComma: all`, `printWidth: 140`.
  O CI não roda Prettier (arquivos antigos falhariam). Formate **só os arquivos que tocar**: `npm run format -- <arquivos>`.
- ESLint: variáveis não usadas são erro; prefixe com `_` para ignorar.
- TypeScript `strict` + `noUnusedLocals`.
- Nomes: classes são substantivos (`TicketBoard`, `CostBook`), registradores `register<Area>Ipc`, validadores `*Schema` ou `clean*`.
- Classes grandes são divididas em cadeia linear de classes abstratas, uma por arquivo (agents, game, board, panel).
  Para adicionar comportamento, insira um elo na cadeia; não crie classe irmã.
- `index.ts` de pastas reexporta para manter caminhos de import antigos.
- Comentários citam tickets `AO-NN` e ADRs. Comente o porquê, não o quê. `catch {}` vazio precisa de comentário explicando.

### Segurança (não negociável)
- O renderer é **não confiável**. Todo handler IPC recebe `unknown` e valida com zod em `validate.ts`.
- Janela com `sandbox`, `contextIsolation`, navegação e `window.open` bloqueados. CSP estrita em `index.html`. Não afrouxe.
- Processos externos: `execFile`/`spawn` com array de argumentos, **nunca** shell (ver `git/run.ts`, ADR 0006).
- Markdown de agentes passa por `ui/markdown.ts` (marked + DOMPurify; HTML cru escapado, imagens não carregam,
  links abrem via `openExternal` só http/https). Não use `innerHTML` com conteúdo vindo de agente ou usuário.
- No DOM, use `h()` de `ui/dom.ts`: filhos string viram nós de texto.
- Logs: nunca registre prompts, mensagens ou input de ferramentas. Tudo passa por `redact()`.
- O bridge escuta só em 127.0.0.1, exige token e rejeita `Origin`.
- O bridge faz backup de `~/.claude/settings.json` e preserva hooks do usuário. Mantenha isso.

### Dados do usuário
- Ficam em `app.getPath('userData')`: `office.json`, tickets, `routines.json`, `planning.json`, `timer.json`,
  `personal-routines.json` e `study-cycle.json` (lista em `DATA_FILES` de `backups.ts`), além de `stats.json`,
  `bridge-token`, `logs/`, `backups/` e `study-pdf-cache/` (texto das páginas dos PDFs da Cora, por caminho+mtime+tamanho;
  lido num worker thread, nunca enviado a modelos).
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

## Receitas

### Novo canal IPC (exemplo real: `office:saveMarkdown`)
1. Método com JSDoc em `OfficeAPI` (`src/shared/types/ipc.ts`).
2. Schema em `src/main/validate.ts` (vários argumentos: `z.tuple([...])`).
3. Handler em `src/main/ipc/<area>.ts`:
   `ipcMain.handle('office:x', async (_e, ...args: unknown[]) => { const [a, b] = parse(xArgsSchema, args, 'Mensagem pt-BR'); ... })`.
   Dependências vêm de `ctx`. Serviço novo: adicione a `IpcContext` e ligue em `index.ts`. Arquivo de área novo: chame o `register*` em `index.ts`.
4. Entrada no mapa `api` de `src/preload/index.ts` (`ipcRenderer.invoke('office:x', ...)`). O tipo `OfficeAPI` obriga.
5. Dado empurrado do main: variante nova em `OfficeEvent` + `broadcast`; trate em `state.apply` no renderer.
   Se precisa estar no estado inicial, adicione a `OfficeState` e ao handler `office:getState`.
6. Teste em `test/validate.test.ts`.
Erros para o usuário: `throw new Error('<pt-BR>')`, que o renderer mostra.

### Novo modal (modelo: `src/renderer/src/ui/modals/new-floor.ts`)
1. `ui/modals/foo.ts` exporta `openFoo(root, state, toast, …)` que retorna `Promise`.
2. Monte com `h()` e `field(label, control, hint)` de `modals/common.ts`.
3. `finish(v)` de disparo único (flag `done`): `el.remove()`, cancela `state.onChange` se assinou, `resolve(v)`.
4. `el = modal(title, body, botões, () => finish(null))` — já cuida de Esc, backdrop e a11y (`modalA11y`).
5. `root.append(el)` e foque o primeiro controle. Erros: `toast(cleanError(err), 'err')`.
6. Exporte em `modals/index.ts` e ligue em `main.ts` por um hook.
7. CSS em `styles/modals.css` ou arquivo novo com `@import` em `styles/index.css` (a ordem dos imports é a ordem da cascata).

### Mudanças no mundo 2D
- A arte vem de `scripts/pixel-art` (Python + Pillow): mudou sprite ou planta, rode `export_app.py` e faça o commit dos
  arquivos gerados em `src/assets/pixel/`. Não edite `atlas.png`/`*.json` à mão.
- O renderer desenha sob demanda: só os retângulos de quem mudou (pessoas, extras como portas, cordões, efeitos).
  Animação nova entra no `sig` da pessoa/extra; o que não muda não redesenha.
- Animação dirigida pelo `update(dt)` (tempo do jogo), nunca por `requestAnimationFrame` próprio nem só por `setTimeout`:
  a janela oculta (capturas, bench) quase não roda rAF.
- Depois de input/evento, chame `game.wake()`/`wakeUntil`, senão o loop fica no tick lento.
- `update(dt)` só move; `draw(dt)` só desenha.
- Valide vazamentos com `await __leakTest()` no console em dev (canvases, KB de pixels, tags, heap). Performance: F3 ou
  `?perf`, e `npm run bench`.

### UI e acessibilidade
- Tema escuro só. Cores vêm de tokens em `styles/tokens.css`. Cor nova de texto: rode `npm run contrast`.
  Botões usam `--accent-solid` (`--accent` não passa contraste com branco).
- Classes CSS em kebab-case com prefixo do componente.
- Re-render é reconstruir e trocar, dentro de `keepFocus(container, draw)`.
- Listas navegáveis: `arrowList`/`rove` de `ui/a11y.ts`. Anúncios: `announce(texto)`. Atalhos globais respeitam `isTyping()`.
- Quem assina `state.onChange` precisa chamar o unsubscribe ao fechar.
- Respeite movimento reduzido via `game.setReducedEffects`.

### Testes
- Vitest, ambiente Node. `electron` é mockado por `test/mocks/electron.ts` (userData em pasta temporária por arquivo).
- Lógica nova não trivial ganha teste em `test/<modulo>.test.ts`.
- Módulos puros evitam importar Electron para serem testáveis (`fs-safe.ts`, `backups.ts`, `claude-path.ts`).
- No renderer, só código sem DOM é testado (`world2d/pathfinding.ts`, `ui/tour-plan.ts`, `ui/os-text.ts`, `ui/a11y.ts`).
  Para testar outro arquivo do renderer, inclua-o em `tsconfig.test.json`.
- Cobertura mínima de 70% de linhas nos módulos listados em `vitest.config.ts`.
- Timeout de 20 s porque testes de git são lentos no Windows.

## Git, versão e release

- Commits em português, presente na 3ª pessoa, sem prefixo convencional e sem ponto final:
  `Adiciona…`, `Corrige…`, `Mostra…`. Corpo explica o porquê. Cite `AO-NN` quando houver.
- Branches: `agent/<nome>-<hash>`, `squad/<data>-<slug>`, `fix/...`. Tudo entra na `main` por PR.
- **Release automático**: push na `main` que mexe em `package.json` dispara `release.yml`. Se não existir release
  `v<version>`, ele gera instaladores e publica (após aprovação no ambiente `release`). Versão com `-` vira prerelease (canal beta).
- **Não suba a versão sem pedido explícito.** Merge de integração mantém uma versão já publicada
  (ex.: commit `875fa24` voltou para `0.3.6-beta.2`). Para lançar: `npm version patch --no-git-tag-version`.
- `electron-builder.yml`: appId `dev.allef.agentoffice`, publica em `allefrodrigo/agent-office`. Windows: NSIS x64.

## Armadilhas e documentos desatualizados

- **ADR 0003** cita `src/main/window-frame.ts`, que não existe. Hoje o Windows usa `titleBarStyle: 'default'` (`src/main/index.ts:54`).
- **ADR 0009** diz que os testes usam `node --test`. O projeto usa **vitest**.
- **ADR 0010** descreve instaladores x64 + arm64. O `electron-builder.yml` atual gera só x64.
- `src/main/templates.ts` tem TODO para migrar ao zod de `validate.ts`, que já existe.
- O preload precisa continuar CommonJS (`[name].cjs`) por causa do sandbox.
- `ui/os-text.ts` não importa nada de propósito (duplica os nomes de `TerminalVia`).
- `tickets-closed.json` é carregado sob demanda.
- Antes de confiar num ADR, confira o código.

## Ao terminar uma mudança

1. `npm run typecheck && npm run lint && npm test && npm run build`.
2. Formate só os arquivos tocados.
3. Mudou texto/cor de UI: `npm run contrast -- --check`. Mudou o mundo 2D: `__leakTest()`.
4. Mudou comportamento por plataforma: pense em macOS, Windows e Linux; registre ADR se for decisão.
5. Mudou algo descrito aqui: atualize este arquivo.

## Agent skills

### Issue tracker

Specs e tickets vivem em GitHub Issues de `malu-code42/agent-office`; use `gh`. PRs não são superfície de triagem. Veja `docs/agents/issue-tracker.md`.

### Triage labels

Use os rótulos padrão `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human` e `wontfix`. Veja `docs/agents/triage-labels.md`.

### Domain docs

Repositório de contexto único: leia `GLOSSARY.md` e ADRs relevantes em `docs/adr/`. Veja `docs/agents/domain.md`.
