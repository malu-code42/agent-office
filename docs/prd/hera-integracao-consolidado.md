# Integração Hera no Agent Office — estado consolidado

Atualização histórica: 2026-10-16. A diretora de projetos é **Emi** e a diretora de estudos **Bonnie**; registros anteriores preservam nomes históricos.

> **SUPERSEDED WHERE IT CONFLICTS (2026-10-21):** the approved [`centro-de-controle-da-vida-design.md`](../specs/centro-de-controle-da-vida-design.md) and its implementation plan are now authoritative. Replace the personal ground-floor/secretary design with the home and Luna; use the approved study gates (including the no-errors path); execute Claude only; and treat OpenCode integration plans as archived history, not future work. This document remains intact as provenance; its old status/requirements are not current acceptance criteria.

**Estado:** requisitos e decisões para a integração e sua prévia visual. Não é declaração de implementação, aprovação integral da spec, aceite visual de alterações ainda não apresentadas ou autorização para implementar produção. Os visuais dos andares de projeto (Loja Aurora) e de estudos existentes foram aprovados conforme relato da usuária; preservar o que não foi explicitamente solicitado. Essa aprovação não cobre redesenhos futuros.

## 1. Autoridade, escopo e leitura

- Este documento consolida o estado vigente; [o registro de descoberta](hera-integracao-descoberta.md) preserva a história anterior. O [glossário](../../GLOSSARY.md) define os termos, não regras técnicas.
- Correções diretas mais recentes prevalecem. Para o prompt visual fornecido: correções finais de Bonnie → histórico de correções, com as posteriores substituindo as anteriores → interações obrigatórias → demais requisitos. Não reativar a cautela antiga de retirar Bonnie ou deixar a personagem a definir.
- Reaproveitar necessidades/fluxos do Hera, não sua identidade visual ou arquitetura por consequência. Os documentos em `D:\Documents\hera\docs\design` são referências históricas subordinadas às decisões atuais.
- Três domínios distintos: planejamento pessoal por tarefas; projetos/áreas de trabalho por tickets e lotes; estudos por um tópico atual. Não converter nem vincular automaticamente tarefas pessoais a tickets.
- Escrita livre e pensamentos estão fora do escopo. Nomes de listas canônicas não reintroduzem esses módulos.
- A atualização documental não autoriza leitura/transmissão de fontes, alterações no vault, código de produção, instalações, Git ou publicação.

## 2. Documentos canônicos e proteção de alterações

Vault: `D:\Documents\vault-agent-office`. Malu já moveu os três itens para dentro dele; a existência de suas entradas foi verificada, sem ler conteúdo da biblioteca.

| Registro                                             | Responsabilidade                                                                                          |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `tarefas.md`                                         | Tarefas pessoais e nomes das listas usados nos quadros e na revisão                                       |
| `trilha zettel.md`                                   | Trilha e títulos das listas que definem os tópicos das estantes                                           |
| `study sources/`                                     | Arquivos das fontes representadas na biblioteca                                                           |
| Notas, cartões, decisões, planos, entregas e tickets | Documentos canônicos compartilhados entre Office e Obsidian; formato/organização fina ainda a especificar |

- Um arquivo por ticket, organizado por andar de projeto, com critérios, histórico e referências às entregas. Não criar tickets de estudo/cartões.
- Office e Obsidian trabalham sobre os mesmos documentos; não manter cópias canônicas divergentes. Conversas brutas, logs, estado visual e dados necessários à execução/recuperação ficam no armazenamento interno do Office.
- Preservar a edição da usuária quando concorrer com uma proposta de agente; apresentar reconciliação, sem sobrescrever/mesclar silenciosamente. Mudanças em tickets ativos exigem avaliação de seu efeito no trabalho autorizado.
- Renomear uma lista da trilha reflete na estante. Remover a lista deixa seus vínculos em **Sem tópico**, sem apagar fontes, notas ou cartões. Mudanças ambíguas exigem confirmação.
- Exclusões feitas no Obsidian (Q74, aprovada): o Office respeita a exclusão e sinaliza os vínculos que ficaram sem origem (por exemplo, um cartão cuja nota sumiu), sem recriar o documento nem apagar registros relacionados. Restaurar exige ação da usuária, a partir do histórico ou de backup. Não confundir com a regra de remoção de listas da trilha, que manda os vínculos para Sem tópico.

## 3. Térreo e planejamento pessoal

### Espaço e personagens

- Preservar o térreo real: Sua sala, Time de agentes, Lounge, Copa e elevador. Os agentes individuais continuam nas mesas reais do time.
- **Historical:** this section used Íris and a personal office. The approved successor is the home with Luna and the spaces in `centro-de-controle-da-vida-design.md`.
- Está autorizado no design descartável reorganizar e aumentar Sua sala, diminuindo a Copa; manter o restante do térreo. Não bloquear a circulação até a porta.
- As listas pessoais seguem `tarefas.md`. Casa, Saúde, Finanças, Trabalho e Leituras são exemplos fictícios de apresentação, não novas categorias obrigatórias.

### Barra inferior e quadros

Mostrar a barra completa: Eu (retrato e nome), separador, Novo agente, **Tarefas em foco**, Caixa de entrada, Quadro de tickets, Relatórios, Central de resume, Ir para minha sala, Claude FM e Configurações. Itens existentes fora do escopo da prévia mostram somente aviso simulado.

- Novo agente mantém o destaque principal existente.
- Tarefas em foco: ícone de alfinete com contador, dica **Tarefas em foco (F)**, atalho F. Inicialmente só ícone/contador; avaliar descobribilidade no design, sem alterar silenciosamente para outro padrão.
- Manter os atalhos I, T e R para caixa de entrada, tickets e relatórios. Atalhos não devem disparar ao digitar em campos.
- **Revisão não entra na barra inferior**: abre pela secretária ou pelo quadro de parede.
- O quadro Tarefas tem uma coluna por lista canônica. Clicar nos quadros abre painéis dos mesmos registros, não cópias.

