# Implementação #84 — agenda diária e rotinas com Luna

## Identificação e autorização

- **Objetivo:** implementar o workflow local de planejamento matinal, lembretes de rotinas pessoais e revisão do fim do dia via notificações/perguntas e chat normais de Luna.
- **Ticket e contrato:** GitHub issue [#84](https://github.com/malu-code42/agent-office/issues/84); snapshot local em `docs/agents/workflows/snapshots/ticket-84.json`.
- **Spec vigente:** `docs/specs/centro-de-controle-da-vida-design.md`, sincronizada da versão publicada em #38 em 2026-10-27. Fronteiras de teste: fluxos de Casa/Luna com fixtures e dados sintéticos, sem vault real.
- **Divisão aprovada:** #84 é local e sem bloqueios; #55 depende do Telegram #53/#83 e deste fluxo; não implementar #55 aqui. #58 é independente. #56 segue como protótipo visual de responsabilidade humana, mas deixou de bloquear #57, que já está fechado. #59 é verificação final. Aprovação registrada em `approval-receipts.md`.
- **Autorização de implementação:** a usuária escreveu “pode implementar” em 2026-10-27, referindo-se explicitamente ao #84. Fonte e escopo estão em `approval-receipts.md`.
- **Bloqueios:** nenhum. #83 e #47 estão fechados; confirmado no issue #84 e no tracker consultado em 2026-10-27. Não há dependências pendentes para começar.
- **Rota:** multi-delivery (projeto pai tem fases e tickets dependentes); esta entrega é exclusivamente #84.
- **Base:** `origin/main` / `bbf999e`, limpa nesta worktree nova `agent/ticket84-daily-routine`. O checkout principal está sujo e foi deixado intacto. Não havia commit recuperável específico desta implementação no início.
- **Limites:** não acessar/alterar vault real; não usar tokens/Telegram/modelo real; não implementar entrega remota do #55; não redesenhar UI/casa; não fazer merge ou release.
- **Checks descobertos:** `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`; `npm run contrast -- --check` apenas se cores/texto visual exigirem. Instal/deps não serão alteradas sem necessidade/autorização.

## Plano técnico curto e testes

- Reusar o store/estado local de planejamento e o fluxo comum de notificações/perguntas; fake clock e stores temporários nos testes.
- Testar primeiro comportamento público: preferências/configuração; composição do planejamento com agenda/aulas/tarefas/rotinas; ocorrência/decisão explícita e retry único em 30 minutos; fechamento do dia; catch-up consolidado ao reabrir; idempotência por restart/duplicação/virada do dia/fuso.
- Campos de horário ausentes/ambíguos nunca são inferidos; rotina sem hora explícita não dispara lembrete temporizado. Nenhuma resposta significa conclusão. Nenhuma gravação no vault ou alteração de tarefas sem instrução/confirmacão existentes.
- TDD: teste que falha pelo comportamento em falta → implementação mínima → teste verde por fatia.
- Revisão: diff contra `bbf999e` mais arquivos novos; critérios #84 conferidos; checks de `AGENTS.md` executados. Critério de encerramento: aceite #84 demonstrado, checks obrigatórios aprovados, P0/P1 resolvidos e P2 registrados.

## Etapas

| Etapa ou skill | Estado | Evidência ou motivo | Próxima ação |
|---|---|---|---|
| setup-matt-pocock-skills | concluída | Tracker/configuração e glossário existem na worktree documental aprovada; issue #84 e #38 consultados. | — |
| ask-matt | não aplicável | Rota multi-delivery já está estabelecida pelo projeto. | — |
| grill-with-docs / grilling | não aplicável | Não há decisão de produto aberta; ticket e decisões aprovadas definem o comportamento. | Reabrir somente se uma ambiguidade concreta bloquear aceite. |
| domain-modeling | concluída | Invariantes conferidas: definições permanecem no vault; horários, ocorrências, respostas e idempotência ficam no store local; nenhum task/vault write é inferido. | — |
| research / wayfinder / prototype | não aplicável | Ticket usa padrões internos; nenhum fato externo ou protótipo requerido. | — |
| to-spec / to-tickets | concluídas | #38 publicado, fronteiras confirmadas; divisão aprovada, #84 existente e sem bloqueios. | — |
| implement / TDD | concluída | Lacunas da revisão corrigidas: validação Zod, captura de vários dias, prioridades refletidas no fechamento, retry após restart e fuso/DST. Typecheck, build, lint direto e 74 testes focados passam. | — |
| code-review | concluída | Revisão independente final GPT-6 Luna: APPROVED, sem achados concretos. | — |
| pr / commit | autorizado | A usuária autorizou seguir tickets sem gates humanos e abrir PR ao fim de cada ticket; sem merge. | Commit e PR de #84; reavaliar tickets prontos depois. |
| retro | concluída | Worktree isolada preservou o checkout principal. Descoberta: o `npm run lint` do projeto assume dependências instaladas localmente em cada worktree; ESLint direto via dependência do checkout principal é uma alternativa não destrutiva. Sugestão futura: resolver ESLint pelo workspace compartilhado no script, fora do escopo #84. | — |
| demais skills do mapa | não aplicável | Sem bug preexistente, triagem externa, arquitetura ampla, documentação de agentes, configuração/hooks, migração shoehorn ou exercícios. | — |

## Evidências de passagem

- Registrar hashes do spec, divisão/ticket, autorização, estado dos bloqueios e código no arquivo `workflow-gates.json`.
- Executar o verificador `check_gates.py` antes da primeira edição de código e registrar comando/resultado.
- Atualizar este registro com comandos reais, exit codes, resultados, revisão e limitações. Nenhum teste é declarado aprovado antes de execução.

## Execução local — 2026-10-27

- `python .../check_gates.py --root <worktree> --record docs/agents/workflows/workflow-gates.json`: exit 0 (`structural_checks_passed`); fontes, recorte, autorizações e bloqueios conferidos semanticamente. Repetido antes de continuar a implementação.
- TDD: `npm test -- --run test/personal-routines-store.test.ts` primeiro falhou (`dailyTimes is not a function`); após o store, passou (10 testes). `npm test -- --run test/daily-workflow.test.ts test/personal-routines-store.test.ts`: passou (14 testes).
- `npm run typecheck`: passou após os ajustes de tipos.
- `npm run build`: passou (main, preload e renderer).
- `node D:\Documents\agent-office\node_modules\eslint\bin\eslint.js src test scripts` na worktree: passou. `npm run lint` não funciona nesta worktree, pois o script resolve ESLint como `<worktree>/node_modules/eslint`, diretório ausente; nenhuma dependência foi instalada.
- Após os ajustes de revisão: `npm test -- --run test/daily-workflow.test.ts test/personal-routines-store.test.ts test/tasks-ipc.test.ts test/agenda-ipc.test.ts`: exit 0, 71 testes; `npm run typecheck`: exit 0; ESLint direto: exit 0; `npm run build`: exit 0 (main/preload/renderer).
- `npm test` completo após a correção: exit 1, 126/127 arquivos passaram; 1.880 testes passaram, 15 ignorados. Única falha: `test/delegate-archive.test.ts`, mock de `board` sem `assertCanStart` (`src/main/delegate.ts`); reproduzida isoladamente, fora do diff da tarefa. `test/squad-ipc.test.ts` passou no conjunto desta rodada.
- `npm run lint` continua indisponível nesta worktree por resolver `node_modules/eslint` dentro dela; ESLint direto em `D:\Documents\agent-office\node_modules\eslint\bin\eslint.js` passou para `src test scripts`.
- Revisão Standards: adaptação sequencial devido ao subagente receber contexto/workspace errado e reportar arquivos ausentes. Nenhuma infração dura observada nas instruções documentadas; revisão independente continua limitação explícita. Revisão Spec: independente; os quatro itens informados foram corrigidos/testados. Arquivos spec/plan já modificados continuam preservados e foram excluídos da revisão do diff da implementação.
- Após a revisão adicional: `npm run typecheck` exit 0; 74 testes focados (workflow/store/tasks/agenda IPC) passaram; ESLint direto nos arquivos tocados exit 0; `npm run build` exit 0.
- `npm test -- --run`: exit 1, 126/127 arquivos passaram; 1.883 testes passaram e 15 foram ignorados. Falha única já reproduzida antes e fora do diff: `test/delegate-archive.test.ts` usa mock de `board` sem `assertCanStart`.
- Revisão independente final GPT-6 Luna: APPROVED, sem achados concretos. As prioridades passam a constar no fechamento; horários civis inexistentes no salto DST são rejeitados; processos são marcados como tratados após o despacho.
- Não ler vault real nem usar modelo/Telegram/credenciais; nenhuma execução interativa do app foi feita. A autorização posterior da usuária cobre commit, push e abertura de PR, mas não merge.
