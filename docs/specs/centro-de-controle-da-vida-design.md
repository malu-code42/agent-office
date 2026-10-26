# Agent Office como centro de controle da vida

**Status:** aprovada pela usuária em 2026-10-21. Aprovação da spec não autoriza, por si só, migração do vault real, alteração de configurações externas, instalação, commit ou publicação.
**Atualização:** 2026-10-21.
**Repositório:** `D:\Documents\agent-office`.

## 1. Objetivo e escopo

Reestruturar o Agent Office para apoiar vida pessoal, estudos e projetos, sem substituir a identidade visual isométrica em pixel art nem misturar os registros canônicos desses ambientes.

Ordem acordada:

1. Preflight documental e técnico.
2. Casa e Luna (antigo térreo), incluindo registros pessoais e a migração/gestão local das rotinas.
3. Andar de estudos e gates pedagógicos da Bonnie.
4. Telegram, captura de áudio, tarefas e resumo diário.
5. Andares de projetos e equipes sob medida.

A edição livre da aparência dos andares, inspirada em The Sims, fica para uma fase futura. A prévia estética da casa será feita e aprovada antes de código de produção.

## 2. Decisões de produto

### 2.1 Casa e Luna

- O térreo atual se transforma em uma casa reconhecível, aconchegante e em pixel art. A planta pode mudar, mantendo circulação e acesso ao elevador e aos demais andares.
- A casa inclui sala de estar, cozinha, quarto privado, escritório pessoal, mesa própria de Luna e cantinho criativo para desenho, escrita e violão.
- A sala terá calendário para agenda; o escritório, quadro de objetivos; a casa também terá estante de livros, TV para filmes e console/arcade para jogos.
- A copa e o lounge atuais podem ser refeitos como cozinha e sala de estar; não é obrigatório manter a planta ou o mobiliário atual.
- Agentes individuais variam conforme a tarefa. Luna recomenda perfis reutilizáveis e os chama automaticamente em pedidos claros. Há até quatro agentes regulares presentes; um quinto temporário pode ser chamado quando necessário e sai após entregar. Os demais ficam na sala de estar até serem dispensados.
- Perfis iniciais da casa: **Ajuda técnica**, **Estudo** (somente dúvidas avulsas, fora de um ciclo ativo) e **Agatha** (revisão/edição de escrita somente quando solicitada). Novos perfis exigem aprovação.
- Cada perfil começa cada tarefa numa conversa nova, mas conserva memória privada persistente com aprendizados resumidos. Essa memória atualiza automaticamente, pode ser consultada por Luna e pode ser revisada, editada ou apagada pela usuária. Não guarda transcrições brutas, credenciais nem segredos.
- Skills aprovadas podem ser selecionadas e adaptadas à tarefa. Mudanças permanentes em skills exigem aprovação.
- A secretária antes chamada Íris passa a se chamar **Luna**. Luna coordena casa, estudos e projetos; resolve pedidos claros de organização e pergunta quando não souber o destino do trabalho. Luna aparece na barra lateral como qualquer agente: a usuária abre sua conversa no chat normal; não há canto, painel ou chat exclusivo para Luna.
- Luna usa as notificações e perguntas já disponíveis para agentes para iniciar interações proativas. Respostas e acompanhamentos continuam na conversa normal de Luna.
- Luna pode consultar o conteúdo dos ambientes e as memórias exclusivas para coordenar. O envio de conteúdo a modelos segue as regras da seção 6.

### 2.2 Registros pessoais

- `tarefas.md` permanece a fonte canônica das tarefas pessoais; uma tarefa pode ter vínculo opcional a um objetivo, sem duplicação. Texto digitado ou pedido explícito pode criar uma tarefa diretamente. Exclusão/descarte sempre pede confirmação. Luna pode concluir uma tarefa quando a usuária pedir diretamente.
- Tarefas capturadas por áudio são uma exceção: exigem revisão e aprovação por grupo antes de qualquer escrita em `tarefas.md`. Um pedido de conclusão por áudio também entra nesse grupo e só é aplicado após aprovação.
- Objetivos ficam em arquivo próprio no vault, com alvo mensurável, prazo, marcos e vínculos opcionais a tarefas. O progresso é calculado com pesos iguais entre marcos e tarefas vinculadas. Luna não conclui tarefas; ao atingir 100%, pede confirmação para marcar o objetivo como alcançado.
- Livros, filmes e jogos ficam em arquivos separados do vault, com estados planejado/em andamento/concluído e progresso específico por mídia. Um compromisso da agenda pode se vincular opcionalmente a uma mídia; o progresso só muda com confirmação da usuária.
- Desenho, violão, leitura e filmes entram na agenda somente quando adicionados manualmente, sempre como compromissos. Não criam tarefas nem recorrências automaticamente. Se vinculados a mídias, o progresso correspondente só muda após confirmação.
- Trechos de escrita ficam em arquivo próprio no vault. São guardados somente após confirmação; o original é preservado. Agatha só revisa quando solicitada e gera uma nova versão para aprovação, sem sobrescrever o original.
- Novos registros de objetivos, mídias e escrita usam arquivos separados e editáveis no Obsidian. O arquivo da grade de aulas também fica no vault. Definições de rotinas ficam no vault; histórico/execuções continuam no armazenamento local do Office.