### Popup Tarefas em foco

- Formato do quadro real de tickets: cabeçalho com ícone, título e contagem; uma única coluna; cartões verticais com rolagem. Não criar colunas de status.
- Cada cartão representa a mesma tarefa canônica: título, lista de origem em chip, tirar do foco e **Passo de hoje** opcional, distinto da tarefa inteira.
- Caixa de marcação para **a usuária** concluir a tarefa; a secretária nunca a conclui. Rótulo acessível: `Marcar “<tarefa>” como concluída`.
- Ao marcar, mostrar o estado concluído (riscado/esmaecido), retirar do foco e manter a mesma tarefa concluída no quadro Tarefas, sem duplicação, com opção de desfazer. O momento/transição da retirada deve ser resolvido visualmente sem perder a confirmação acessível.
- Estado vazio com **Abrir quadro Tarefas** e fechamento claro. Abrir pelo botão/F; fechar por Esc ou clique fora.
- Foco persiste entre dias até conclusão/retirada explícita. Não significa terminar hoje, não é limpo na virada do dia e não controla lotes dos andares.
- Timer de 25 minutos compartilhado entre foco/atividade, sem conclusão automática se expirar com o aplicativo fechado. Demais detalhes de pausa/recuperação ainda precisam ser especificados.

## 4. Secretária, agenda e revisão diária

- Íris ajuda com agenda, revisão, foco e acompanhamento; propõe alterações, não aprova entregas nem conclui tarefas. Alterações consequenciais exigem confirmação; pedidos diretos completos autorizam somente a ação correspondente.
- Agenda inicialmente local no vault; compromissos/blocos planejados não equivalem a tarefa concluída ou tempo realizado. Integrações externas não foram autorizadas por consequência.
- Na primeira entrada do dia no app, oferecer **Começar**, **Adiar por dias** (1, 2, 3 dias ou 1 semana) e **Dispensar hoje**. Esc na oferta também dispensa hoje. Trata-se de gatilho de entrada diária, não cron por horário, nem comprovação de um sistema de login implementado.
- Adiamento suspende a oferta automática até a data; na primeira entrada a partir dela, apresentar um panorama atualizado, sem acúmulo de revisões passadas. A revisão continua acessível manualmente. Não silenciar prazos ou pedidos de aprovação dos agentes.
- Preparação inicial local, sem IA. Começar abre os passos procedimentais da revisão, também sem IA (G5). Reabrir no mesmo dia não reinicia a oferta inteira.
- Íris pode consultar resumos operacionais de todos os andares: andamento, bloqueios e decisões esperando a usuária. Não recebe automaticamente código, fontes, notas ou conversas. Isso não dá acesso cruzado aos diretores.

### Fluxo vigente: quatro passos e confirmação final

Cada passo tem a faixa **O que fazer agora**:

1. **Agenda:** somente leitura nesse fluxo.
2. **Foco:** Continuar, Reagendar, Revisar ou Descartar em cada tarefa; Continuar pode incluir Passo de hoje. Reagendar oferece Amanhã, Em 3 dias e Próxima semana. Íris pode sugerir tarefa fora do foco (exemplo fictício: sem avanço há 12 dias), com Pôr em foco/Deixar como está. Isso não define limiar obrigatório de abandono.
3. **Estudos e andares:** somente leitura, sem iniciar estudo, distribuir lotes ou executar trabalho.
4. **Confirmar:** mostrar a lista exata das mudanças propostas; aplicar somente após confirmação.

**Nada muda nos documentos antes da confirmação final. Fechar sem terminar não aplica nada.** Esse requisito substitui o aceite anterior de salvar cada decisão durante os passos. Eventual retenção de rascunho não pode ser confundida com aplicação das mudanças e ainda não tem contrato definido.

Descartar é diferente de concluir. Concluir a revisão não conclui tarefas/tickets. Sinais de abandono são sugestões, não fatos sobre a intenção da usuária. Reagendamento da agenda fora desse fluxo continua sujeito a pedido direto ou confirmação.

## 5. Andares de projetos ou áreas de trabalho

### Organização visual e ciclo de criação

- Um conjunto próprio de tickets por andar. Sala do diretor no centro; salas dos squads ao redor. Diretor acessa somente tickets do seu andar; Malu pode consultar todos.
- **Ferramentas da diretora de projetos (Emi):** usa o kit de skills do Matt Pocock (`mattpocock/skills`), na sequência **grill-with-docs → to-spec → to-tickets**. Cada etapa termina com aprovação da usuária antes da próxima: spec aprovada antes de tickets; tickets aprovados antes da proposta de squads.
- **Kit instalado:** clonado de `github.com/mattpocock/skills`; as 31 skills de engenharia, produtividade e diversos já estão em `C:\Users\Malu\.agents\skills`, idênticas ao repositório. `in-progress` não foi instalado. A cópia global `~/.config/opencode/skills/grill-with-docs` foi sincronizada com a versão do kit. A versão global de `grilling` é personalizada e foi preservada.
- **Local das specs (aprovado, Q1):** cada spec fica no vault, na pasta do andar ao lado dos tickets, em formato Markdown editável, como já definido para os tickets (Q21).
- A diretora não cria squads por conta própria nem executa tickets em nome das equipes; suas saídas são documentos para aprovação.
- Preservar o design aprovado da **Loja Aurora**: salas, diretoria central, rótulos e popups. Não diminuir nem remobiliar a diretoria dos projetos por causa do pedido referente a Bonnie.
- Entrada com elevador, quadro de tickets/lotes e área de descanso mobiliada (sofás, poltronas, mesas, luminárias, plantas e bebedouro). Essa área já foi feita/aprovada segundo relato de Malu; não redesenhar.
- Acrescentar **mini cozinha na parte oposta à área de descanso**, na mesma entrada: balcão, geladeira, cafeteira, micro-ondas, mesa de bar e banquetas, usando móveis reais.
- Salas existentes sem squad: mesma estrutura aprovada, ambiente/piso e vidro mais escuros, luz apagada, telas desligadas, sem pessoas e rótulo **Sem squad**. Não escurecer salas com equipe atribuída nem tratar equipe ociosa como ausência de squad.

