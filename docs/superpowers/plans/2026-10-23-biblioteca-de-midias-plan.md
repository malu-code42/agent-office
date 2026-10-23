# Plano de implementação — biblioteca de mídias

**Design aprovado:** `docs/superpowers/specs/2026-10-23-biblioteca-de-midias-design.md`
**Issue:** #45
**Execução preferida pela usuária:** Luna em todas as fases; implementação e revisão em contextos separados
**Branch de trabalho:** `agent/ticket45-midias`
**Base:** `origin/main` no commit `5f9963036525f3628ea036be374c336eee620fdb`

## Guardrails

- Não acessar, copiar, indexar ou testar `D:\Documents\vault-agent-office`. Criar vaults sintéticos em diretórios temporários.
- Não fazer chamadas Letterboxd, TMDB, scraping, downloads de imagens ou envios de pôster a modelos.
- Usar o vault configurado pelo Agent Office apenas em runtime real; armazenar pôsteres somente depois de confirmação explícita.
- Não escrever campos de mídia em `tarefas.md` nem criar tarefas/recorrências por causa de itens de mídia.
- Nunca alterar o mundo 3D, planta ou mobília.
- Preservar o fluxo atual de prévia/envio da Luna; mudanças ficam sem efeito até a confirmação no editor da biblioteca.
- Manter `main` intacta. Implementar e testar somente na worktree `ticket45-midias`.
- Stage apenas os arquivos deste ticket. Push/PR com a conta `malu-code42`; sem merge.

## Fases

### 1. Contratos e codecs puros

- Criar tipos discriminados para livro, filme e jogo, estados, campos específicos e referência opcional a compromisso da agenda.
- Criar codecs para `livros.md`, `filmes.md` e `jogos.md`, com IDs estáveis, validação de campos, round-trip, CRLF e preservação de linhas/conteúdo desconhecidos.
- Modelar livro com `pagesRead >= 0` e `totalPages` opcional; estado não muda automaticamente quando páginas lidas alcançam o total.
- Modelar filme com status e caminho relativo opcional de pôster, sem progresso numérico.
- Modelar jogo com status, `favorite` e `platinum`; marcar platina implica estado concluído; desmarcar platina não reabre.
- Testes puros cobrem defaults, IDs repetidos, campo inválido, progresso, limite de páginas e a regra de platina.

### 2. Persistência segura de mídia

- Implementar writer principal em `src/main/media-write.ts` para leitura, criação, atualização e vínculo com agenda.
- Ao abrir, guardar o snapshot de cada Markdown; antes de gravar, reler e recusar conflito se o conteúdo mudou no Obsidian.
- Fazer backup datado sem sobrescrever cópias existentes e usar `writeFileAtomic` para Markdown.
- Validar a referência de agenda por data/hora/título e persistir apenas a referência; não alterar `agenda.md` nem atualizar mídia automaticamente.
- Implementar cópia de pôster para `midias/posters/<id>.<ext>` com escrita atômica, caminho relativo, validação de contenção no vault e limpeza compensatória se a gravação do registro falhar.
- Testes em diretórios temporários cobrem backup, conflito, falha de escrita, preservação de conteúdo desconhecido, path traversal/symlink e poster sem registro órfão em falhas tratáveis.

### 3. Seletor seguro de pôster

- Criar IPC tipado para abrir seletor nativo de PNG/JPEG/WebP e devolver um token de uso único, resumo do arquivo e preview temporário; não expor caminho arbitrário ao renderer.
- O processo principal lê e valida assinatura real, extensão e limite de 10 MiB; manter bytes apenas em memória até a confirmação.
- O renderer pode pedir descarte do token; cancelar/fechar modal limpa dados temporários.
- Confirmar token de uso único na gravação; token inexistente, expirado ou reutilizado falha sem gravar.
- Testes cobrem cancelamento, formatos válidos/inválidos, limite, token único, descarte e nenhuma escrita antes de confirmar.

### 4. Rascunhos de mídia pela Luna

- Adicionar uma união `mediaDraft` tipada em `IrisAnswer`/`IrisResult`, com apenas tipo e título sugeridos. A resposta do modelo não contém caminho, bytes de imagem nem comandos de gravação.
- Estender o schema Zod e validadores: tipo permitido, título em uma linha e limite de tamanho; resposta ambígua continua sendo pergunta.
- Propagar o resultado pelo `IrisDesk` e IPC ao renderer sem persistir rascunho em `planning.json`.
- Após `sendIris`, abrir editor local já preenchido; a usuária corrige campos, escolhe pôster se o item for filme e confirma a inclusão.
- Cancelar o editor ou uma resposta/pergunta da Luna não escreve nos arquivos de mídia.
- Testes cobrem os três tipos, título inválido, tipo inválido, ambiguidade, cancelamento, conteúdo do contexto e ausência de side effect pré-confirmação.

### 5. Catálogo e editor na UI existente

- Adicionar comando `Mídias` na superfície atual do quadro Tarefas e abrir uma view/modal para Livros, Filmes e Jogos.
- Exibir estados vazio, carregamento e erro; cards/listas usam os componentes/tokens existentes, sem mudanças de andar.
- Filmes mostram pôster local ou placeholder; leitura usa API do processo principal que valida o caminho relativo sob o vault e retorna conteúdo de imagem seguro, sem `file://` arbitrário.
- Formulários suportam criação e edição: páginas/total de livros, estado de filmes e favorito/platina de jogos; vínculo opcional à agenda.
- Ao atingir todas as páginas de um livro, oferecer “Marcar concluído?” e gravar apenas após confirmação.
- Atualizações ligadas a compromisso da agenda exigem confirmação; não há mudança automática por data/evento.
- Testar IPC, foco/teclado, mensagens de erro e layout com valores longos/imagens ausentes. Executar QA visual manual da janela Electron com vault sintético antes do PR.

### 6. Integração, revisão e entrega

- Ligar dependências em `main/index.ts`, preload e `OfficeAPI`; validar todo IPC no main; manter writers fora do renderer.
- Conferir que os três Markdown são incluídos nos backups/export/import com validação de schema; poster permanece relativo dentro do vault.
- Verificação obrigatória: typecheck, ESLint dos arquivos tocados (binário do root se o wrapper falhar na worktree), testes focados, suíte completa, build, `git diff --check` e QA visual.
- Registrar separadamente a falha preexistente `test/delegate-archive.test.ts` se persistir.
- Luna implementa; outra sessão/contexto Luna revisa o diff independentemente. Corrigir achados e repetir revisão.
- Commit em português, presente, terceira pessoa, sem prefixo convencional ou ponto final. Push da branch e PR para `main`, relacionando #45. Nunca mergear.

## Critérios de conclusão

- Cada item é salvo num arquivo do tipo correto, sem perder linhas desconhecidas nem sobrescrever edição concorrente.
- Livros usam páginas; filmes usam status e pôster fornecido localmente; jogos usam status/favorito/platina conforme o design aprovado.
- Todos os rascunhos da Luna e seleções de pôster aguardam confirmação; cancelar deixa dados inalterados.
- Pôsteres nunca são buscados na rede nem enviados a modelos, e caminhos fora do vault são recusados.
- Agenda permanece sem mutações automáticas; arquivos de tarefas permanecem inalterados por operações de mídia.
- Testes não abrem vault real; PR fica sem merge.

## Pendências humanas antes da implementação

- Revisão/aprovação desta especificação e deste plano pela usuária.
- Depois da aprovação, confirmar a execução deste plano por Luna na worktree atual. A seleção de Luna para todas as fases já foi solicitada; nenhuma implementação começa até a aprovação explícita do plano.