### 2.3 Telegram e tarefas por áudio

- O Telegram é o canal remoto de conversa com Luna e de envio de áudios. Também são aceitos arquivos de áudio importados no Agent Office.
- Somente a conta Telegram da usuária, explicitamente vinculada/aprovada, pode enviar comandos. O Agent Office processa mensagens localmente enquanto estiver aberto. Atualizações do Telegram expiram após no máximo 24 horas; se uma mensagem expirar, Luna informa e pede reenvio.
- A transcrição é local. A transcrição corrigida é exibida para conferência, sem uma aprovação global extra. Trechos incertos geram perguntas. Correções confirmadas entram automaticamente no dicionário pessoal; conflitos são guardados com contexto e perguntados quando ambíguos.
- Datas relativas são calculadas pelo relógio/fuso local; interpretações ambíguas geram pergunta. As tarefas são agrupadas pelas listas existentes em `tarefas.md`; tarefas datadas recebem destaque. Se não houver lista compatível, Luna pergunta e não cria categorias.
- Um grupo por vez pode ser editado e reapresentado. A aprovação explícita grava aquele grupo; grupos pendentes não são gravados. A tarefa textual direta, fora da captura de áudio, continua podendo ser registrada diretamente.
- Conteúdo não-tarefa é roteado ao fluxo apropriado (agenda, mídias, objetivos ou escrita). Escrita exige confirmação para salvar; conteúdo sem destino definido gera pergunta, sem gravação silenciosa.
- A cópia local do áudio é apagada após a aprovação/registro do grupo. Mensagens de áudio no Telegram são apagadas após processamento, inclusive áudios de escrita depois de o trecho ser confirmado/salvo. A conversa bruta não fica arquivada localmente; o Office mantém somente estado pendente e registros aceitos.
- Pedidos claros de organização via Telegram são executados diretamente. Luna pede confirmação antes de excluir ou descartar. Pedidos de permissão dos agentes podem ser aprovados/negados pelo Telegram, mostrando a ação exata e mantendo a política de risco do Office.
- O planejamento matinal ocorre no horário local configurado pela usuária. Luna reúne compromissos/aulas, tarefas datadas e rotinas previstas e pergunta quais são as prioridades do dia. Esse planejamento incorpora o resumo diário antes previsto às 08:00; não há duas mensagens separadas.
- O fechamento do dia ocorre no horário local configurado pela usuária. Luna resume o que foi feito e as pendências, e pergunta sobre próximos passos; não altera registros sem instrução explícita.
- Rotinas pessoais seguem horários e frequências definidos pela usuária em suas definições de rotina. No horário, Luna pergunta se a rotina foi feita, adiada ou não feita; registra somente a resposta recebida. Sem resposta, tenta novamente uma vez após 30 minutos. Persistindo sem resposta, não insiste e mantém a rotina pendente para o fechamento do dia.
- Planejamento, rotinas e fechamento usam o fluxo comum de notificações/perguntas dos agentes. Com o Office aberto, Luna inicia a conversa no chat normal; perguntas usam o mecanismo de perguntas dos agentes.
- Se o Office estiver fechado no horário de um ou mais desses processos, ao abrir Luna apresenta um resumo consolidado do que venceu e envia o mesmo resumo pelo Telegram, sem reproduzir notificações vencidas em sequência. A usuária pode responder pelo Telegram ou continuar no chat normal de Luna.
- Telegram continua sem relay/serviço hospedado: o Office precisa estar aberto para processar atualizações e respostas recebidas. Mensagens enviadas ao reabrir não implicam processamento remoto enquanto o aplicativo estiver fechado.

### 2.4 Modelo, privacidade e contas Claude

