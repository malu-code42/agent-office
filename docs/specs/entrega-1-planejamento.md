# Entrega 1 — Planejamento pessoal

> **HISTORICAL / SUPERSEDED WHERE CONFLICTING (2026-10-21).** Preserve this earlier product/planning record. The approved `centro-de-controle-da-vida-design.md` and plan now define personal-life scope and phase order. Do not treat the old ticket-01 authorization or delivery sequence as current authorization; external issues/PRs are unchanged.

**Status:** planejamento histórico, supersedido onde conflita com o plano aprovado de 2026-10-21. A autorização do ticket 01 em 2026-10-16 não é autorização atual para executar fases ou tickets, fazer merge, push, publicação ou release.
**Fontes:** [estado consolidado](../prd/hera-integracao-consolidado.md) (seções 3, 4, 7, 10, 12 e 13) e [registro de descoberta](../prd/hera-integracao-descoberta.md).
**Tracker:** o Agent Office não tem tracker configurado; esta spec é publicada como arquivo, sem label `ready-for-agent`.

## Problem Statement

A usuária organiza tarefas pessoais em um arquivo Markdown do Obsidian (`tarefas.md`) e não tem, no Office, um lugar para escolher o foco do dia, revisar as tarefas ao começar o dia, acompanhar a agenda e registrar conclusões sem perder a organização que já usa no Obsidian.

Hoje o Office só trata trabalho de agentes. Os compromissos pessoais, o foco persistente e a revisão diária não existem no aplicativo. Se a usuária passar a usar o Office para isso, o arquivo canônico precisa continuar legível e editável no Obsidian, sem cópias divergentes.

## Solution

Uma primeira entrega com três partes:

1. **Tarefas no Office, arquivo no vault.** O `tarefas.md` continua sendo a fonte canônica. O Office lê, mostra no quadro Tarefas e escreve de volta apenas as linhas que muda. Concluir, reabrir e descartar movem a linha para a seção "Archive" com data e ID.
2. **Foco, timer e revisão diária.** Tarefas em foco ficam num popup de uma coluna, persistem entre dias e não são concluídas automaticamente. A secretária Íris oferece a revisão na primeira abertura do dia. A revisão é procedural, sem IA: a usuária passa por quatro passos e confirma as mudanças de uma vez.
3. **Agenda e pedidos à Íris.** A agenda é um arquivo no vault, editável no Obsidian e pela Íris, nos dois sentidos. A Íris usa IA para interpretar pedidos em linguagem natural e sempre propõe a mudança exata, que só é aplicada após confirmação. Propostas pendentes aparecem na caixa de entrada.

## User Stories

### A. Tarefas e vault

1. Como usuária, quero que o Office leia as listas de `tarefas.md` como colunas do quadro Tarefas, para ver minhas tarefas sem abrir o Obsidian.
2. Como usuária, quero que cada tarefa tenha um identificador invisível no fim da linha, para que o Office a reconheça mesmo que eu renomeie o título.
3. Como usuária, quero que o Office preserve o conteúdo do arquivo que não é tarefa (títulos, texto livre, frontmatter e o bloco de configuração do Kanban), para não estragar meu trabalho no Obsidian.
4. Como usuária, quero que uma edição feita por mim no Obsidian apareça no Office na próxima vez que eu abrir o quadro ou a revisão, para que o Office não mostre dados antigos.
5. Como usuária, quero criar uma tarefa manualmente no quadro, sem IA, escolhendo a lista de destino, para registrar algo novo rapidamente.
6. Como usuária, quero que uma tarefa criada no Office vá para a lista correspondente ao campo "lista" da coluna, sem precisar escrever o caminho do arquivo.
7. Como usuária, quero que o Office não crie linhas em seções que não são listas de tarefas (como "Archive" ou o bloco de configuração), para não bagunçar a estrutura.
8. Como usuária, quero ver a data programada (📅) de cada tarefa no cartão, para saber quando ela está prevista.
9. Como usuária, quero que uma tarefa sem data programada continue válida, para não ser obrigada a definir prazo em tudo.
10. Como usuária, quero que linhas que o Office não entende fiquem intactas e apareçam como avisos, para que nenhuma informação seja descartada em silêncio.

### B. Movimentação no quadro

