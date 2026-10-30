# Spec: Luna, tarefas e mídias

**Data:** 2026-10-28  
**Base:** `origin/main` em `1f4dd84` (PR #98 integrada)  
**Status:** lote de tarefas/mídias aprovado; desenho antigo da Luna foi supersedido pela autorização conversacional de 2026-10-29 em `centro-de-controle-da-vida-design.md` e ticket #101. Reconciliar a parte Luna antes de integrar a PR #100.

## Objetivo

Corrigir os fluxos de assistência diária, tarefas em foco e acesso à biblioteca de mídias, preservando os padrões visuais e de segurança do Agent Office. O trabalho será entregue em três partes: Luna, tarefas e mídias.

## Decisões confirmadas

- **Atualização 2026-10-29:** Luna é assistente pessoal o mais próxima possível de um agente comum: chat normal, mesmas ferramentas dos demais agentes, sem popups novas. Tem leitura ampla do vault pessoal configurado, dados pessoais do Office, memórias disponíveis e projetos/worktrees registrados, sem aprovação por consulta. Ajuda com agenda, objetivos, rotinas e tarefas paradas/abandonadas.
- Pedidos claros de organização são executados diretamente; ambiguidade gera pergunta; exclusões/descartes exigem confirmação explícita.
- Leitura ampla não remove sandbox, permissões, validação IPC, proteção de segredos ou gates de publicação. Fontes externas precisam ser conectadas pela usuária; credenciais e segredos nunca são enviados ao modelo.
- As popups já existentes descritas abaixo não são caminho obrigatório: tudo o que fazem também precisa funcionar pelo chat normal da Luna.

- Luna continua sendo uma agente fixa do Agent Office. Não pode ser removida nem renomeada; poderá editar sua **aparência**, **modelo** e **esforço**. Essas preferências são próprias da Luna, não alteram os padrões globais nem a identidade/nome/função dela.
- Revisão do dia e planejamento de amanhã terão popups próprios, coerentes com os modais atuais. As alterações do planejamento só serão persistidas após confirmação final explícita.
- A conversa normal com a Luna não deve pedir aprovação intermediária do contexto preparado antes de enviar ao Claude. Isso não muda o modo de permissão da Luna nem elimina confirmações de ações destrutivas ou de outras operações.
- O motivo de o chat não responder será diagnosticado no fluxo completo; remover a aprovação de contexto, isoladamente, não será considerado prova de correção.
- A entrada de tarefas deve oferecer um botão superior para abrir o quadro; o estado vazio não pode aparecer junto de tarefas válidas.
- A Casa abre diretamente a categoria de mídia clicada. A biblioteca geral, aberta por outros caminhos, continua oferecendo suas abas.
- Idioma da interface: pt-BR; tema escuro e tokens/componentes existentes.
- Referência visual consultada: o Claude Design local, especialmente as telas da rodada 7 para o perfil da Luna, revisão, planejamento, chat, tarefas e mídias. O protótipo é referência de aparência/estados, não fonte de dados nem código de produção; nomes, métricas e conteúdo simulados não devem ser copiados.

## Parte 1 — Luna

### Perfil e preferências

- O painel da Luna mostra claramente os dados que o produto já conhece: nome e função fixa, estado/atividade, modelo e esforço atuais (ou o padrão do modelo quando não configurados).
- Disponibiliza edição da aparência com preview e ações de salvar/cancelar, reutilizando opções e validações de aparência existentes.
- Permite escolher modelo e esforço em controles compatíveis com as opções já existentes para agentes. Salvar as três preferências da Luna não altera `defaultModel`, `defaultEffort` nem a aparência padrão de outros agentes.
- Preferências persistem entre reinícios e carregam valores padrão para instalações/dados antigos sem invalidar `office.json`. A Luna continua presente com o ID fixo `agent-office:luna`.

### Ações e revisão do dia

- Ao abrir o painel da Luna, as ações **Revisão do dia**, **Planejar amanhã** e **Conversar** ficam acessíveis sem depender de enviar uma mensagem.
- A oferta contextual da Luna pode aparecer no feed como mensagem com botões **Revisão do dia**, **Planejar amanhã** e **Agora não**; nenhum popup deve abrir sozinho. As escolhas de revisão/planejamento levam aos popups correspondentes, sem substituir os acessos explícitos do painel.
- Revisão abre um popup explícito, além de qualquer ponto de entrada existente. O fluxo mostra os dados disponíveis da agenda, tarefas em foco, rotinas e ciclo de estudos, identificando ausência de dados separadamente de erro de leitura.
- Permite revisar as escolhas e ver o resumo do que será aplicado. Escolhas podem permanecer como rascunho recuperável segundo a lógica atual, mas não alteram agenda/tarefas nem são aplicadas até a confirmação final; cancelar/fechar não aplica escolhas pendentes.
- Mantém a lógica de adiamento, rascunho e elegibilidade por data já existente, sem fazer a abertura explícita desaparecer apenas por a revisão automática não estar vencida. A implementação deverá reconciliar o popup com o estado atual do rascunho, sem duplicar ou aplicar duas vezes uma revisão.

### Planejar amanhã

- Um popup guiado apresenta, quando disponíveis, tarefas em foco, compromissos já registrados e rotinas pertinentes ao dia seguinte. Fontes indisponíveis ou falhas aparecem como estados identificáveis, não como listas vazias enganosas.
- A usuária pode montar/revisar uma proposta de agenda e tarefas usando somente os dados e operações suportados pelo app. A UI distingue claramente o que será criado, alterado ou mantido.
- Antes de gravar em `agenda.md` e/ou `tarefas.md`, apresenta revisão final e exige confirmação explícita. Cancelar, fechar ou falhar ao preparar a proposta não grava alterações. No salvamento, tratar falhas sem declarar sucesso parcial como sucesso total e informar claramente o resultado.
- A proposta deve ser revalidada contra o estado atual antes da gravação para evitar sobrescrever mudanças feitas enquanto o popup estava aberto.
- Não inventa compromissos, horários, tarefas nem funcionalidades de calendário externo.

### Conversa e legibilidade

- Remover a etapa obrigatória de preview/aprovação de contexto do envio normal ao Claude. A preparação de contexto local existente pode continuar sendo usada, mas não pode bloquear a mensagem aguardando aprovação.
- Preservar o controle de permissões e confirmações de operações independentes do envio de mensagem; não alterar o permission mode para `bypassPermissions` como efeito colateral.
- Diagnosticar ponta a ponta: ação de envio e anexos no renderer, chamada IPC, processamento/enfileiramento no main, invocação do Claude, erros/timeouts e retorno/broadcast ao feed. Mensagens e prompts não devem ser escritos nos logs; respeitar `redact()`.
- Garantir estado perceptível de enviando/respondendo, retorno de resposta associado à conversa, erro recuperável e ação de tentar novamente quando apropriado. Falhas não podem deixar a Luna silenciosamente ocupada ou presa.
- Melhorar a apresentação de Markdown no feed (coluna com cerca de 68 caracteres por linha, separação de parágrafos, listas, títulos, ênfases e blocos de código), mantendo sanitização, escape de HTML e política segura de links/imagens.

## Parte 2 — Tarefas

- Disponibilizar botão claramente identificado na parte superior da interface para abrir o quadro de tarefas diretamente, sem obrigar a passar pelo popup de tarefas em foco.
- No popup de tarefas em foco, mostrar estado vazio somente quando não houver tarefas válidas. Com tarefas válidas, elas aparecem sem a mensagem “Nenhuma tarefa em foco”; itens ausentes em `tarefas.md` continuam identificados como ausentes e não contam como tarefas válidas.
- Manter o quadro como destino do botão e manter as ações atuais de foco/conclusão, salvo ajustes necessários para corrigir a renderização contraditória.
- O botão deve funcionar por mouse e teclado e ter nome acessível; não cobrir controles da janela nem competir com atalhos existentes.

## Parte 3 — Casa e mídias

- Os atalhos/etiquetas **Objetivos**, **Rotinas pessoais**, **Agenda** e **Livros** são exclusivos do andar Casa: ficam visíveis e acionáveis nesse andar e desaparecem ao navegar para qualquer andar de projeto, reaparecendo ao voltar à Casa. Não remover ou alterar seus destinos na Casa. A navegação deve controlar também as etiquetas clicáveis sobrepostas à cena, não apenas os objetos 3D.
- A abertura por Filmes, Jogos ou Livros na Casa mostra somente a categoria solicitada (sem abas de outras categorias nesse modo).
- A biblioteca aberta pelo quadro de tarefas ou por outro acesso geral mantém as três abas e sua navegação atual.
- A categoria escolhida continua definindo a listagem e o tipo sugerido ao adicionar uma mídia; não muda persistência, metadados ou edição dos itens.

## Estados, falhas e acessibilidade

- Modais reutilizam `modal()` e os padrões atuais de foco, Escape, clique no backdrop, foco restaurado, labels e botões. Se houver alterações não confirmadas, fechar não as salva.
- Carregamento, vazio, erro e sucesso são distintos e apresentados em pt-BR. Erros recuperáveis oferecem nova tentativa quando isso for seguro.
- Manter navegação por teclado, nomes acessíveis e foco previsível; não depender exclusivamente de cor para diferenciar estados.
- Alterações de dados passam pelo IPC validado por Zod; gravações seguem persistência atômica existente. Não relaxar CSP, sandbox, sanitização ou controles de processo.

## Critérios de aceitação

1. A Luna mantém ID, nome e função fixos; aparência, modelo e esforço são editáveis e persistem sem mudar defaults globais.
2. Revisão do dia pode ser aberta diretamente em popup e permite cancelar sem aplicar; confirmar aplica uma única vez as escolhas revisadas.
3. Planejamento de amanhã mostra uma proposta baseada nos dados existentes, permite cancelamento sem escrita e grava apenas depois da confirmação final; conflitos/falhas são apresentados sem falso sucesso.
4. Uma mensagem normal à Luna chega ao Claude sem popup obrigatório de aprovação de contexto; a resposta ou erro chega visivelmente ao feed. O diagnóstico identifica e cobre a causa real do não retorno.
5. Conteúdo Markdown da Luna fica mais fácil de ler sem abrir vetor de XSS ou links/imagens não autorizados.
6. O quadro é acessível por um botão superior; mensagem de estado vazio nunca coexiste com uma tarefa válida.
7. Atalhos de Objetivos, Rotinas pessoais, Agenda e Livros só aparecem/funcionam no andar Casa; Filmes/Jogos/Livros abrem a categoria correspondente e a entrada geral mantém abas.
8. Os três fluxos funcionam em Windows, macOS e Linux, seguem os padrões existentes e recebem testes para lógica/persistência/validação não trivial.

## Fora de escopo

- Remover ou renomear Luna; editar a identidade fixa dela.
- Mudar defaults globais de modelo/esforço/aparência ao editar Luna.
- Alterar o modo de permissões do Claude, remover confirmações de outras operações ou habilitar execução irrestrita.
- Construir integração com calendário externo, inventar dados ou fazer uma auditoria/redesign de todos os modais não relacionados.
- Alterar a biblioteca geral de mídias, seu armazenamento ou os metadados dos itens.

## Superfícies atuais identificadas

Referências para orientar o plano (não são decisão de implementar tudo nesses arquivos): `src/shared/luna.ts`; painel em `src/renderer/src/ui/panel/`; chat em `src/main/luna-chat.ts` e `src/main/ipc/iris.ts`; revisão em `src/renderer/src/ui/review-chat.ts`, `src/renderer/src/ui/review.ts` e `src/main/ipc/review.ts`; tarefas em `src/renderer/src/ui/focus-popup.ts`, `tasks-board.ts` e `src/renderer/src/main.ts`; atalhos e etiquetas da Casa em `src/renderer/src/world/home.ts` e `src/renderer/src/game/base.ts`; mídias em `src/renderer/src/ui/media-library.ts` e `src/renderer/src/main.ts`.