- Claude é o único motor/modelo de execução do Agent Office. Remover caminhos ativos de OpenCode (runtime, seleção na contratação, consentimento, julgador, métricas/runtime e integrações). Specs/tickets locais de OpenCode serão arquivados como superados, sem apagar o histórico.
- Sessões, resultados, logs e métricas históricas de OpenCode permanecem somente para consulta; não podem ser retomados nem executados. Preferência salva de motor deve migrar para Claude; o seletor/consentimento de execução OpenCode deixa de aparecer. Trabalho OpenCode inacabado só recomeça em Claude depois de uma decisão explícita da usuária; nunca converter ou reenviar automaticamente.
- Padrão: Claude Haiku 5.5, esforço `medium`. Se Luna considerar necessário um modelo mais forte, pausa e pede aprovação informando modelo, motivo e impacto na conta/limite.
- Uma conta Claude é escolhida no início de cada tarefa conforme disponibilidade e fica fixa durante a execução. Se atingir limite, a tarefa pausa e pede decisão; não troca automaticamente no meio. A segunda assinatura será conectada quando estiver disponível.
- O envio automático de contexto completo só ocorre a modelos/aprovações já habilitados para aquele ambiente. A conta Claude pessoal deve ter a melhoria de modelos desativada e a rota verificada antes do envio de conteúdo da casa. Conteúdo de estudos e projetos aguarda aprovações específicas por ambiente. Credenciais e segredos nunca são enviados.

### 2.5 Estudos, Bonnie e Cora

- A aparência aprovada do andar de estudos é preservada. Haverá grade fixa semanal de aulas, lida de arquivo do vault, e as ocorrências aparecem na agenda. Uma exceção altera apenas aquela ocorrência; não muda a grade semanal.
- **Bonnie** fica na diretoria do andar e controla a sequência do ciclo; não permite avanço até verificar critérios objetivos:
  1. **Diagnóstico:** responder todas as questões selecionadas e marcar incertezas; sem nota mínima.
  2. **Erros e dúvidas:** toda resposta errada/incerta deve ter causa e próximo passo definidos. Se não houver nenhuma, Bonnie encerra/pula essa etapa.
  3. **Prática e fontes:** estudar fontes ligadas aos erros, registrar pelo menos uma nota durante a consulta e atingir 80% de acertos sobre todas as questões planejadas para essa prática, sem mínimo fixo de questões. Abaixo de 80%, Bonnie revisa os erros e propõe questões novas; a etapa permanece aberta.
  4. **Reteste:** pelo menos dez questões novas, gabaritos conferidos, sem ajuda e com pelo menos 80%. A usuária confirma a conclusão do ciclo.
- Se o diagnóstico não apontar erros nem dúvidas, Bonnie pula Erros e dúvidas e Prática e fontes (incluindo a exigência de nota) e libera o Reteste; ela não inventa uma lacuna para forçar prática.
- Notas são registradas durante a etapa Prática e fontes; não existe etapa de notas posterior. As notas não são cartões e não comprovam aprendizagem sozinhas.
- Tutor apoia diagnóstico/erros; curador, fontes/prática; verificador, reteste. Bonnie coordena e controla os gates.
- **Cora** continua bibliotecária fixa e pode ler a biblioteca inteira. A aprovação de envio a modelos para o ambiente de estudos continua pendente.
- O perfil Estudo atende dúvidas avulsas fora do ciclo. Dúvidas/etapas de um ciclo ativo passam por Bonnie.
- Cartões Zettelkasten são um fluxo separado do ciclo, alimentado pelas notas. A equipe mantém coordenador, assistente de elaboração e verificador de fontes/conexões. O cartão digital fica no Obsidian; cada cartão digital produzido deve ser escrito à mão na sala de estudo e marcado manualmente como escrito. Isso não bloqueia reteste/ciclo.

### 2.6 Projetos e Emi

- Cada andar de projeto ganha uma sala de reuniões em frente à diretoria.
- Depois de implementação, testes e revisão, o agente vai apresentar o resultado nessa sala. O Office avisa; a usuária abre a apresentação ao clicar. O agente fica aguardando resposta ou outra tarefa.
- **Emi** permanece diretora. Ela usa o kit de skills de planejamento do Matt Pocock — `grill-with-docs → to-spec → to-tickets` — para construir projetos, specs e tickets junto com a usuária. Squads são propostos a partir dos artefatos aprovados; a usuária aprova a composição antes do início.
- Equipes são sob medida por projeto/ticket. Emi pode redistribuir subtarefas, mas não alterar objetivo ou critérios aprovados sem autorização.
- Coordenador de squad entra somente quando necessário; planeja e acompanha, sem implementar nem aprovar o próprio trabalho. Código sempre recebe revisor independente, que aponta problemas e não corrige o objeto revisado. Implementador trabalha no escopo aprovado.
- Rotinas de projeto continuam no contexto do respectivo andar, com permissões do projeto, perfil fixo por rotina e resultado apresentado no fluxo desse andar.

## 3. Rotinas migradas

- Luna assume agendamento e execução. Definições ficam no vault; histórico, execução e estado ficam localmente no Agent Office.
- Rotinas existentes são importadas pausadas, apresentadas para revisão individual e só executam depois de aprovadas/ativadas. O sistema antigo não é desligado até a revisão/migração ser concluída; o histórico não é apagado.
- Rotinas de projeto continuam no contexto do projeto; a rotina guarda um perfil Claude fixo. Limites/permissões continuam os do projeto, e uma execução que precise autorização pausa para solicitar aprovação.