Um andar novo segue esta ordem:

1. Criar somente a sala central do diretor, sem squads obrigatórios ou salas de squad previamente construídas.
2. Diretor procura Malu para compreender o projeto.
3. Conduzir grill-with-docs, esclarecer decisões e registrar o que foi aprovado.
4. Preparar spec e obter aprovação.
5. Preparar tickets com critérios e dependências a partir da spec aprovada; obter aprovação.
6. Propor squads necessários a partir dos tickets: responsabilidades, integrantes, modelos e capacidade.
7. Após aprovação da composição, configurar as equipes e criar suas salas.
8. Preparar lotes e obter início explícito da distribuição.

Mostrar vistas diferentes: **só diretoria**; **salas já existentes sem squad, apagadas**; **equipes propostas, aprovadas/configuradas e executando**. Não confundir ausência de construção com sala construída desocupada. O antigo pedido de andar sem salas de squad não remove a diretoria. A escolha simulada de modelo em Projeto novo não pode pular spec/tickets/aprovações.

### Lotes, equipes e conclusão

- Lotes nomeados por andar: Preparado, Liberado, Pausado e Encerrado. Seleção não executa; **Iniciar distribuição** libera o conjunto selecionado. Novos tickets requerem liberação explícita.
- Um ticket pode estar em seleções diferentes, mas não executar em duplicidade. Diretor pode propor tickets no backlog, nunca inseri-los automaticamente num lote liberado.
- Modelos de squad são reutilizáveis/personalizáveis, inclusive para trabalho não relacionado a desenvolvimento. Diretor distribui às equipes compatíveis; coordenador organiza o trabalho interno.
- Um ticket ativo por squad; equipe permanece reservada até finalizar, inclusive quando bloqueada ou esperando aceite. Espera não gera chamadas contínuas de IA. **Suspender e liberar equipe** é exceção acionada por Malu, com contexto preservado e ticket pendente.
- Estados com texto e cores reais: trabalhando/verde; aguardando minha decisão/âmbar; bloqueado/vermelho; disponível/cinza. Configuração e execução não são o mesmo estado.
- Desenvolvimento: coordenador, implementador e revisor independente; worktree e branch por ticket. Diretor respeita dependências e evita executar trabalho dependente de mudanças ainda não integradas.
- Revisor registra problemas, não corrige o que está revisando. Responsável corrige e submete novamente; limite de rodadas configurável, com pausa ao atingir. Valor ainda aberto.
- Conclusão de desenvolvimento exige critérios, testes, revisão, aprovação humana da versão e merge confirmado. Diretor aciona operação controlada pelo Office; verificar novamente testes/conflitos/versão. Mudanças após aprovação exigem nova aprovação.
- Outros squads entregam documentos no vault vinculados ao ticket, inicialmente rascunho/aguardando aceite. Não substituir documentos silenciosamente; concluir após critérios e aceite explícito, registrando a versão aceita.
- Remover sala/desativar equipe não apaga histórico; equipe desativada não recebe novos trabalhos. Limite de salas e apresentação de andares grandes ainda dependem do design.

## 6. Andar de estudos: tópico, não tickets

**Um tópico em estudo por vez. Não existem tickets, lotes ou filas de distribuição nesse andar, nem para criar cartões.** Esse princípio substitui as propostas Q35/Q38 de criação/liberação de tickets de atendimento. A reserva/conclusão de equipes por ticket dos projetos não deve ser aplicada automaticamente ao estudo; detalhes de disponibilidade durante pausa continuam abertos.

### Tópico e percurso

- Tópico escolhido na trilha canônica. Mostrar tópico atual, contexto na trilha, etapa, próxima ação e iniciar/pausar/retomar. Não é kanban e não se confunde com foco pessoal.
- Trocar tópico preserva trabalho anterior, sem concluir automaticamente ou perder notas. Regras finas de disponibilidade dos professores na troca ainda precisam de definição.
- Ciclo: **Diagnóstico → erros e dúvidas → prática e fontes direcionadas → notas → reteste**. Diagnóstico antes de leitura obrigatória; erros orientam próximos passos. Pausa preserva o contexto.
- Preferência ENEM → livros → concursos → IA entre questões adequadas com gabaritos conferidos. Origem identificável; variação gerada por IA não vira questão de livro. Informar ausência de questão elegível.
- Divergências: **Em verificação**, sem contar como erro/acerto. Procurar solução nas fontes permitidas; se necessário substituir questão inválida de reteste, sem reduzir o mínimo.
- Padrão: 80% em pelo menos dez questões novas de reteste, sem ajuda e com gabaritos validados, ajustável antes do ciclo. Conclusão com confirmação da estudante; sem projeto final obrigatório, domínio automático ou cartões obrigatórios.
- Agentes ajudam; suas atividades não são evidência de aprendizado. As respostas da estudante são a evidência.

### Biblioteca e Cora

