# Biblioteca de mídias com pôsteres locais — design

**Issue:** #45
**Parent:** #38 — Agent Office como centro de controle da vida
**Status:** proposta de design para revisão da usuária
**Data:** 2026-10-23

## Objetivo

Manter no vault escolhido bibliotecas editáveis de livros, filmes e jogos, acessíveis numa
visualização existente do Agent Office. A Luna pode preparar rascunhos de novos itens; nenhuma
alteração é gravada até a usuária conferir e confirmar. Filmes podem ter pôsteres escolhidos pela
usuária e guardados junto ao vault.

## Decisões aprovadas pela usuária

- Cada categoria tem seu próprio Markdown editável: `livros.md`, `filmes.md` e `jogos.md`.
- Livros medem progresso por páginas lidas e total de páginas.
- Filmes são incluídos por um pedido à Luna; não há login nem sincronização com Letterboxd.
- O pôster de um filme é fornecido localmente pela usuária. A imagem é copiada para o vault e
  exibida na biblioteca; cancelar a seleção deixa o item sem pôster, com placeholder.
- Jogos têm estado, indicador de favorito e indicador de platina. Marcar como platinado também
  marca como concluído; desmarcar a platina não reabre o jogo.
- Todos os tipos podem ser propostos pela Luna. O rascunho é editável antes da gravação.
- Novos itens começam em `planejado`; páginas lidas começam em zero e total de páginas pode ser
  desconhecido; favorito, platina e pôster começam vazios/falsos.
- Um item pode ter vínculo opcional a um compromisso da agenda. O vínculo nunca cria tarefa ou
  recorrência. Progresso/estado relacionado à agenda só muda após confirmação explícita.
- Não há mudanças de planta, geometria ou aparência dos andares. Nenhum teste acessa o vault real.

## Abordagem escolhida

Estender a resposta tipada da Luna com um **rascunho de mídia especializado**, sem acrescentar
operações de mídia ao executor de propostas de tarefas e agenda. A resposta da Luna apenas
preenche um formulário local; não escreve nos arquivos.

O fluxo de inclusão é:

1. A usuária escreve o pedido no fluxo normal da Luna, revisa o contexto e escolhe enviá-lo.
2. Quando a resposta identifica um novo item, a Luna devolve tipo e título num rascunho validado.
3. O Agent Office abre o editor apropriado, pré-preenchido e ainda não salvo. O editor permite
   corrigir o título, estado e campos específicos do tipo.
4. Para filmes, a usuária pode abrir o seletor nativo, conferir uma prévia do arquivo e anexá-lo.
   A cópia para o vault acontece somente quando ela confirma a gravação do rascunho.
5. Cancelar o editor não altera arquivos. Cancelar apenas o seletor deixa o pôster vazio e permite
   salvar o filme com placeholder.

Livros e jogos também podem ser propostos pela Luna, mas seus campos são preenchidos e confirmados
no mesmo editor local. O catálogo permite criar e editar os três tipos sem conversa com a Luna.

## Modelo e armazenamento

Cada Markdown tem uma seção por item, com ID estável e campos conhecidos por um codec puro que
preserva linhas e conteúdo desconhecidos. Os campos mínimos são:

- **Livro:** ID, título, estado, páginas lidas, total opcional e vínculo(s) opcional(is) à agenda.
- **Filme:** ID, título, estado, caminho relativo opcional do pôster e vínculo(s) opcional(is) à
  agenda. Não há progresso numérico nem integração Letterboxd neste escopo.
- **Jogo:** ID, título, estado, favorito, platinado e vínculo(s) opcional(is) à agenda.

Pôsteres ficam em `midias/posters/<id>.<ext>` no vault. `filmes.md` contém somente o caminho
relativo, compatível com o vault editável e sincronizável. O renderer não recebe nem abre caminhos
de arquivo arbitrários: o processo principal valida o arquivo e entrega conteúdo visual por uma
API tipada.

