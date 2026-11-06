# Conta do andar (AO-94)

## Fluxo da troca de conta

1. Ajustes > Contas do Claude, "Quem usa cada conta": `poolRow` em `src/renderer/src/ui/accounts.ts` chama `window.office.setAccountPool(floorId, ids)`.
2. `office:setAccountPool` (`src/main/ipc/accounts.ts`) valida com `cleanAccountIds` e grava em `store.settings`: `projects[].accounts` (andar) ou `defaultAccounts` (térreo). Depois faz `broadcast({ type: 'settings' })`. Não há cópia da escolha em outro lugar.
3. `Accounts` (`src/main/accounts.ts`) lê `store.settings` ao vivo. `poolFor(agent)` chama `accountPool` (`src/shared/accounts.ts`): contas marcadas à mão no agente (`summary.accounts`), senão as do andar da pasta (`projectFor(...).accounts`), senão `defaultAccounts`, senão `main`.
4. `Accounts.pick`/`next` escolhem a conta da próxima partida: ficam na conta atual do agente (`summary.account`) enquanto ela estiver no conjunto e com espaço, senão a menos usada nas 5 h.
5. `AgentManager.startQuery` (`src/main/agents/sdk.ts`) resolve a conta a cada partida e passa `accountEnv(account)` (define `CLAUDE_CONFIG_DIR`) ao `query()`. Vale para agentes contratados (`hire`, usado pelos tickets), Emi (`sendMessage`) e orquestradores de squad (`runSquad` em `agents/office.ts`; os membros são subagentes do mesmo processo).
6. Usos fora desse caminho: Emi do fluxo de projeto (`project-workflow-claude.ts`, rascunhos EGM) e Tutor/cartões de estudo (`ipc/tasks.ts`, `study-*-claude.ts`).

## Causa

Dois pontos ignoravam a escolha do andar:

- Principal: o orquestrador de um squad é um só por squad e é reaproveitado em todo ciclo (`runSquad`, ramo `same`). `startQuery` mantém um squad sempre na conta guardada em `summary.account` (`squad && s.account`, regra "ciclo fixo numa conta"), e nada soltava essa conta quando começava um ciclo novo. Quem rodou o squad no Pex continuou no Pex para sempre, e como o ciclo de ticket de squad (`index.ts`) também passa por `runSquad`, o mesmo valeu para ele. Gravação e leitura da escolha estavam corretas.
- Secundário: `claudeProjectWorkflowGenerator` (rascunhos da Emi no fluxo de projeto) usava sempre `mainAccount()`, sem olhar o andar.

Agentes contratados e a Emi já respeitavam a troca: `next` só mantém a conta atual se ela ainda estiver no conjunto do andar.

## Decisão sobre ciclos em andamento

Uma partida em andamento nunca troca de conta, e as mensagens dentro do mesmo ciclo do squad continuam na conta guardada (prompt cache, cota pausada). A conta nova vale a partir do próximo `runSquad`, que solta a conta guardada se ela saiu do conjunto do andar. Se a conta antiga continua marcada no andar, o ciclo segue nela. A tela de Contas avisa disso.

Teste: `test/floor-account-change.test.ts`.
