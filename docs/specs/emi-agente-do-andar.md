# Spec técnica: Emi, a agente de cada andar

**Data:** 2026-10-30
**Status:** implementada na branch `agent/emi-em-cada-andar` (PR aberta, sem merge).
**Pedido:** "ao criar um andar ele já tenha a Emi e através dela eu possa fazer todo o processo das skills do Matt Pocock e ela crie os squads ajustados para o andar", e deixar mais claras as configurações de andares por projeto.

## Antes

A Emi era só uma persona dentro de janelas: o "Fluxo do projeto" (`project-workflow.ts`) pedia rascunhos de grill, spec, tickets e redistribuição numa chamada de um turno (`project-workflow-claude.ts`), e o "Criar squad" (`create-squad.ts`) montava a equipe num formulário. Não havia conversa nem sessão; tudo passava por popups.

## Depois

| Ponto | Como fica |
| --- | --- |
| Quem | Cada andar de projeto tem uma Emi residente: `builtIn: 'emi'`, id estável `agent-office:emi:<id do andar>` (`src/shared/emi.ts`). |
| Ciclo de vida | `AgentBase.relocate()` (chamado ao salvar andares e ao abrir o app) cria a Emi de cada andar novo, a remove junto com o andar e reinicia a sessão se o andar mudar de pasta. Emi de andar apagado com o app fechado não é recarregada. Não é dispensável (`fire` recusa). |
| Vagas | Não conta no limite de contratação (`countsAsRegular` já exclui `builtIn`), não ocupa mesa (`desk: -1`) nem aparece no mapa. No elenco aparece só a Emi do andar atual (ou uma que esteja esperando você). |
| Conversa | Sessão normal (`run()` → `query()`), `cwd` = pasta do andar, `permissionMode: 'default'` fixo. Plugins e skills do Claude Code (incl. Matt Pocock, #108) carregam como em qualquer agente. |
| Prompt | `emiPrompt()` (`src/main/emi-prompt.ts`), em inglês: grill → PRD/spec → tickets (`mcp__office__ticket_create`) → aprovar o plano → squads ajustados aos tickets e à stack. |
| Ferramentas | Quadro (`mcp__office__`) + `mcp__emi__` (`src/main/emi-tools.ts`): `squads_list`, `plan_get`, `plan_approve`, `squad_create`. |
| Escrita | `plan_approve` grava grill, spec, critérios e tickets no `ProjectWorkflowStore` pelos mesmos passos da janela "Fluxo do projeto". `squad_create` chama `SquadCreation.propose({ members })` + `approve()`: mesma validação, mesmos arquivos e mesma atribuição de tickets do "Criar squad". O esquema dos membros é o mesmo (`squadMemberSchema`). |
| Cartões | Leituras rodam direto. `plan_approve` e `squad_create` sempre vão ao cartão, em qualquer modo, sem "sempre permitir"; o cartão mostra o plano inteiro ou a equipe exata (membros, papéis, modelos, conta). |
| Leitura | Política normal do Office na pasta do andar. |
| Entrada na interface | Criar andar abre a conversa com a Emi. Clicar numa sala vazia abre a conversa com ela; o formulário "Criar squad" só abre para uma proposta já em andamento. |
| Configurações | Cada andar virou três grupos (`fieldset`/`legend`): Projeto (nome, pasta, squads, Emi), Permissões (modo com explicação, "Sempre permitir" com exemplos, "Importar regras do Claude Code") e Aparência (logo, cor, farda). |

## Fora desta entrega

- As janelas "Fluxo do projeto" e "Criar squad" continuam no código, sem mudança de comportamento; removê-las fica para depois de validar a Emi no uso real.
- Redistribuir tickets entre squads pelo chat (`redistribution`) segue só na janela.
- A Emi não aparece como personagem no mapa do andar.

## Verificação

- `test/emi-tools.test.ts`: plano e squad pelo caminho real (stores, writer, quadro); sem plano aprovado ou equipe inválida nada é escrito e a sala fica livre; ticket desconhecido ou de outro andar recusado; só duas ferramentas pedem cartão, que mostra a equipe exata.
- `test/emi-permissions.test.ts`: leituras do `mcp__emi__` direto; cartão para aprovar/criar com entrada exata e sem "sempre permitir", inclusive em andar automático; leitura no andar direto, fora e escrita no cartão.
- `test/emi-manager.test.ts`: uma Emi por andar sem gastar vaga e não dispensável; sessão na pasta do andar com prompt e servidor `emi`; andar novo cria, andar removido leva a Emi, também depois de reabrir.

## Pendente de validação manual

Conversa real com a conta Claude passando pelas skills do Matt Pocock até criar um squad, os cartões de plano e squad, e a tela de Configurações nas três plataformas.
