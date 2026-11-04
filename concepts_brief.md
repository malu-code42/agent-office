# Execução de grupos de tickets com acompanhamento

* **Autora:** Malu (decisões) · Emi (registro)
* **Data:** 2026-11-04
* **Estado:** decisões registradas. Os Goldfish ainda não revisaram este brief.

## Overview

Hoje o coordenador do squad volta à usuária várias vezes para perguntar, e ela não vê o ticket atual, o estado e os erros num só lugar. A usuária quer:

1. Agrupar tickets por objetivo (ticket-mãe com filhos).
2. Resolver todas as lacunas de um grupo antes de rodá-lo.
3. Rodar o grupo inteiro, ticket após ticket, sem perguntas, e só parar se houver erro.
4. Acompanhar tudo numa popup e aprovar PR e merge por botão ao fim.

## Fluxo desejado

1. A usuária fala com a Emi e escolhe um grupo de tickets.
2. A Emi faz um grilling ticket a ticket e escreve as respostas no próprio ticket (pré-voo). A usuária decide os pontos críticos agora.
3. A Emi cria o projeto, gera os agentes e os coloca na sala.
4. O grupo roda em cadeia. Cada ticket tem a sua branch e commits automáticos. A `main` nunca é tocada.
5. A cada ticket, os agentes começam sem contexto anterior. Ao fim do grupo, eles zeram também.
6. Se der erro, a execução trava e a usuária decide o que fazer.
7. Ao fim, a usuária vê o estado de cada ticket e decide por botão: PR e merge, o grupo de uma vez.

## Decisões

| # | Decisão |
|---|---|
| D1 | Sem perguntas durante a execução. Qualquer erro trava a execução e a usuária é consultada. |
| D2 | Reordenar vale só para tickets ainda não iniciados. |
| D3 | Commits automáticos, em branch do ticket, nunca na `main`. PR e merge só por botão da usuária. |
| D4 | Uma branch por ticket. A usuária aprova o grupo de uma vez. |
| D5 | Lacunas ficam escritas (ver "Como as lacunas ficam escritas"). Nada fica só na conversa. |
| D6 | A popup mostra, por ticket, o que ele vai fazer, além do estado, erros e processos. |
| D7 | A popup permite aprovar, pausar e reordenar, e responder ao coordenador por ela. |
| D8 | Agentes zeram o contexto a cada ticket e ao fim do grupo, para economizar tokens. |
| D9 | Rotina diária em horário fixo, executada por um agente novo. Ela só **propõe** grupos; a usuária aceita. Nunca reagrupa um grupo em execução. |
| D10 | A Emi tem um quadro de grupos por objetivo na sua sala; a usuária escolhe qual iniciar. |
| D11 | Os grupos 4 e 5 viram um só: "Andares de projeto" (AO-40, 47, 49, 50, 51, 54, 57, 58). A Emi verifica a ordem entre eles. |
| D12 | A entrega é fatiada em etapas (abaixo). |

## Como as lacunas ficam escritas

O ticket precisa se bastar, porque cada ticket começa sem contexto.

- **Seção "Decisões e lacunas resolvidas" no ticket.** A Emi escreve ali, depois do grilling, cada decisão da usuária. O agente do ticket lê isso como parte do pedido.
- **Pré-voo:** um ticket só entra no grupo quando essa seção existe e nenhuma pergunta está aberta. Sem pré-voo, o grupo não roda.
- **Ordem entre tickets:** a ordem e as dependências ficam no ticket-mãe, não na memória de ninguém.
- **Lições de erro:** quando a usuária resolve um erro, a Emi registra a decisão como comentário nos tickets que ainda não rodaram e a leva ao ticket-mãe.

## Etapas

1. **Base:** AO-59 (tickets-mãe com filhos) e o executor de grupo em cadeia, com pré-voo, travar no erro e branch por ticket. O primeiro grupo a rodar é "Andares de projeto".
2. **Popup de acompanhamento** do grupo: ticket atual, o que cada um vai fazer, estado, erros, aprovar, pausar, reordenar, responder ao coordenador, e botões de PR e merge ao fim.
3. **Quadro de grupos na sala da Emi** e a rotina diária de proposta de grupos.

## Alternativas descartadas

- Pacote inteiro numa entrega só: grande demais para validar. Fatiado.
- Reagrupar tickets de grupo em execução: bagunça a cadeia. Descartado.
- Uma branch e um PR por grupo: descartado em favor de uma branch por ticket.
- Pular o ticket com erro e seguir: descartado. O erro trava e a usuária decide.

## Em aberto

- Qual é exatamente o "quadro das fases dos projetos" onde a popup abre. Não foi localizado no código; é preciso a usuária apontar a tela.
- O horário fixo da rotina diária.
- Onde o coordenador envia hoje as perguntas, para a popup substituir esse caminho.
- Como a ordem e as dependências entre os tickets dos grupos 4 e 5 são verificadas (a Emi faz isso antes do pré-voo).