11. Como usuária, quero mover tarefas entre listas arrastando os cartões do kanban, para reorganizar meu planejamento visualmente.
12. Como usuária, quero uma alternativa por teclado aos cartões do kanban para mover uma tarefa entre listas, para usar o quadro sem mouse.
13. Como usuária, quero que mover uma tarefa só seja possível pelos cartões do kanban, sem outros atalhos de mudança de lista em outras visões, para manter as movimentações previsíveis.
14. Como usuária, quero que mover um cartão reescreva apenas a linha daquela tarefa, para não alterar nenhuma outra linha do arquivo.

### C. Tarefas em foco

15. Como usuária, quero marcar uma tarefa como em foco a partir do quadro ou do popup, para escolher o que merece atenção agora.
16. Como usuária, quero ver as tarefas em foco num popup com uma única coluna, uma abaixo da outra, para acompanhar a lista sem colunas de status.
17. Como usuária, quero que o foco continue no dia seguinte, para não precisar refazer a seleção todos os dias.
18. Como usuária, quero tirar uma tarefa do foco sem concluí-la, para mudar de prioridade sem registrar uma conclusão.
19. Como usuária, quero definir um "passo de hoje" opcional numa tarefa em foco, para registrar o avanço que pretendo fazer hoje sem duplicar a tarefa.
20. Como usuária, quero que o passo de hoje não seja obrigatório nem vire a conclusão da tarefa, para que não tomar um passo não gere pendência.
21. Como usuária, quero que o popup mostre a tarefa, a lista de origem e a data programada quando houver, para reconhecer cada item rapidamente.
22. Como usuária, quero que o popup de foco mostre um estado vazio com um botão para abrir o quadro Tarefas, para ter um caminho claro quando não houver foco.

### D. Conclusão, reabertura e descarte

23. Como usuária, quero marcar uma tarefa em foco como concluída com uma caixa de marcação, para registrar que terminei.
24. Como usuária, quero que só eu possa concluir uma tarefa, para que a Íris e os agentes nunca concluam nada por mim.
25. Como usuária, quero que a conclusão grave a data no arquivo, visível no Obsidian, para que o registro fique no meu próprio documento.
26. Como usuária, quero que uma tarefa concluída saia da lista de origem e vá para "Archive", com a data e o mesmo identificador, para manter o quadro limpo sem apagar o histórico.
27. Como usuária, quero ver concluídas no quadro Tarefas com uma marca visual, para conferir o que já terminei.
28. Como usuária, quero desfazer uma conclusão logo após marcá-la, para corrigir um clique acidental.
29. Como usuária, quero reabrir uma tarefa do Archive, para que ela volte à lista de origem.
30. Como usuária, quero que descartar uma tarefa a mande para "Archive" com a marca de descartada e o motivo, para diferenciar descarte de conclusão.
31. Como usuária, quero que descartar exija um motivo, para que o histórico tenha sentido depois.

### E. Revisão diária (procedural)

32. Como usuária, quero que a revisão apareça na primeira abertura do app no dia, para começar o dia com as tarefas em ordem.
33. Como usuária, quero escolher Começar, Adiar por dias ou Dispensar hoje, para decidir quando revisar.
34. Como usuária, quero que Esc dispense a revisão de hoje, para fechar sem decidir nada.
35. Como usuária, quero que adiar por 1, 2, 3 dias ou 1 semana suspenda a oferta automática até a data, para não ser interrompida nos dias em que não quero revisar.
36. Como usuária, quero que a revisão continue acessível manualmente pelo quadro de parede durante o adiamento, para revisar quando eu quiser.
37. Como usuária, quero que a revisão tenha quatro passos (Agenda, Foco, Estudos e andares, Confirmar), com a orientação "o que fazer agora" em cada um, para saber onde estou.
38. Como usuária, quero que o passo Foco me deixe continuar, reagendar, revisar ou descartar cada tarefa, para decidir o destino de cada uma.
39. Como usuária, quero que Reagendar ofereça Amanhã, Em 3 dias e Próxima semana, para mudar a data sem digitar.
40. Como usuária, quero ver uma sugestão da Íris para tarefas sem avanço há muitos dias, com "Pôr em foco" ou "Deixar como está", para não esquecer tarefas paradas.
41. Como usuária, quero que nenhuma alteração seja aplicada antes do passo Confirmar, para revisar a lista exata antes de gravar.
42. Como usuária, quero que fechar a revisão sem confirmar não aplique nenhuma mudança, para poder sair sem consequências.
43. Como usuária, quero que concluir a revisão não conclua nenhuma tarefa, para que revisar nunca seja confundido com terminar.
44. Como usuária, quero que o foco não seja limpo quando o dia virar, para manter a continuidade do meu planejamento.