## 4. Visual e prompt para Claude Design

A primeira prévia visual é somente da casa. A sala de reunião será prototipada quando o subprojeto de projetos começar. Usar a estética isométrica pixel art e referências reais do Agent Office, respeitar circulação/elevador, dados fictícios marcados `SIMULADO`, não alterar `src/` ou dados do vault, e parar para aprovação visual antes de código de produção.

### Prompt para enviar ao Claude Design

> Redesign only the current Agent Office ground floor as the user's cozy home. Preserve the existing isometric pixel-art style and reuse the project's real furniture, palette, avatars, and visual components. You may rearrange the floor plan, but keep circulation clear and preserve access to the elevator and other floors.
>
> Include a living room where up to four task-specific individual agents can wait as invited friends, a dedicated desk for secretary Luna, the user's personal office with a goals board, a visible calendar in the living room, a cozy kitchen, a private bedroom, a creative nook with a drawing/writing desk and guitar, a bookshelf for books, a TV for movies, and a console/arcade for games. Regular agents stay in the living room until dismissed; a temporary fifth agent leaves after delivering its result.
>
> Show states/interactions for opening the agenda; tracking goals, targets, and milestones; tracking books, movies, and games (planned/in progress/completed with media-specific progress); manually adding drawing, guitar, reading, or a movie to the agenda; and opening the writing space, where editing is available only on request. Make it clear that goals, media, and writing use separate vault files. Use coherent physical room objects, not a generic dashboard.
>
> Build a disposable visual prototype using the real components/assets available in `D:\Documents\agent-office\claude design\` and the current production implementation as reference. Do not edit `src/`, install dependencies, access or read the real vault, connect Telegram/models, or implement agent execution. Use fictional data only, clearly labeled `SIMULATED`. Deliver a navigable view and screenshots of the main states for user approval. All UI labels and user-facing copy must be in Brazilian Portuguese.

## 5. Preflight acordado

- Fazer em contexto isolado, após conferir branch e worktrees. Nesta revisão o checkout está em `main` e tem cinco arquivos tracked modificados, além de arquivos não commitados; preservar todos. Não limpar/resetar nem stagear trabalho alheio.
- Reconciliar PRD, spec, status e dependências dos tickets, atualizando decisões com o que foi aprovado aqui. Arquivar OpenCode como superado sem apagar histórico; retirar o runtime ativo com migração segura dos registros.
- O lint deve examinar checkout principal e todas as worktrees em um único comando, com a configuração TypeScript correta para cada cópia. Não excluí-las silenciosamente.
- O `test/permission-notice.test.ts` falha em Windows porque a criação de symlinks ocorre no corpo de um `describe.skipIf`; mover a preparação para um hook que não rode quando o suite for pulado, mantendo todos os assertions de segurança em plataformas que suportam symlinks.
- Baseline observado em 2026-10-21: typecheck e build passam; `npm test` tem 742 aprovados, 9 ignorados e a falha acima; `npm run lint` mostra erros de resolução de múltiplos `tsconfigRootDir` ao varrer worktrees, não 7.641 erros distintos do código.
- Nunca usar o vault real durante testes/migração; usar fixture/cópia e apresentar previews antes de escrita.

## 6. Fases propostas

1. Preflight e atualização coerente dos documentos/tickets; aposentar o runtime OpenCode mantendo seus registros históricos legíveis.
2. Casa e Luna: redesign visual prototipado no Claude Design e aprovado; arquivos no vault para objetivos, mídias e escrita; Luna local, agentes/perfis, dados da casa e migração/gestão local das rotinas.
3. Estudos/Bonnie: grade de aulas e ciclo com gates; integração de notas, cartões digitais e cópias físicas.
4. Telegram e captura de áudio: transcrição local, revisão/registro por grupos, conversa remota, permissões remotas e resumo diário.
5. Andares de projetos: sala de reuniões, composição sob medida dos squads e fluxo de apresentação.
6. Personalização de aparência dos andares fica fora das entregas iniciais.

## 7. Aprovações e pendências que não bloqueiam a revisão desta spec

- Essa spec consolidada deve ser revisada pela usuária antes de alinharmos os arquivos PRD/spec/tickets existentes.
- Depois da aprovação escrita, produzir um plano de implementação detalhado e validar cada fase em worktree própria; nenhuma mudança de produção, release, push ou merge é autorizada por este documento.
- A autorização de Claude para dados da casa depende da configuração de privacidade desativada e da verificação da rota. Envio de dados de estudo e projeto requer aprovação específica por ambiente.
- O canal de envio diário já foi decidido como Telegram às 08:00; formatos e limites concretos de áudio, nomes finais dos arquivos Markdown e política de exceção de rotinas ficam para a especificação técnica/implementação, respeitando as decisões acima.
