# Spec técnica: Luna como agente comum (#101)

**Data:** 2026-10-30
**Status:** proposta para aprovação da usuária, implementada na branch `agent/ticket101-luna-agente-comum` (PR aberta, sem merge).
**Base de produto:** `centro-de-controle-da-vida-design.md` §2.1 e §2.7, decisões de 2026-10-29.

## Antes

Texto para a Luna passava por `LunaChat` → `IrisDesk` → `claudeIrisInterpreter`: uma chamada `query()` de um turno, `tools: []`, resposta forçada em JSON (`IrisAnswer`) e nenhuma sessão. Cada operação virava proposta na caixa de entrada.

## Depois

| Ponto | Como fica |
| --- | --- |
| Conversa | Texto segue o caminho normal (`AgentOffice.sendMessage` → `run()` → `query()`), com `sessionId`/`resume` como qualquer agente. Compactar e limpar passam a valer para ela. |
| Pasta | `cwd` = vault configurado; sem vault, a pasta de dados do Office. `additionalDirectories` = andares de projeto. |
| Prompt | `LUNA_PROMPT` (`src/main/luna-prompt.ts`) no lugar do texto de agente de código. |
| Modo | `permissionMode: 'default'` (antes `plan`). Sem bypass. |
| Ferramentas | Ferramentas comuns do Claude Code + quadro (`mcp__office__`) + `mcp__casa__` (`src/main/luna-tools.ts`): `tasks_list`, `task_create`, `task_move`, `task_reschedule`, `task_complete`, `task_discard`, `agenda_list`, `agenda_add`, `agenda_remove`, `agent_call`. |
| Escrita | `mcp__casa__` usa os mesmos writers do quadro Tarefas (`registerTasksIpc`): concluir e descartar compartilham a mesma rotina (arquivo, foco, rotina vinculada). |
| Execução direta | Ferramentas da casa rodam sem cartão (`askPlayer`), exceto `task_discard` e `agenda_remove`, que vão ao cartão de permissão com a entrada exata. |
| Leitura ampla | `Read`/`Grep`/`Glob` passam sem cartão quando a política do Office permitiria naquela pasta, para o vault e para cada andar. Arquivo sensível, busca larga e fora das pastas continuam pedindo. |
| Projetos | Edit/Write/Bash seguem a política e os cartões como qualquer agente. Commit, push e merge não têm atalho. |
| Convocar agentes | `agent_call` → `cleanHire` + `hire({ homeResident: true })`: o agente vem à Casa, trabalha e fica por perto (#105). |
| Áudio | Anexo de áudio continua no fluxo local existente (`LunaChat`/`AudioCaptureWorkflow`). |
| Popups | Nenhuma nova. Revisar/Planejar continuam como estavam. |

## Fora desta entrega

- Objetivos, rotinas e mídias: só leitura (pelo `Read` no vault). Escrever neles fica para um próximo ticket, com writers próprios.
- `IrisDesk`/`claudeIrisInterpreter` ficam no código para o fluxo de áudio; remover o que sobrar depois.
- Telegram (#55) removido por decisão da usuária em 2026-10-30.

## Verificação

- `test/luna-tools.test.ts`: leitura sem escrita, criar, reagendar, concluir/descartar pela rotina compartilhada, agenda, convocar agente, falha sem gravar, só duas ferramentas pedem cartão.
- `test/luna-permissions.test.ts`: casa direto e cartão no descarte com entrada exata; leitura no vault e no andar sem cartão; fora e escrita no cartão.
- `test/agent-cap-manager.test.ts`: sessão normal com `cwd`, modo, prompt e servidor `casa`; retomada da mesma sessão; áudio no fluxo local; Luna não é dispensada.

## Pendente de validação manual

Conversa real com a conta Claude (continuidade, perguntas, notificações), o painel da Luna (compactar/limpar) e as três plataformas.