### F. Agenda

45. Como usuária, quero ver a agenda do dia e da semana, lida de um arquivo no vault, para saber meus compromissos.
46. Como usuária, quero editar a agenda no Obsidian, para que as mudanças feitas lá apareçam no Office.
47. Como usuária, quero pedir à Íris para adicionar, remover ou mover compromissos e tarefas na agenda, para não precisar editar o arquivo à mão.
48. Como usuária, quero que mover uma tarefa para outro dia na agenda altere a data programada da tarefa no `tarefas.md`, para que o arquivo e a agenda não divirjam.
49. Como usuária, quero que compromissos sem tarefa vinculada possam existir na agenda, para registrar reuniões e blocos fora das tarefas.

### G. Íris e pedidos em linguagem natural

50. Como usuária, quero escrever um pedido em linguagem natural à Íris, como "reserve amanhã às 15h por uma hora", para não preencher formulários.
51. Como usuária, quero que a Íris me mostre a mudança exata antes de aplicá-la, para conferir o que vai acontecer.
52. Como usuária, quero confirmar ou recusar cada proposta da Íris, para decidir sem pressa.
53. Como usuária, quero que a Íris me pergunte quando um pedido é ambíguo, por exemplo "a reunião de amanhã" com duas reuniões, para não escolher por mim.
54. Como usuária, quero que a Íris nunca conclua tarefas, para que concluir continue sendo uma decisão minha.
55. Como usuária, quero ver quais dados a Íris recebe para responder ao meu pedido, para saber o que sai do computador.
56. Como usuária, quero que a Íris só veja as tarefas e compromissos necessários ao pedido, para não enviar todo o arquivo a cada conversa.

### H. Caixa de entrada

57. Como usuária, quero ver as propostas pendentes na caixa de entrada, como as das revisões e as da Íris, para não perder pedidos aguardando confirmação.
58. Como usuária, quero que a caixa de entrada mantenha seu funcionamento atual para permissões, perguntas, planos e resultados dos agentes, para não ter de reaprender.
59. Como usuária, quero abrir uma proposta a partir da caixa de entrada, para revisá-la antes de decidir.

### I. Timer

60. Como usuária, quero iniciar um timer de 25 minutos no popup de foco, para trabalhar em blocos.
61. Como usuária, quero que o timer continue ao reabrir o app se o prazo ainda não tiver passado, para não perder a contagem.
62. Como usuária, quero que uma sessão cujo prazo passou com o app fechado apareça como interrompida, com tempo não confirmado, para não ser contada como concluída.
63. Como usuária, quero confirmar o tempo realizado numa sessão interrompida, para registrar o que de fato fiz.

### J. Segurança, backup e conflitos

64. Como usuária, quero que o Office faça uma cópia datada do `tarefas.md` antes da primeira escrita de cada sessão, para poder recuperar o arquivo se algo der errado.
65. Como usuária, quero que essas cópias nunca sejam apagadas automaticamente, para ter histórico.
66. Como usuária, quero que, se o arquivo mudar no Obsidian enquanto o Office prepara uma escrita, minha versão seja preservada e a alteração do Office seja apresentada como proposta, para não perder nenhuma das duas.
67. Como usuária, quero que o Office recuse gravar linhas que não consegue interpretar, para não corromper o arquivo.
68. Como usuária, quero que exclusões feitas no Obsidian sejam respeitadas, para que o Office não recrie o que apaguei.

### K. Plataforma e acessibilidade

69. Como usuária, quero usar o Office no Windows, no macOS e no Linux com o mesmo comportamento, para não depender de uma plataforma específica.
70. Como usuária, quero navegar pelo quadro, pelo popup de foco e pela revisão apenas com o teclado, para que o app seja acessível.
71. Como usuária, quero que Esc feche popups e a revisão sem aplicar mudanças pendentes, para sair com segurança.
72. Como usuária, quero que o texto visível do app esteja em português, para que a interface seja consistente.

## Implementation Decisions

### Fonte canônica e formato da linha

- A fonte canônica é `tarefas.md`, na pasta do vault configurada em Ajustes. Não há pasta padrão embutida; o Office pede o caminho na primeira configuração e valida que o arquivo existe.
- Uma tarefa ativa é uma linha `- [ ]`, com título, data programada opcional e identificador no fim da linha, nesta ordem:

  ```
  - [ ] Revisar plano do celular 📅 2026-10-20 ^t7k2q1a
  ```