- Biblioteca representa study sources; estantes seguem os títulos das listas da trilha. Uma fonte pode estar em várias estantes sem duplicação; IA sugere associações, Malu confirma. Sem classificação: **Sem tópico**.
- Manter **Cora**, bibliotecária em mesa própria. Conversar abre chat simulado para busca por obra, tópico, autor e disciplina, além de perguntas sobre o catálogo. A prévia consulta somente catálogo fictício, não conteúdo de fontes, nem concede acesso aos agentes.
- Manter estantes sem balões fixos; ao passar o mouse, acender e mostrar tópico/contagem. Clique abre a estante. Alternativa de teclado: **Ver estantes** no chat. Acrescentar mais estantes.
- Ao abrir estante/livro, usar lombadas/capas em pixel art de baixa resolução, bordas em degraus, paleta real e `image-rendering: pixelated`, não botões lisos modernos.
- Ficha: título, tópicos, localização, notas/cartões relacionados, **Abrir original** e **Disponibilizar para uma equipe**. Abrir não inicia IA nem concede acesso.
- Na operação futura, aprovar recorte de fontes/estantes por equipe; uso dentro do recorte sem perguntar a cada leitura. Acesso adicional exige confirmação. Prévia distingue leitura local de transmissão ao provedor; o vault inteiro não é acesso implícito.

### Sala de estudo individual: notas e cartões

- Unir fisicamente notas e cartões numa sala **menor e acolhedora**, com piso de madeira escura como a diretoria, luz quente, mesa de estudo, arquivo de notas, mesa de cartões, tapete, poltrona, luminária e plantas.
- União física não funde registros: notas, cartões e fontes continuam distintos. Preservar biblioteca e demais partes aprovadas fora do redesign explícito.
- Notas: iniciar por tópico sem diagnóstico obrigatório, registrar no ciclo, retomar/editar a mesma nota e consultar uma coleção única, sem cópias. Nota registrada não conclui ciclo nem comprova aprendizado.
- Cartões: **Ler notas → selecionar uma ou mais → confirmar → elaborar rascunho → salvar e aceitar**. Seleção não salva cartão; notas não são consumidas e podem alimentar vários cartões.
- Quatro seções: **Informação**, **Exemplo/Prática**, **Conexões**, **Fontes**. As duas primeiras são elaboradas com a estudante e IA; IA organiza conexões/fontes no acesso permitido, sem aprovação obrigatória por referência. Tudo editável; incertezas ficam visíveis, sem referências inventadas.
- Guardar rascunho não equivale a cartão aceito. Aceitar/salvar não comprova aprendizado, não conclui ciclo nem valida automaticamente afirmações pendentes.
- Guardar a versão das notas usada e o vínculo à nota atual; mudança posterior sinaliza **Origem alterada**, sem reescrita silenciosa. Atualizar exige escolha de Malu.

### Sala de aula e sala dos professores

- Squad de estudos: coordenador, tutor, curador e verificador. Squad de cartões: coordenador, assistente de elaboração e verificador de fontes/conexões.
- Retirar as equipes trabalhando em mesas da sala de aula. Ela passa a ter lousa/quadro, carteiras e lugar/mesa da estudante, mostrando tópico e etapa atuais.
- Integrantes ficam na **sala dos professores** e são chamados quando participam da etapa. Exemplos visuais pedidos: tutor no diagnóstico/erros; curador na prática/fontes; verificador no reteste; equipe de cartões quando a estudante cria cartões. Não inventar um escalonador automático já aprovado a partir desses exemplos.
- Mostrar quem aguarda, quem foi chamado e a aula pausada/vazia na pausa do ciclo. A função/atividade exata da equipe de cartões fora da elaboração continua aberta; não gerar trabalho ou consumo de IA apenas por espera.

### Diretoria de estudos e Bonnie — correção final

- **Manter a sala e a diretora Bonnie.** A decisão final de Malu substitui a cautela anterior que sugeria retirar a personagem ou deixá-la a definir.
- Redesenhar **essa diretoria** menor e com mais móveis: sofá, estante, mesa de apoio, tapete, luminária, plantas e quadro de parede. Manter piso de madeira escura atual.
- A função de Bonnie (Q75, aprovada): **continuidade pedagógica** — apresentar o tópico atual, progresso e dificuldades, sugerir o próximo passo e propor ajustes de percurso ou de professores. Não substitui o tutor, não toca em tarefas pessoais e não cria tickets, lotes ou filas. Mudanças de tópico ou critério dependem de confirmação da usuária.
- A usuária declarou não ter preferência se a função ficar restrita à presença de coordenação. Até detalhamento, prevalece a versão mínima: presença de coordenação, sem ações pedagógicas automáticas.
- Pergunta respondida na Q75 (ver acima). Não alterar as outras diretorias por esse pedido.

## 7. Caixa de entrada e orçamento

- Reutilizar caixa de entrada do Office para entregas e decisões, identificando andar/ticket/equipe quando se tratar de projeto. Íris resume pendências, nunca aprova por Malu. Estudo não ganha ticket para aparecer no acompanhamento.
- Motor único: **Claude**. Squads mistos e escolha de motor por integrante estão fora do escopo. O modelo de squad configura modelo e conta do Claude por integrante, ajustável antes de iniciar ticket; exibir discretamente. Na prévia, tudo é simulado.
- **Historical:** the 2026-10-16 possibility of integrating OpenCode was superseded on 2026-10-21. Ticket 14 and its spec/plans are archived; preserve session/result/log/usage data read-only, and never resume unfinished OpenCode work without explicit user choice.
- Os testes de conexão feitos durante a sessão (Codex e OpenCode) ficam apenas como histórico e não definem contrato nem próxima etapa.
- Teste sintético local confirmou no Codex: resposta, streaming, negação de ferramenta sem criar arquivo, cancelamento e retomada com marcador. OpenCode confirmou resposta, negação, cancelamento e retomada; streaming externo não foi validado, e tentativa HTTP direta retornou 401. Isso não prova defeito do OpenCode nem isolamento entre andares do Office.
- Evidências temporárias da sessão: `C:\Users\Malu\AppData\Local\Temp\opencode\ao-provider-probe\results.json`. Não são artefato de release nem contrato implementado; sua disponibilidade futura não é garantida.
- Teto configurável por atendimento/ticket, com aviso antes de atingir e pausa no limite. Valores, limites de simultaneidade e medição de assinatura versus custo ainda abertos. Não declarar custo zero como ausência de consumo.
- Esgotamento de quota: pausar e pedir decisão entre esperar/substituir. Não trocar automaticamente modelo/provedor/conta. Handoff com decisões, artefatos e pendências; não presumir transferência integral da conversa.

