# Mapa do código e armadilhas

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
  fs-safe.ts, backups.ts, data.ts   persistência
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

## Armadilhas e documentos desatualizados

- **ADR 0003** cita `src/main/window-frame.ts`, que não existe. Hoje o Windows usa `titleBarStyle: 'default'` (`src/main/index.ts:54`).
- **ADR 0009** diz que os testes usam `node --test`. O projeto usa **vitest**.
- **ADR 0010** descreve instaladores x64 + arm64. O `electron-builder.yml` atual gera só x64.
- `src/main/templates.ts` tem TODO para migrar ao zod de `validate.ts`, que já existe.
- O preload precisa continuar CommonJS (`[name].cjs`) por causa do sandbox.
- `ui/os-text.ts` não importa nada de propósito (duplica os nomes de `TerminalVia`).
- `tickets-closed.json` é carregado sob demanda.
- Antes de confiar num ADR, confira o código.