- Uma tarefa concluída fica em `## Archive`, com `- [x]`, a data de conclusão e o mesmo identificador:

  ```
  - [x] Revisar plano do celular ✅ 2026-10-16 ^t7k2q1a
  ```

- Uma tarefa descartada fica em `## Archive`, com `- [-]`, a data e o motivo:

  ```
  - [-] Ler artigo antigo ❌ 2026-10-16 — descartada: não é mais relevante ^t3m9x4b
  ```

- O identificador é `^t` seguido de seis caracteres alfanuméricos, único no arquivo. Ele fica sempre no fim da linha, para que o Obsidian o reconheça como referência de bloco.
- As datas seguem o formato do plugin Tasks do Obsidian (📅 programada, ✅ concluída).

### Formato decidido (16/10/2026)

Substitui os exemplos da seção anterior.

- Linha de tarefa: `- [ ] campos título ^tXXXXXX`, com os campos na ordem `data | hora | lista | tarefa`.
- Campo ausente não entra na linha. Sem data e sem hora: `- [ ] Estudo | Revisar plano ^t7k2q1a`.
- A hora só existe junto com a data: sem data, a hora não entra na linha (decisão da usuária em 17/10/2026).
- Data: `DD.MM.AAAA`. Hora: `HH:MM`. Lista: o nome da seção `## lista`, repetido no campo. Tarefa: o texto, sem `|`.
- A leitura reconhece data e hora pelo formato, não pela posição. Lista e tarefa são os dois últimos campos.
- Concluída (`- [x]`, em `## Archive`): `✅ DD.MM.AAAA` depois do título, antes do ID. O campo lista mantém a lista de origem, usada por reabrir.
- Descartada (`- [-]`, em `## Archive`): `❌ DD.MM.AAAA — motivo`, antes do ID.
- Subtarefas: mesmo formato, com recuo.
- Não se usa mais `📅` nem `✅` para datas programadas. O plugin Tasks deixa de ser referência.
- Datas antigas `DD.MM`, sem ano, são lidas. Na reescrita ganham o ano 2026 (decisão da usuária em 17/10/2026).
- Concluída no Archive com uma só data: essa data é a de conclusão. Concluída sem nenhuma data: converte sem o `✅`.
- Origem de concluída sem área: lista `Archive`; reabrir pede o destino (ticket 06).
- Linha com mais de um `|` depois da data e da hora: a lista é o nome da seção, e o texto inteiro vira tarefa, com `|` trocado por `·`.
- Área com mais de três palavras é parte do título.
- `<!-- ... -->` e `***` não geram aviso.
- O ID continua no fim da linha: `^t` seguido de seis caracteres alfanuméricos.

### Módulos e costuras

- **Codec do `tarefas.md`:** função pura que transforma texto em um modelo de listas e tarefas e volta ao texto. Preserva byte a byte qualquer linha que não seja tarefa reconhecida, o frontmatter e o bloco `%% kanban:settings %%`. É o módulo mais testado.
- **Codec da agenda:** mesmo princípio, para o arquivo de agenda.
- **Serviço de planejamento:** a costura principal. Expõe comandos de tarefas (criar, mover, concluir, reabrir, descartar, agendar, reagendar), foco, timer, revisão, agenda e propostas. É a única interface que a camada de IPC e a Íris usam.
- **Armazenamento interno (`planning.json`):** guarda foco, passo de hoje, timer, estado da revisão (dia da última revisão, adiamento e rascunho do dia), lista de origem das tarefas arquivadas (para reabrir) e propostas pendentes. Grava com a escrita atômica existente e entra em `DATA_FILES` para backup.
- **Intérprete de pedidos (Íris):** recebe o texto e o contexto mínimo e devolve uma proposta estruturada. Ela é validada por esquema antes de ser mostrada. Operações permitidas: agendar, remover e mover compromisso; reagendar tarefa; pôr e tirar do foco; definir passo de hoje; propor descarte. **Concluir nunca é operação permitida.** A saída da IA é tratada como não confiável.

### Proposta da Íris

- Um pedido gera uma proposta com a lista exata de operações, que aguarda confirmação. Nenhuma operação é aplicada antes da confirmação, inclusive quando o pedido é direto (C1).
- Referências ambíguas ou inexistentes geram uma pergunta, nunca uma escolha automática.
- Confirmar aplica todas as operações da proposta de forma transacional: se uma falhar, nenhuma é gravada.
- Propostas pendentes aparecem na caixa de entrada com o chip "proposta".