Writers dedicados leem novamente o arquivo antes de gravar, comparam o conteúdo lido anteriormente,
criam backup datado sem substituir cópias existentes e escrevem atomicamente. Se o arquivo mudou no
Obsidian, a gravação é recusada e a usuária precisa reler/reconciliar. A criação do pôster e do
registro é uma operação coordenada: o registro nunca deve apontar para um pôster que falhou ao ser
copiado; se a gravação do registro falhar após copiar a imagem, o arquivo novo é removido quando
possível. Um desligamento abrupto nesse intervalo pode deixar um pôster não referenciado, mas não
corrompe o Markdown.

O vínculo de agenda guarda a referência exata do compromisso (data, hora e título). Não há alteração
automática ao chegar a data nem ao abrir a agenda. A usuária faz a alteração de progresso/estado no
editor e confirma a gravação.

## Fronteira de pôsteres e segurança

- O seletor nativo aceita PNG, JPEG e WebP até 10 MiB. O processo principal valida assinatura real
  do arquivo, tamanho e extensão antes de mantê-lo temporariamente em memória.
- A seleção usa um token curto de uso único. O renderer não envia um caminho de arquivo arbitrário
  ao processo principal. O conteúdo é copiado apenas após a confirmação do item.
- Os bytes do pôster nunca são incluídos no contexto enviado à Luna/Claude. Nenhum serviço remoto,
  Letterboxd, TMDB, scraper ou gerador de imagens é chamado.
- A leitura para exibição confirma que o caminho relativo continua dentro do vault selecionado e
  que o arquivo é uma imagem aprovada. Falha de validação resulta em placeholder e mensagem
  segura, sem leitura externa.
- Todas as entradas de IPC são `unknown` e passam por esquemas Zod. Os testes usam títulos, IDs e
  imagens sintéticos.

## Interface e estados

Um comando `Mídias` na superfície já existente abre a biblioteca, sem modificar o mundo 3D. Ela
mostra três categorias e estados vazio/carregando/erro, permite criar/editar e exibe pôsteres dos
filmes; filmes sem imagem usam placeholder. A composição visual segue os tokens e componentes
existentes do app.

Estados permitidos: `planejado`, `em andamento` e `concluído` para os três tipos. Páginas lidas não
podem ser negativas nem exceder o total conhecido. Se as páginas lidas igualarem o total, a
interface oferece marcar como concluído; não muda o estado sem a confirmação. Para jogos, marcar
platinado conclui; desmarcar a platina mantém o estado concluído.

## Testes e verificação

- Round-trip dos três codecs, CRLF, linhas desconhecidas, IDs duplicados e texto inválido.
- Campos por tipo, defaults, limites de páginas e regra de platina.
- Progresso de livro, estado de filme e edição de vínculos sem criar tarefas/recorrências.
- Stale-check concorrente, backup datado não sobrescrito, escrita atômica e falha sem perda do
  arquivo atual.
- Rascunhos tipados da Luna para livro/filme/jogo; pergunta quando tipo/título é ambíguo; cancelar
  o rascunho deixa os três arquivos inalterados.
- Pôster: seletor cancelado, tipo/tamanho inválido, token reutilizado, path traversal, symlink,
  gravação confirmada, rollback após falha e conteúdo ausente/corrompido na renderização.
- Nenhum teste abre `D:\Documents\vault-agent-office`; todos criam vaults temporários.
- Antes do PR: typecheck, lint dos arquivos tocados, testes focados e suíte, build e QA visual da
  janela Electron usando somente dados sintéticos. A inspeção visual/manual deve ser reportada
  separada dos testes automatizados.

## Fora de escopo

- Letterboxd OAuth/API, sync, importação CSV/RSS e scraping.
- Buscar pôsteres na web, usar TMDB ou enviar nomes/imagens a qualquer outro serviço externo.
- Atualizar tarefas ou compromissos automaticamente, criar recorrências, ou alterar estado de mídia
  ao concluir um item da agenda sem confirmação.
- Alterar layout, geometria, mobília ou identidade visual dos andares.
