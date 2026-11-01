# Agent Office como centro de controle da vida

**Status:** aprovada pela usuária em 2026-10-21; decisões posteriores reconciliadas em 2026-10-27 e 2026-10-29. Aprovação da spec não autoriza, por si só, migração do vault real, alteração de configurações externas, instalação, commit ou release.
**Atualização:** 2026-10-29.
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
- Agentes individuais vêm à Casa quando Luna os convoca para uma tarefa, já com o perfil/especialização adequado a ela. A lotação geral existente continua valendo (quatro regulares e um temporário).
- Enquanto o agente tem tarefa em andamento, a usuária não pode mandá-lo embora: “Mandar embora da Casa” fica indisponível até a tarefa terminar. Depois de concluída, se a usuária não o dispensar, o agente continua circulando pela Casa; essa presença persiste após entregas, mudanças de andar e reinícios. Dispensar encerra apenas a presença e mantém sessão, perfil e histórico. A caveira continua encerrando a sessão pelo fluxo existente. (Decisão da usuária em 2026-10-29, refinando AO-94.)
- Cada convocação gera nomes com mais variação, mantendo o tema de personalidades da tecnologia; o gerador evita repetir sempre os mesmos nomes.
- Perfis iniciais da casa: **Ajuda técnica**, **Estudo** (somente dúvidas avulsas, fora de um ciclo ativo) e **Agatha** (revisão/edição de escrita somente quando solicitada). Novos perfis exigem aprovação.
- Perfis delegados começam cada tarefa numa conversa nova e conservam memória privada persistente com aprendizados resumidos. O chat principal da Luna mantém continuidade pelo histórico normal salvo do agente; não reinicia a conversa a cada tarefa. Memórias resumidas podem ser consultadas por Luna e revisadas, editadas ou apagadas pela usuária. Não guardam transcrições brutas, credenciais nem segredos.
- Skills aprovadas podem ser selecionadas e adaptadas à tarefa. Mudanças permanentes em skills exigem aprovação.
- A secretária antes chamada Íris passa a se chamar **Luna**. Luna é assistente pessoal e coordenadora de casa, estudos e projetos, o mais próxima possível de um agente comum: aparece na barra lateral, conversa no chat normal e usa as mesmas ferramentas que os demais agentes têm. Não há canto, painel ou chat exclusivo para Luna, e não se criam popups novas para ela.
- Luna ajuda ativamente com agenda, objetivos, rotinas e tarefas: monta e ajusta a agenda, acompanha objetivos, lembra rotinas, aponta tarefas paradas ou abandonadas e propõe o que fazer com elas, além do que mais for cabível para auxiliar a usuária.
- Luna tem leitura ampla, sem aprovação por consulta, sobre o vault pessoal configurado, os dados pessoais do Agent Office, as memórias disponíveis e todos os projetos/worktrees registrados no Office. Uma fonte nova fora desses espaços exige conexão/configuração pela usuária; isso não concede acesso irrestrito ao restante do computador.
- Pedidos claros de organização são executados diretamente; ambiguidade gera pergunta. Excluir ou descartar sempre pede confirmação explícita. (Decisão da usuária em 2026-10-29, mantendo a regra de 2026-10-27.)
- Permissões de agentes, sandbox, validação IPC, proteção de segredos e gates de publicação continuam ativos. Leitura ampla não autoriza execução irrestrita, commit, push, merge ou publicação silenciosa. O contexto enviado ao modelo usa os dados pertinentes ao pedido; credenciais e segredos nunca são enviados.
- Luna usa notificações e perguntas já disponíveis para agentes para iniciar interações proativas, como planejamento e acompanhamento do dia. Respostas, perguntas e confirmações continuam na conversa normal de Luna; a revisão do dia não depende de popup.
- Os detalhes operacionais da Luna seguem o padrão informativo dos agentes: modelo, consumo/custo, effort, pasta e branch quando aplicáveis, e estado da memória. As ações de compactar e limpar memória ficam disponíveis; limpar exige confirmação. Dados de projeto inexistentes são indicados como não aplicáveis, não inventados.
- As preferências próprias de aparência, modelo e esforço da Luna (PR #100) são mantidas.

### 2.2 Registros pessoais

- `tarefas.md` permanece a fonte canônica das tarefas pessoais; uma tarefa pode ter vínculo opcional a um objetivo, sem duplicação. Texto digitado ou pedido claro pode criar, concluir ou reorganizar tarefas diretamente. Exclusão/descarte sempre pede confirmação explícita.
- Tarefas capturadas por áudio são uma exceção: exigem revisão e aprovação por grupo antes de qualquer escrita em `tarefas.md`. Um pedido de conclusão por áudio também entra nesse grupo e só é aplicado após aprovação.
- Objetivos ficam em arquivo próprio no vault, com alvo mensurável, prazo, marcos e vínculos opcionais a tarefas. Na migração, Luna coleta também os objetivos já registrados na seção de objetivos de `tarefas.md` e os transfere para esse arquivo, preservando conteúdo e vínculos; o painel Objetivos passa a ler o arquivo próprio. O progresso é calculado com pesos iguais entre marcos e tarefas vinculadas. Luna não conclui tarefas; ao atingir 100%, pede confirmação para marcar o objetivo como alcançado.
- Os painéis de Objetivos e Rotinas pessoais são somente para consulta, seguindo o papel de leitura da Agenda. Apresentam os dados registrados sem controles de edição direta. Luna/Secretaria cria e atualiza esses registros através da conversa normal; as confirmações existentes continuam obrigatórias.
- Quando a usuária cria ou altera um objetivo pelo chat, Luna confirma o entendimento e propõe tarefas concretas vinculadas ao objetivo. A usuária revisa e ajusta a proposta; Luna só grava as tarefas em `tarefas.md` após confirmação explícita, sem duplicar tarefas existentes.
- No planejamento semanal, Luna revisa os objetivos ativos e combina com a usuária quais tarefas devem avançar naquela semana; se faltar decomposição, pergunta antes de propor novas tarefas. Na revisão diária, trabalha com tarefas já combinadas — sugere prioridades e pergunta sobre pendências, sem criar tarefas automaticamente só porque o painel Objetivos foi aberto.
- Quando há tarefas em foco, o painel mantém uma ação para abrir o quadro completo de tarefas. Ela permanece visível com foco vazio ou preenchido; abrir o quadro não altera o foco.
- Livros, filmes e jogos ficam em arquivos separados do vault, com estados planejado/em andamento/concluído e progresso específico por mídia. Um compromisso da agenda pode se vincular opcionalmente a uma mídia; o progresso só muda com confirmação da usuária.
- Desenho, violão, leitura e filmes entram na agenda somente quando adicionados manualmente, sempre como compromissos. Não criam tarefas nem recorrências automaticamente. Se vinculados a mídias, o progresso correspondente só muda após confirmação.
- Trechos de escrita ficam em arquivo próprio no vault. São guardados somente após confirmação; o original é preservado. Agatha só revisa quando solicitada e gera uma nova versão para aprovação, sem sobrescrever o original.
- Novos registros de objetivos, mídias e escrita usam arquivos separados e editáveis no Obsidian. O arquivo da grade de aulas também fica no vault. Definições de rotinas ficam no vault; histórico/execuções continuam no armazenamento local do Office.

### 2.3 Telegram e tarefas por áudio

> **Removido por decisão da usuária em 2026-10-30:** a integração com o Telegram saiu do código e não está mais planejada (#55 fechada como não planejada). A captura de áudio local continua.

> **Adiado por decisão da usuária em 2026-10-29:** não implementar nem avançar integração, captura, notificações ou aprovações pelo Telegram agora. Os requisitos abaixo ficam preservados como histórico; ao retomar, reconciliar todos com as regras vigentes da Luna antes de executar.

- O Telegram é o canal remoto de conversa com Luna e de envio de áudios. Também são aceitos arquivos de áudio importados no Agent Office.
- Somente a conta Telegram da usuária, explicitamente vinculada/aprovada, pode enviar comandos. O Agent Office processa mensagens localmente enquanto estiver aberto. Atualizações do Telegram expiram após no máximo 24 horas; se uma mensagem expirar, Luna informa e pede reenvio.
- A transcrição é local. A transcrição corrigida é exibida para conferência, sem uma aprovação global extra. Trechos incertos geram perguntas. Correções confirmadas entram automaticamente no dicionário pessoal; conflitos são guardados com contexto e perguntados quando ambíguos. Gravar ou aplicar qualquer mudança extraída exige aprovação explícita do conteúdo exato.
- Datas relativas são calculadas pelo relógio/fuso local; interpretações ambíguas geram pergunta. As tarefas são agrupadas pelas listas existentes em `tarefas.md`; tarefas datadas recebem destaque. Se não houver lista compatível, Luna pergunta e não cria categorias.
- Um grupo por vez pode ser editado e reapresentado. A aprovação explícita grava aquele grupo; grupos pendentes não são gravados. Tarefas textuais diretas também são propostas no chat e gravadas somente após aprovação explícita.
- Conteúdo não-tarefa é roteado ao fluxo apropriado (agenda, mídias, objetivos ou escrita). Escrita exige confirmação para salvar; conteúdo sem destino definido gera pergunta, sem gravação silenciosa.
- A cópia local do áudio é apagada após a aprovação/registro do grupo. Mensagens de áudio no Telegram são apagadas após processamento, inclusive áudios de escrita depois de o trecho ser confirmado/salvo. A conversa bruta não fica arquivada localmente; o Office mantém somente estado pendente e registros aceitos.
- Pedidos via Telegram podem consultar livremente fontes autorizadas. Antes de qualquer mudança, Luna apresenta a ação exata e aguarda aprovação explícita no próprio Telegram; exclusões/descartes exigem confirmação explícita. Pedidos de permissão dos agentes mostram a ação exata e mantêm a política de risco do Office.
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
- Com a conta Claude configurada e a rota verificada, Luna pode usar conteúdo pertinente de todas as fontes pessoais e projetos registrados, sem autorização repetida por consulta ou por ambiente. Não envia o vault inteiro automaticamente, credenciais, segredos ou dados sem relação com o pedido. A usuária controla conexão de fontes externas e ações mutáveis; acesso de leitura não autoriza gravação nem transmissão para serviços externos além do modelo já configurado.

### 2.7 Autorização conversacional da Luna (2026-10-29)

- Esta decisão substitui regras anteriores que limitavam Luna a fluxos guiados, leituras por pedido/ambiente ou consultas somente em telas específicas.
- A usuária autorizou leitura ampla dos dados pessoais e de projeto disponíveis nos espaços registrados no Agent Office. Luna não precisa pedir permissão para ler, localizar ou analisar esses dados.
- Luna conversa livremente, mantém continuidade pelo mecanismo normal de conversa, faz perguntas e inicia notificações relevantes com as ferramentas comuns dos agentes. Não se criam popups novas para ela, e a conversa não é convertida em formulário/JSON.
- Revisão em 2026-10-29: pedidos claros são executados diretamente; ambiguidade gera pergunta; exclusão ou descarte exige confirmação explícita. A versão anterior desta seção, que exigia aprovação para toda alteração, foi descartada pela usuária.
- Esta decisão não remove sandbox, permissões, validação de entrada, proteção de segredos, isolamento de projetos ou aprovação para commit/push/merge/publicação. Fontes fora dos espaços registrados precisam ser conectadas pela usuária.

### 2.5 Estudos, Bonnie e Cora

- A aparência aprovada do andar de estudos é preservada. Haverá grade fixa semanal de aulas, lida de arquivo do vault, e as ocorrências aparecem na agenda. Uma exceção altera apenas aquela ocorrência; não muda a grade semanal.
- **Bonnie** fica na diretoria do andar e controla a sequência do ciclo; não permite avanço até verificar critérios objetivos:
  1. **Diagnóstico:** responder todas as questões selecionadas e marcar incertezas; sem nota mínima.
  2. **Erros e dúvidas:** toda resposta errada/incerta deve ter causa e próximo passo definidos. Se não houver nenhuma, Bonnie encerra/pula essa etapa.
  3. **Prática e fontes:** estudar fontes ligadas aos erros, registrar pelo menos uma nota durante a consulta e atingir 80% de acertos sobre todas as questões planejadas para essa prática, sem mínimo fixo de questões. Abaixo de 80%, Bonnie revisa os erros e propõe questões novas; a etapa permanece aberta.
  4. **Reteste:** pelo menos dez questões novas, gabaritos conferidos, sem ajuda e com pelo menos 80%. A usuária confirma a conclusão do ciclo.
- Se o diagnóstico não apontar erros nem dúvidas, Bonnie pula Erros e dúvidas e Prática e fontes (incluindo a exigência de nota) e libera o Reteste; ela não inventa uma lacuna para forçar prática.
- Notas são registradas durante a etapa Prática e fontes; não existe etapa de notas posterior. As notas não são cartões e não comprovam aprendizagem sozinhas.
- Tutor avalia respostas no diagnóstico; Curador avalia respostas de prática; Verificador confere respostas do reteste. Bonnie coordena e controla os gates. Busca/consulta de fontes permanece local e selecionada pela usuária; os perfis não iniciam leitura ampla nem chamadas automáticas. Exceção autorizada em 2026-11-01: a montagem do banco, iniciada pela usuária, envia ao Claude trechos dos livros da disciplina escolhida (ver abaixo).
- **Cora** continua bibliotecária fixa e pode ler a biblioteca inteira. A autorização de envio a Claude para o ciclo foi reconciliada em 2026-10-28 com #75 e confirmação explícita da usuária, limitada ao mínimo de material selecionado para a etapa (tópico, pergunta e trecho/fonte pertinente). Isso não autoriza contexto integral do vault/biblioteca, busca/leitura ampla não selecionada ou envio silencioso.
- Perfis locais de tutor, curador e verificador podem ser ligados às chamadas explícitas da etapa correspondente do ciclo Bonnie, respeitando a autorização limitada acima. Não executar chamadas em estado aguardando/pausado nem transmitir conteúdo fora do recorte selecionado. Os perfis não concedem acesso nem alteram gates.
- O perfil Estudo atende dúvidas avulsas fora do ciclo. Dúvidas/etapas de um ciclo ativo passam por Bonnie.
- **Banco de questões automático (decisão da usuária em 2026-11-01).** O banco é montado pela IA, sem revisão humana questão por questão:
  - A usuária escolhe disciplina (ou todas), tópico opcional da trilha e quantidade por tópico (padrão 20, máximo 50) em **Montar banco**. Não escolhe páginas nem arquivos.
  - Cada tópico lê só os livros locais da disciplina em `study sources` (sem web). Disciplina sem pasta própria lê `study sources/textbooks/<nome da disciplina>/`; colocar o livro ali é como a usuária indica um.
  - Cada questão passa pela cadeia autor → conferência da citação no trecho → semelhança (com as do tópico, inclusive as já respondidas) → resolvedor cego → verificador; qualquer etapa recusa e o autor tenta até 3 vezes. Só a aprovada entra no banco, marcada **Verificada por agentes** (origem livro, trecho citado e referência).
  - Não existe mais fluxo de revisão manual (consentimento, “Salvar seleção”, candidatas da web/IA para revisar). O único selo é **Verificada por agentes**; não há selo de revisão pela usuária.
  - A montagem roda em segundo plano, uma por vez, pode ser parada e é retomada pulando tópicos completos. O relatório dá adicionadas/meta por tópico e o motivo da falta (sem livro, nenhum trecho, pouco material, parecidas demais, verificador recusou, já tem questões) com a ação sugerida.
  - O banco comporta até 3.000 questões (a trilha inteira a 20 por tópico cabe).
- **Questões nunca se repetem (decisão da usuária em 2026-11-01).** Toda questão respondida em qualquer etapa (diagnóstico, prática, reteste) fica registrada em `study-cycle.json`, mesmo que o ciclo seja guardado ou trocado. Questão respondida — pelo id ou pelo mesmo enunciado — nunca é oferecida de novo: os seletores a escondem, o processo principal a recusa e Bonnie não a usa. Na montagem, só questões não respondidas contam para a meta do tópico.
- **Bonnie escolhe as questões do ciclo (decisão da usuária em 2026-11-01).** Com o banco montado pela IA, a usuária não seleciona questões uma a uma: escolhe o tópico e a Bonnie separa questões novas do banco — até 12 no diagnóstico, de 4 a 8 por rodada de prática (ligadas aos erros) e 12 no reteste (mínimo 10). A usuária pode ver e trocar a seleção. Faltando questões novas do tópico, o ciclo oferece **Montar banco** já com o tópico escolhido.
- **Visual do andar de estudos (2026-11-01).** Os popups do andar seguem o protótipo aprovado “Ciclo de estudo da Bonnie” (`mockups/ciclo-bonnie/`): selo de quem conduz a janela, título pixel com subtítulo, quem está na sala, as quatro etapas em faixa, painéis com contorno e checklist do gate no rodapé (`ui/study-kit.ts`, `styles/study-kit.css`).
- Cartões Zettelkasten são um fluxo separado do ciclo, alimentado pelas notas. A equipe mantém coordenador, assistente de elaboração e verificador de fontes/conexões. O cartão digital fica no Obsidian; cada cartão digital produzido deve ser escrito à mão na sala de estudo e marcado manualmente como escrito. Isso não bloqueia reteste/ciclo.

### 2.6 Projetos e Emi

- Cada andar de projeto ganha uma sala de reuniões em frente à diretoria.
- Depois de implementação, testes e revisão, o agente vai apresentar o resultado nessa sala. O Office avisa; a usuária abre a apresentação ao clicar. O agente fica aguardando resposta ou outra tarefa.
- **Emi** permanece diretora. Ela usa o kit de skills de planejamento do Matt Pocock — `grill-with-docs → to-spec → to-tickets` — para construir projetos, specs e tickets junto com a usuária. Squads são propostos a partir dos artefatos aprovados; a usuária aprova a composição antes do início.
- Equipes são sob medida por projeto/ticket. Emi pode redistribuir subtarefas, mas não alterar objetivo ou critérios aprovados sem autorização.
- A composição de squads usa um catálogo local de perfis de competência, sem depender do Paperclip em execução nem ler seu export durante a criação. Cada especialidade refina o foco/instruções de um membro e não substitui implementador/revisor. A proposta exibe papel, especialidade, modelo e conta para aprovação; só depois da aprovação os arquivos independentes do squad são materializados. Perfis não concedem ferramentas, acesso, permissões, conta ou modelo. Squads existentes não são reescritos.
- A geração automática de composição só pode ser reativada por um fluxo Claude-only validado e com a aprovação ambiental necessária; até lá, a pessoa compõe/revisa manualmente com o catálogo local. Não reintroduzir julgador ou execução OpenCode.
- Coordenador de squad entra somente quando necessário; planeja e acompanha, sem implementar nem aprovar o próprio trabalho. Código sempre recebe revisor independente, que aponta problemas e não corrige o objeto revisado. Implementador trabalha no escopo aprovado.
- Rotinas de projeto continuam no contexto do respectivo andar, com permissões do projeto, perfil fixo por rotina e resultado apresentado no fluxo desse andar.

## 3. Rotinas migradas

- Luna assume agendamento e execução. Definições ficam no vault; histórico, execução e estado ficam localmente no Agent Office.
- Cada rotina pessoal tem sua própria cadência. Rotinas diárias podem ser sugeridas diariamente; alvos semanais são planejados semana a semana com Luna, sem presumir dias fixos.
- Ao construir o foco diário, Luna apresenta rotinas previstas como sugestões. Sugestão não cria tarefa: a tarefa canônica só é criada quando a usuária escolhe o item e define o objetivo do dia.
- A meta semanal só conta quando a usuária conclui manualmente a tarefa. Uma ocorrência não concluída gera uma pergunta na próxima montagem do foco; Luna não duplica, pula ou conclui silenciosamente.
- Uma sugestão de rotina ligada a estudo não avança nem conclui automaticamente o ciclo pedagógico da Bonnie. Nomes e cadências pessoais ficam nos dados privados de rotina do vault, não em exemplos públicos ou código.
- Rotinas existentes são importadas pausadas, apresentadas para revisão individual e só executam depois de aprovadas/ativadas. O sistema antigo não é desligado até a revisão/migração ser concluída; o histórico não é apagado.
- Rotinas de projeto continuam no contexto do projeto; a rotina guarda um perfil Claude fixo. Limites/permissões continuam os do projeto, e uma execução que precise autorização pausa para solicitar aprovação.

## 4. Visual e prompt para Claude Design

O protótipo da sala de reunião (#56) foi aprovado e a sala está entregue (#57). Novas mudanças estéticas da casa e da interface ficam sob responsabilidade da usuária; o prompt abaixo é uma referência anterior, não uma solicitação para gerar uma prévia. Se houver novo redesign de produção, aprovar sua referência visual antes de alterar código; não alterar `src/` nem o vault durante protótipos.

### Prompt para enviar ao Claude Design

> Redesign only the current Agent Office ground floor as the user's cozy home. Preserve the existing isometric pixel-art style and reuse the project's real furniture, palette, avatars, and visual components. You may rearrange the floor plan, but keep circulation clear and preserve access to the elevator and other floors.
>
> Include a living room, a dedicated desk for secretary Luna, the user's personal office with a goals board, a visible calendar in the living room, a cozy kitchen, a private bedroom, a creative nook with a drawing/writing desk and guitar, a bookshelf for books, a TV for movies, and a console/arcade for games. Agents summoned by Luna come to the house for a task and may keep wandering around it after finishing, until the user dismisses them.
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

## 9. Perfis locais de competência (2026-10-27)

O design detalhado e os critérios de verificação estão em `docs/superpowers/specs/2026-10-27-perfis-locais-squads-e-estudo-design.md`. A entrega é dividida em: (1) catálogo local e seleção/materialização para squads de desenvolvimento; (2) perfis do ciclo de estudo, autorizados no escopo limitado reconciliado com #75 e confirmado pela usuária em 2026-10-28. Nunca enviar biblioteca/vault integral, conteúdo não selecionado ou dados além do mínimo pertinente à etapa.

## 8. Fronteiras públicas de teste acordadas (2026-10-27)

Testes devem verificar comportamento observável pelo usuário no nível mais alto possível, priorizando seams existentes e evitando acoplamento a detalhes internos. Toda leitura/escrita de vault usa fixtures ou dados sintéticos; nunca o vault real. QA visual usa conteúdo marcado `SIMULADO`.

1. **Casa e Luna:** navegar pelos fluxos pessoais, conversar com Luna, rever propostas e confirmar gravações/migrações em vault fixture; validar limites de segurança e privacidade.
2. **Estudos e Bonnie:** completar ou bloquear etapas do ciclo por seus critérios observáveis, incluindo exceções de aula e confirmação de conclusão; estado persiste ao reiniciar.
3. **Telegram, áudio e aprovação:** simular mensagens autorizadas/não autorizadas, expiração, transcrição local, edição, aprovação/rejeição de grupos, permissões e resumo diário, sem token real ou fallback de nuvem.
4. **Projetos e squads:** observar aprovação de spec/tickets/squad, execução com revisor independente e apresentação de resultado sem aceite ou merge automático.
5. **Integração e privacidade:** executar migração e fluxos combinados com fixtures, confirmando ausência de sobrescrita concorrente, vazamento de segredos e bypass de gates humanos.

Essas fronteiras foram confirmadas pela usuária em 2026-10-27; critérios concretos e dependências são detalhados nos tickets por fase.