### Revisão diária

- A revisão é procedural. Os quatro passos e a confirmação não chamam IA.
- O gatilho é a primeira abertura do app no dia local. A data da última revisão fica em `planning.json`.
- Adiar grava a data de retorno. Dispensar grava o dia atual como revisado, sem aplicar nada.
- **Rascunho da revisão (proposta, pendente de aprovação):** escolhas feitas nos passos ficam guardadas em `planning.json` como rascunho do dia. Fechar sem confirmar mantém o rascunho até o fim do dia, mas não aplica nada. No dia seguinte, o rascunho é descartado.

### Foco e passo de hoje

- Foco é um conjunto de identificadores de tarefa, sem limite de tamanho.
- O foco não é alterado pela virada do dia.
- O passo de hoje é um texto associado a um identificador e a uma data. Não altera a tarefa nem a conclusão.

### Conclusão, reabertura e descarte

- **Concluir:** a linha sai da lista de origem, é gravada em "Archive" com `✅` e a data do dia, e o identificador é mantido. A lista de origem é registrada em `planning.json`.
- **Desfazer:** disponível por 10 segundos após a conclusão, pelo aviso na tela. Depois disso, a tarefa só pode ser reaberta.
- **Reabrir (proposta, pendente de aprovação):** a linha volta à lista de origem registrada, sem o `✅` e a data de conclusão. Se a lista de origem não existir mais, a usuária escolhe a lista de destino.
- **Descartar:** motivo obrigatório. A linha vai para "Archive" com `- [-]`, `❌` e o motivo.

### Agenda

- **Arquivo (proposta, pendente de aprovação):** `agenda.md` na pasta do vault. Compromissos por dia, sob um título de data:

  ```
  ## 2026-10-20
  - 15:00–16:00 Reunião com a equipe ^a4x8c
  - 09:00 ↦ ^t7k2q1a
  ```

- O segundo formato referencia uma tarefa pelo identificador. Mover essa linha para outro dia altera o `📅` da tarefa no `tarefas.md` (C2).
- A agenda é editável no Obsidian e pela Íris. Quando o arquivo muda no Obsidian, o Office relê antes de qualquer proposta.

### Edição concorrente

- Antes de gravar, o Office relê o arquivo e compara com a versão que usou para calcular a mudança.
- Se o conteúdo mudou, a gravação é cancelada, a versão da usuária é mantida e a mudança do Office vira uma proposta na caixa de entrada.
- Exclusões feitas no Obsidian são respeitadas: o Office não recria a linha.

### Backup

- Antes da primeira escrita em cada sessão, o Office copia o `tarefas.md` para `backups/tarefas/`, com data e hora no nome.
- Nenhuma cópia é apagada automaticamente.

### Timer

- O timer é de 25 minutos e fica no popup de foco.
- Estados: em andamento, concluído pela usuária e interrompido com tempo não confirmado.
- Ao iniciar o app, se o prazo não passou, a contagem continua. Se passou, a sessão vira interrompida e não é concluída automaticamente.
- Confirmar o tempo realizado é uma ação da usuária.

### Caixa de entrada

- Mantém o funcionamento atual: lista de pendências com retrato, nome, chip, texto e horário; navegação por setas; Esc e clique fora fecham; contador no ícone.
- Acrescenta apenas as propostas da revisão e da Íris, com chip "proposta". Clicar abre a proposta para revisão, sem aceitar ou descartar na linha.

### Quadro Tarefas

- Uma coluna por lista de `tarefas.md`. Lista sem tarefas aparece vazia, não é removida.
- Movimentação entre listas só pelos cartões do kanban, com arraste e alternativa por teclado dentro do próprio cartão.
- Concluídas aparecem com marca visual, vindas do "Archive".

### Plataforma

- Mesmo comportamento no Windows, macOS e Linux. Caminhos são tratados como caminhos do sistema.

## Testing Decisions

### O que é um bom teste aqui

Testar comportamento observável pelo serviço de planejamento e pelo codec: o que muda no arquivo, o que aparece como proposta e o que é recusado. Não testar detalhes de implementação nem a aparência dos componentes.

### Costuras e módulos testados

