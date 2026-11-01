# Receitas

Passo a passo para mudanças recorrentes. Leia a seção que corresponde à tarefa.

## Novo canal IPC (exemplo real: `office:saveMarkdown`)
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

## Novo modal (modelo: `src/renderer/src/ui/modals/new-floor.ts`)
1. `ui/modals/foo.ts` exporta `openFoo(root, state, toast, …)` que retorna `Promise`.
2. Monte com `h()` e `field(label, control, hint)` de `modals/common.ts`.
3. `finish(v)` de disparo único (flag `done`): `el.remove()`, cancela `state.onChange` se assinou, `resolve(v)`.
4. `el = modal(title, body, botões, () => finish(null))` — já cuida de Esc, backdrop e a11y (`modalA11y`).
5. `root.append(el)` e foque o primeiro controle. Erros: `toast(cleanError(err), 'err')`.
6. Exporte em `modals/index.ts` e ligue em `main.ts` por um hook.
7. CSS em `styles/modals.css` ou arquivo novo com `@import` em `styles/index.css` (a ordem dos imports é a ordem da cascata).

## Mudanças no mundo 2D
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

## UI e acessibilidade
- Tema escuro só. Cores vêm de tokens em `styles/tokens.css`. Cor nova de texto: rode `npm run contrast`.
  Botões usam `--accent-solid` (`--accent` não passa contraste com branco).
- Classes CSS em kebab-case com prefixo do componente.
- Re-render é reconstruir e trocar, dentro de `keepFocus(container, draw)`.
- Listas navegáveis: `arrowList`/`rove` de `ui/a11y.ts`. Anúncios: `announce(texto)`. Atalhos globais respeitam `isTyping()`.
- Quem assina `state.onChange` precisa chamar o unsubscribe ao fechar.
- Respeite movimento reduzido via `game.setReducedEffects`.

## Testes
- Vitest, ambiente Node. `electron` é mockado por `test/mocks/electron.ts` (userData em pasta temporária por arquivo).
- Lógica nova não trivial ganha teste em `test/<modulo>.test.ts`.
- Módulos puros evitam importar Electron para serem testáveis (`fs-safe.ts`, `backups.ts`, `claude-path.ts`).
- No renderer, só código sem DOM é testado (`world2d/pathfinding.ts`, `ui/tour-plan.ts`, `ui/os-text.ts`, `ui/a11y.ts`).
  Para testar outro arquivo do renderer, inclua-o em `tsconfig.test.json`.
- Cobertura mínima de 70% de linhas nos módulos listados em `vitest.config.ts`.
- Timeout de 20 s porque testes de git são lentos no Windows.