### Painéis dos agentes (Q77–Q79)

- **Preservar os popups e painéis existentes.** Acrescentar somente o conteúdo necessário aos novos papéis, reutilizando os componentes visuais do Office para manter coesão estética com os antigos.
- Estrutura comum, conteúdo conforme o papel: identificação, situação atual, próxima ação, conversa, trabalho relacionado e detalhes recolhidos (motor, modelo, conta, consumo, histórico técnico). Tickets e controles de diretor não aparecem em papéis de estudo nem em agentes que não os têm.
- Ao abrir, mostrar um resumo curto da situação e a conversa, destacando a decisão pendente quando houver. Detalhes técnicos não dominam a abertura. Não exigir exibição de raciocínio interno; mostrar ações, justificativas e evidências úteis.
- Malu pode conversar com qualquer integrante de um squad. Um pedido que altere escopo ou redistribua trabalho **vira proposta ao responsável correto, não execução paralela**. Quando o pedido sai do escopo do agente, ele o encaminha ao responsável adequado e informa Malu. O encaminhamento não amplia permissões nem pula aprovações; nos estudos, mudar tópico ou critério exige confirmação explícita.
- Conversar não substitui ações estruturadas: aprovar spec, entrega, merge, conclusão de ciclo ou aceite de cartão continuam nos controles próprios; respostas de estudo são dadas na atividade, não no chat.
- Referência visual histórica: a galeria dos 15 papéis e exports foram movidos para `D:\Documents\agent-office-arquivo\claude-design-legado-2026-10-22\`; não fazem parte do design vigente. A prévia atual permanece em `claude design/proto/`.

### Fontes externas (Q73) e tópicos (Q76)

- Pesquisa externa fica **desabilitada por padrão**; a biblioteca autorizada é a fonte padrão. Habilitar pesquisa externa é explícito, por atendimento de estudo ou ticket de projeto. Encontrar uma fonte não autoriza baixar, importar ou enviar documentos a outro serviço; fontes externas mostram origem e o que foi efetivamente conferido.
- Um tópico ativo por vez, com vários percursos pausados preservados. Ao voltar a um tópico, Malu escolhe retomar o percurso existente ou iniciar novo diagnóstico. Notas, respostas e cartões anteriores continuam acessíveis; a troca não conclui nem reinicia nada silenciosamente.

## 8. Contrato da prévia visual descartável

### Escopo e método preservado

- Somente proposta visual/protótipo descartável; parar para avaliação ao final. Não editar `src/`, instalar dependências, operar Git ou publicar. Não iniciar modelo real nem ler fontes privadas para preencher exemplos.
- Não redesenhar o que já foi aprovado ou não foi pedido. Não substituir o Office por dashboard genérico. Interface pt-BR; dados fictícios e etiqueta **SIMULADO**.
- A primeira tentativa de canvas/SVG manual foi rejeitada por divergir do app, conforme relato de Malu. Método aprovado: reutilizar módulos e CSS reais em página descartável.
- Diretório existente: `D:\Documents\agent-office\claude design\proto`, com `index.html`, `vite.config.ts`, `main.ts`, `scenes.ts`, `proto.css`. Nesta atualização documental foram verificados os nomes dos arquivos e a configuração Vite; não se executou/validou a prévia.
- Vite já existente em node_modules, porta 5199, host 127.0.0.1, fs.allow na raiz e alias `@shared` → `src/shared`. Comando de referência, não executado nesta atualização:

```powershell
Set-Location -LiteralPath 'D:\Documents\agent-office'
node node_modules/vite/bin/vite.js --config 'claude design/proto/vite.config.ts' --host 127.0.0.1
```

- Reutilizar `world/engine` (Engine, pixelSize 3, zoom mínimo, jumpTo(16,12.5)), furniture (`F.*`), avatar (Avatar, poses sit/type/stand/talk), kit (box/panel), office (buildOffice/buildShell/buildPartitions), workstation, screens (Screen/LoopScreen), textures (rugTexture/WindowSky), layout (DESKS/ZONES/W=32/H=24). Conferir APIs reais antes de editar o protótipo.
- Térreo ampliado deve ser variante/cópia adaptada de buildOffice **no código descartável**, não alteração de src. Reutilizar paleta real de móveis/avatares.
- Reusar `src/renderer/src/styles/index.css`, `h()`/`icon()` de `ui/dom.ts`; `proto.css` só adiciona extras novos. Rótulos fixos do mundo seguem tag-pill. Recarregar com cache-bust `?v=N` quando necessário, conforme orientação do trabalho visual.

### Componentes reais e acessibilidade

- Classes de referência: `dock card`, `dock-btn`, `dock-primary`, `badge`, `floors card`, `floor-btn`; `board card`, `board-head`, `board-body`, `board-cols`, `tcol`, `tcol-head`, `tcol-list`, `tcard`, `tcard-top`, `tcard-title`, `tcard-foot`, `tfloor`, `ttype`; `inbox card`, `inbox-row`; `backdrop`, `modal card`, `dialog card`; `btn`, `btn-primary`, `btn-small`, `icon-btn`, `seg`, `seg-btn`, `tag`, `tag-pill`, `dot`, `zone-label`, `toasts`.
- Cores/classes reais: dot-working verde, dot-waiting âmbar pulsante, dot-done azul, dot-error vermelho, dot-idle cinza. Nunca comunicar estado somente pela cor. Respeitar movimento reduzido inclusive no pulso.
- Tarefas em foco, Tarefas e tickets/lotes usam board real; caixa de entrada usa popover inbox real. Não trocar por popups genéricos lisos.
- Popovers fecham por clique fora/Esc. Modais usam backdrop/modal real, foco preso, Esc fecha e foco retorna à origem. Na revisão, fechar antes da confirmação não aplica propostas.
- Contraste, teclado, foco visível, checkbox rotulado e alternativa de teclado ao hover/arraste. Respeitar `prefers-reduced-motion` e regras de acessibilidade existentes.

### Interações e vistas obrigatórias

1. Foco pelo botão/F; fechar por Esc/clique fora; rolagem, vazio, concluir/desfazer na mesma tarefa canônica.
2. Selecionar lote sem iniciar e depois iniciar distribuição, somente em projeto.
3. Abrir PR simulada esperando aprovação; aprovar ou pedir correção sem merge/execução real.
4. Abrir estante/livro pixelados e ficha; simular disponibilização à equipe sem conceder permissão real.
5. Abrir nota e demonstrar cinco etapas de criação de cartão, sem tickets.
6. Primeira entrada: oferta de revisão e quatro passos, mostrando proposta antes da confirmação.
7. Conversar com Cora por obra/tópico/autor/disciplina; alternativa Ver estantes.
8. Trocar tópico preservando trabalho; iniciar/pausar/retomar estudo.
9. Chamar professor para a sala de aula; mostrar espera na sala dos professores e aula vazia/pausada.
10. Andar novo: só diretoria → descoberta/spec/tickets → equipes propostas → aprovadas/configuradas → execução explicitamente iniciada.

Entregar prévia navegável e capturas do térreo, estados dos projetos e sete vistas dos estudos: geral; tópico; percurso; biblioteca/ficha; notas; seleção/elaboração de cartão; pausa/espera/verificação. Destacar o popup de foco e explicar escolhas/questões abertas. Aprovação da existência de um recurso não aceita um layout ainda não apresentado.

## 9. Histórico de correções visuais preservado

Síntese do histórico a–o fornecido por Malu. Não tratar cada linha como mandato simultâneo se foi substituída por outra posterior.

| Ordem | Pedido e efeito vigente                                                                                                                                                                                                                                               |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a     | Maior fidelidade dos popups ao app                                                                                                                                                                                                                                    |
| b     | Barra inferior completa                                                                                                                                                                                                                                               |
| c     | Botão da barra abre foco; revisão só no quadro/secretária                                                                                                                                                                                                             |
| d     | Revisão guiada mais clara sobre o que fazer                                                                                                                                                                                                                           |
| e     | Visuais dos andares de projeto e estudos aprovados; preservar partes não alteradas                                                                                                                                                                                    |
| f–g   | Secretária em outra mesa, quadros e caixa de entrada dentro de Sua sala                                                                                                                                                                                               |
| h     | Descanso mobiliado na entrada do projeto; já feito/aprovado segundo a usuária                                                                                                                                                                                         |
| i     | Notas/cartões juntos; ocupação da aula pelos squads foi depois substituída por m                                                                                                                                                                                      |
| j     | Mais clareza das estantes por hover, sem balões fixos                                                                                                                                                                                                                 |
| k     | Bibliotecária em mesa e busca por catálogo                                                                                                                                                                                                                            |
| l     | Vista sem salas de squads; a diretoria permanece conforme ciclo posterior                                                                                                                                                                                             |
| m     | Checkbox de conclusão; só salas sem squad apagadas; mais estantes/livros pixelados; sala individual menor/acolhedora; diretoria de estudos menor/mobiliada; aula de verdade e professores em sala própria; mini cozinha oposta ao descanso; Sua sala maior/Copa menor |
| n     | Correção estrutural: estudos sem tickets/lotes; projetos começam com diretor e só configuram squads após descoberta/spec/tickets/aprovação                                                                                                                            |
| o     | “Sim, é a diretora do andar de estudo que me refiro”: manter a diretora do andar de estudos (Lia, depois Bonnie); o redesign menor/mobiliado é da sua sala, não das diretorias de projeto                                                                                                                             |

## 10. Primeira entrega: decisões do grill (2026-10-16)

- **G1 — seções profissionais do `tarefas.md`:** nenhuma seção é excluída por restrição de dados profissionais. A usuária declarou que o registro do Hera que proibia a leitura de PEX e dados profissionais foi alucinação e não vale como restrição. Continuam válidas as regras de envio de conteúdo a provedores de IA (Q13), que dependem de autorização explícita.
- **G2 — identificação das tarefas (aprovado):** cada tarefa recebe um ID invisível de bloco do Obsidian (`^t…`) no fim da linha. O foco fica no estado interno do Office, não no arquivo canônico.
- **G3 — primeira entrega sem IA (aprovado):** agenda, listas, foco e decisões da revisão funcionam por botões e confirmação. A conversa assistida entra numa entrega posterior, como já definido para a criação manual de tarefas.
- **G4 — conclusão de tarefa (aprovado):** a tarefa é marcada como concluída e movida para a seção "## Archive" do `tarefas.md`, com a data de conclusão e o mesmo ID.
- **G5 — processos sem IA (aprovado sem seleção adicional):** ficam sem IA **somente os processos puramente procedimentais**, aqueles em que uma regra explícita produz o mesmo resultado. Os processos de julgamento mantêm o desenho original, com IA como ajuda.
  - **Sem IA:** passos e confirmação da revisão diária; reorganização das tarefas ao começar o dia (procedimento, não a prioridade sugerida); sinal de tarefa sem avanço há N dias; resumos operacionais dos andares; encaminhamento de pedidos por tabela fixa; busca e perguntas sobre o catálogo da Cora; verificação de respostas contra gabarito fechado; seleção de questões do banco por tópico e origem; categorias de erro escolhidas por você; reconciliação de edições no Obsidian.
  - **Mantêm IA como ajuda:** associar fontes a estantes (IA sugere, você confirma); conexões entre cartões; escolha de fontes para o cartão; escrita de Informação e Exemplo/Prática; correção de respostas abertas; sugestão de prioridade; trabalho dos squads.
  - Questões geradas por IA continuam na última posição da preferência ENEM → livros → concursos → IA, como definido.

- **G6 — data de conclusão no Obsidian (definido pela usuária):** a data em que a tarefa foi concluída fica gravada no próprio `tarefas.md`, no item do Archive, visível no Obsidian.
- **G7 — agenda editável nos dois sentidos (definido pela usuária):** a agenda pode ser alterada no Obsidian e pela secretária, que adiciona, remove e move compromissos e tarefas, sempre com autorização. Movimentar tarefas entre listas no quadro Tarefas é feito apenas pelos cartões do kanban.
- **G8 — Íris com IA (definido pela usuária):** Íris recebe IA para interpretar pedidos em linguagem natural. Ela propõe a mudança exata e só aplica após confirmação. A revisão diária continua procedural, sem IA (G5).
- **G9 — confirmações (aprovadas pela usuária):**
  - **C1:** todo pedido à Íris, inclusive os diretos, vira uma mudança exata que pede uma confirmação. A Q2 deixa de valer para pedidos diretos.
  - **C2:** datas no fim da linha do `tarefas.md`, no formato do plugin Tasks: `📅 AAAA-MM-DD` para a data programada e `✅ AAAA-MM-DD` para a conclusão, junto do ID `^t…`. Mover uma tarefa na agenda altera o `📅`.
  - **C3:** a Íris com IA entra na entrega 1. A revisão diária continua sem IA.

## 11. Substituições e questões ainda abertas

### Não reabrir decisões resolvidas

- Caminhos externos/links de sistema foram substituídos pela mudança já realizada para o vault.
- Notas/cartões em áreas fisicamente separadas foram substituídos por uma sala individual compartilhada, mantendo coleções distintas.
- Equipes trabalhando em mesas da sala de aula foram substituídas por professores aguardando em sala própria e chamados para a aula.
- Tickets/lotes de estudo e de cartões foram retirados. Regra de um ticket por squad aplica-se a projetos, não é limite de aprendizagem.
- Ausência/personagem de diretoria a definir foi substituída pela confirmação de Bonnie; sua função continua aberta.
- Salvamento aplicado por etapa da revisão foi substituído por confirmação final com lista exata das mudanças.
- Squads obrigatórios no momento da criação de um andar foram substituídos por equipes derivadas dos tickets aprovados.

### Pendências reais

1. Função de Bonnie: definida na Q75 (continuidade pedagógica, sem tickets). Detalhamento de cada ação ainda pendente; até lá, presença de coordenação.
2. Atividade/disponibilidade da equipe de cartões fora da elaboração e dos professores durante pausa/troca de tópico, sem filas de tickets.
3. Posição final da mesa de Íris sem bloquear circulação; quantidade/limites de salas/estantes e descobribilidade do botão de foco. Validar no design, sem refazer escolhas aprovadas.
4. Íris, Emi, Cora e nomes dos squads Dev Alfa/Beta, Conteúdo, Pesquisa UX, Design e Dados são nomes de apresentação/provisórios do prompt; Bonnie foi explicitamente confirmada. Não presumir essas equipes como obrigatórias para novos projetos.
5. Primeira entrega utilizável (Q72): vault + planejamento pessoal, depois estudos, depois andares de trabalho, sem integração GPT. Pesquisa externa (Q73) e exclusões no Obsidian (Q74) estão respondidas.
6. Specs e tickets do andar de projeto: no vault, na pasta do andar (aprovado).
7. Nome da diretora de projetos: definido como **Emi** (Q2 da rodada final). Nos textos gerais, o cargo segue o masculino genérico ("diretor"); o nome é Emi.
8. Política de backups/restauração do Office/vault; configuração histórica do Hera não foi adotada automaticamente.
9. Valores dos orçamentos/simultaneidade, limite de rodadas, credenciais/contas e medição de consumo de assinatura; não solicitar/copiar segredos em documentos.
10. Validação de respostas abertas, acertos parciais e cobertura do reteste; 80%/dez questões já está aprovado.
11. Detalhes de timer, interrupção/reabertura, recuperação integrada e conflitos após falhas. Os testes isolados dos motores não os qualificam automaticamente.
12. Formato, identidade e migração dos registros canônicos, inclusive histórico de tickets do Office. Escolhas técnicas reversíveis cabem à implementação após gates; mudanças de comportamento/dados exigem decisão.
13. Avaliação das novas alterações visuais, spec completa e liberação de implementação. A autorização atual cobre documentação, não código/instalações/Git/publicação.

## 12. Revisão de consistência antes do to-spec (2026-10-16)

O consolidado **não está pronto para o to-spec da primeira entrega**. Decisões pendentes, em ordem de bloqueio:

- **P1 — escopo da entrega 1 (aprovado):** entram a barra com Tarefas em foco, o quadro Tarefas, a revisão de quatro passos, o gatilho de entrada, o timer de 25 minutos dentro do popup de foco e a caixa de entrada apenas com decisões da revisão. Ficam fora a conversa com Íris, a agenda editável, estudos e projetos.
- **P2 — concluídas e descartadas (aprovado):** a concluída vai para o Archive com data e ID, e aparece no quadro Tarefas como concluída. "Reabrir" a devolve à lista de origem, mantendo o ID. A descartada também vai para o Archive, marcada como descartada e com o motivo.
- **P3 — reagendamento e passo de hoje (reaberto):** a data de uma tarefa precisa ser visível no Obsidian e editável pela secretária (G7). Fechado (C2): campo de data no próprio item do `tarefas.md`, no formato do plugin Tasks. O passo de hoje continua no estado interno.
- **P4 — agenda (reaberto por G7):** a agenda é editável no Obsidian e pela secretária, nos dois sentidos. Fechado (C2): mover uma tarefa na agenda altera o `📅` dela no `tarefas.md`. Falta apenas o formato do arquivo de agenda.
- **P5 — Íris com IA (reaberto por G8):** Íris conversa em linguagem natural e propõe mudanças. Fechado (C3): entra na entrega 1, com a revisão ainda sem IA.
- **P6 — timer:** se entra na entrega 1 e onde aparece, já que o Office não tem as rotas Hoje e Atividade do Hera.
- **P7 — backup (aprovado):** antes da primeira escrita em cada sessão, o Office salva uma cópia datada do `tarefas.md` na pasta de backups do próprio Office. Nada é apagado automaticamente.
- **P8 — gatilho do dia:** o que conta como primeira entrada (abertura do app, fuso horário, reabertura).
- **P9 — caixa de entrada na entrega 1:** quais itens entram; por exemplo, apenas decisões da revisão.

**Requisitos técnicos para o spec** (não dependem de decisão de produto):

- Preservar o frontmatter e o bloco `%% kanban:settings %%` do `tarefas.md`, alterando apenas as linhas de tarefa.
- Escrita atômica (`fs-safe`) e reconciliação se o Obsidian alterar o arquivo entre a leitura e a escrita (Q22).
- Inserir o ID `^t…` sem quebrar a leitura pelo Obsidian.
- Plataformas Windows, macOS e Linux (AGENTS.md).
- Testes: parser de tarefas, escrita sem perda de conteúdo, conflito de edição e revisão transacional.

**Não bloqueiam a entrega 1** (ficam para as entregas seguintes): estudos, notas, cartões, Cora, squads, andares de projeto, orçamentos, avaliação de respostas abertas e recuperação de trabalho de agentes.

## 13. Fechamento do grill da entrega 1 (2026-10-16)

Os pontos P1 a P9 da seção 12 estão fechados:

- **P1 (escopo), P2 (concluídas e descartadas), P3 (reagendamento), P4 (agenda), P5 (Íris com IA), P7 (backup):** ver G4, G6 a G9 e a seção 12.
- **P6 — timer (aprovado):** a contagem de 25 minutos fica no popup de foco. Ao reabrir o app, se o prazo ainda não passou, a contagem continua. Se o prazo passou com o app fechado, a sessão aparece como **interrompida, com tempo não confirmado**. Nunca é marcada como concluída automaticamente; você confirma o tempo realizado.
- **P8 — gatilho do dia (aprovado):** a primeira abertura do app em cada dia, pelo horário local do computador. Reabrir no mesmo dia não dispara a revisão de novo. Se o app já estava aberto na virada do dia, a revisão aparece na próxima ação sua no app.
- **P9 — caixa de entrada (aprovado):** mantém o funcionamento atual. Hoje ela lista itens pendentes dos agentes (permissões, perguntas, planos e resultados), com retrato, nome, chip do tipo, texto e horário. Clicar abre o item no agente; a navegação é por setas; fecha com Esc ou clique fora; o contador fica no ícone. Na entrega 1, acrescentam-se apenas as **propostas pendentes** da revisão diária e da Íris, no mesmo formato, com chip "proposta". Clicar abre a proposta para revisão, sem aceitar ou descartar direto na linha.

**Pendências técnicas que o to-spec resolve com proposta:** formato do arquivo de agenda (P4) e o que "Reabrir" faz com a data de conclusão (P2).

**Referencias:** [spec de planejamento pessoal](../specs/entrega-1-planejamento.md). Os tickets historicos que ficavam em `.scratch/entrega-1-planejamento/issues/` foram movidos para `D:\Documents\agent-office-arquivo\scratch-legado-2026-10-22\`; nao sao uma fila ativa. Para a direcao atual do produto, use `../specs/centro-de-controle-da-vida-design.md` e `../specs/centro-de-controle-da-vida-plano.md`.

**Autorização de implementação (2026-10-16, pedido da usuária):** a implementação dos tickets com status `ready-for-agent` será feita com o próprio Agent Office, em worktree e branch separados por ticket. Escopo da autorização: criar worktrees e branches, implementar e rodar as verificações. **Não inclui merge, push, publicação, mudança de versão nem release**, que exigem aprovação separada. Tickets `awaiting-decision` só começam depois da decisão do ponto pendente indicado em cada um.

Próxima atividade: usar este consolidado no trabalho visual já em curso com Claude Code; apresentar somente decisões abertas, sem refazer a entrevista inteira. Preservar o protótipo e os arquivos de outros agentes; não contar instruções ou exemplos simulados como evidência de funcionamento de produção.