- **Codec do `tarefas.md`:** ler e escrever de volta sem mudança em linhas não tocadas (teste de identidade sobre um arquivo sintético com a mesma estrutura); reconhecer tarefas ativas, concluídas e descartadas; rejeitar linhas malformadas sem perda.
- **Codec da agenda:** ida e volta; referência a tarefa por identificador; linhas desconhecidas preservadas.
- **Serviço de planejamento (costura principal):**
  - concluir grava a data e move para "Archive";
  - desfazer dentro de 10 segundos restaura a linha original;
  - reabrir devolve à lista registrada e remove a data de conclusão;
  - reabrir com lista de origem inexistente pede o destino;
  - descartar sem motivo é recusado;
  - foco persiste entre dias;
  - passo de hoje não altera conclusão;
  - revisão aparece uma vez por dia, respeita adiamento e Dispensar;
  - fechar a revisão sem confirmar não grava nada;
  - confirmar aplica todas as operações ou nenhuma;
  - mover tarefa na agenda altera o `📅`;
  - timer: continua dentro do prazo, vira interrompido após o prazo e nunca conclui sozinho;
  - edição concorrente cancela a gravação e cria proposta;
  - backup é criado antes da primeira escrita e não é apagado.
- **Intérprete de pedidos:** o teste usa um intérprete de teste, rotulado como sintético, que devolve propostas fixas. Testar a validação: operação "concluir" é recusada; referência inexistente gera pergunta; saída fora do esquema é descartada. A qualidade da interpretação real não é testada automaticamente.
- **Validação de entrada:** esquemas do IPC rejeitam dados fora do formato, como o padrão já usado para entradas do renderer.

### Prior art no repositório

- `tickets.test.ts` e `tickets-load.test.ts`: comportamento de um quadro gravado em arquivo, com histórico.
- `fs-safe.test.ts`: escrita atômica e recuperação de arquivo corrompido.
- `backups.test.ts`: cópias e nomes de backup.
- `validate.test.ts`: esquemas de entrada.
- `routines.test.ts` e `schedule.test.ts`: gatilhos dependentes de tempo.
- `store.test.ts`: migração e persistência de configurações.

Os testes de arquivo usam pasta temporária por teste, como o restante do projeto. O prazo de 20 segundos por teste é mantido.

### Cobertura

Os módulos novos entram na lista de cobertura mínima de 70% de linhas, conforme `vitest.config.ts`.

## Out of Scope

- Estudos, notas, cartões, biblioteca, Cora e a sala de aula. Entram em entregas seguintes.
- Projetos, andares de trabalho, tickets, lotes, squads, diretores (incluindo Emi) e worktrees.
- Integração com Codex ou OpenCode, e qualquer escolha de motor por integrante. Registrada como possibilidade futura no ticket 14, depois dos tickets desta entrega.
- Calendário externo e sincronização com contas de nuvem.
- Tela de atividade e as rotas Hoje e Atividade do Hera.
- Escrita livre e pensamentos.
- Multiusuário e acesso remoto.
- Sincronização de arquivos entre computadores.

## Further Notes

### Pontos que precisam da sua aprovação

Estas propostas foram escritas por mim e ainda não foram aprovadas:

1. **Reabrir** volta à lista de origem registrada e remove a data de conclusão.
2. **Rascunho da revisão** fica até o fim do dia e é descartado no dia seguinte.
3. **Arquivo de agenda** é `agenda.md`, com o formato da seção "Agenda".
4. **Envio de dados à Íris:** a Íris recebe o pedido e somente as tarefas e compromissos necessários; você vê esse contexto antes do envio. Confirmar se isso atende à regra de transmissão já aprovada (Q13).
5. **Desfazer** fica disponível por 10 segundos após a conclusão.
6. **Pasta do vault** é configurada pela usuária; não há caminho padrão no código.

### Seams para confirmar

Uma costura principal, o serviço de planejamento, com o codec como módulo puro testado em separado. Sem novas costuras no IPC além das já existentes.

### Dependências

- Escrita atômica e carga de arquivo existentes em `fs-safe`.
- Backup existente, estendido com `planning.json` e a pasta `backups/tarefas/`.
- Esquemas de validação existentes em `validate`.
- Caixa de entrada e quadro de tickets existentes, estendidos.

### Ordem sugerida de implementação (depois da aprovação)

1. Codec do `tarefas.md` e testes de identidade.
2. Serviço de planejamento: tarefas, concluir, reabrir e descartar.
3. Foco e timer.
4. Quadro Tarefas e popup de foco.
5. Revisão diária sem IA.
6. Agenda e intérprete da Íris, com propostas e confirmação.
7. Caixa de entrada com propostas.
8. Verificações finais: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, e conferência do arquivo com o Obsidian.
