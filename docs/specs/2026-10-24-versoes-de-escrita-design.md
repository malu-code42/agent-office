# Trechos de escrita versionados — design

**Issue:** #46
**Parent:** #38 — Agent Office como centro de controle da vida
**Status:** proposta de design para revisão da usuária
**Data:** 2026-10-24

## Objetivo

Permitir que a usuária guarde trechos de escrita num arquivo próprio do vault, peça revisão ao
perfil Agatha somente quando quiser e salve uma nova versão após revisar e confirmar. Nenhuma
versão anterior pode ser sobrescrita pela aplicação.

## Linguagem do domínio

| Termo | Definição |
|---|---|
| Trecho | Texto identificado no `escrita.md`, com título e histórico próprio. |
| Versão | Revisão imutável do texto, com ID, número, data e origem. |
| Original | Primeira versão salva pela usuária; não é alterada pelo perfil Agatha. |
| Rascunho | Texto retornado por Agatha, ainda efêmero e não persistido. |
| Revisar | A usuária escolhe um trecho/versão e envia uma instrução explícita para Agatha. |
| Aprovar nova versão | Ação que anexa o rascunho ao histórico do trecho sem alterar versões anteriores. |

## Decisões aprovadas pela usuária

- O arquivo canônico é `escrita.md`, separado dos demais arquivos do vault.
- Um texto novo é salvo primeiro como Original, por ação explícita da usuária. Para revisá-lo, a
  usuária volta a selecionar o trecho salvo.
- Revisar usa um editor dedicado e um rascunho efêmero da Luna/Agatha. Não cria agente/pasta de
  projeto nem uma proposta genérica de tarefa/agenda.
- A usuária vê a prévia exata do texto selecionado e da instrução antes de enviá-los a Claude.
- A resposta é um rascunho editável. A ação `Salvar nova versão` é a única que o persiste.
- O original e todas as versões anteriores permanecem imutáveis. A versão nova é anexada ao mesmo
  trecho, com origem `Escrita` e referência à versão base que foi revisada.
- O limite é 50.000 caracteres por versão e 2.000 caracteres por instrução.
- O perfil Agatha é usado somente após pedido explícito. A consulta é de uma única chamada sem
  ferramentas e sem sessão persistente.
- O contexto enviado contém somente a versão selecionada, a instrução e as instruções fixas do
  perfil Agatha. Não inclui tarefas, agenda, outros trechos ou memórias de perfil. Não armazena
  transcrição nem resposta antes da confirmação.
- O writer usa `writeFileAtomic`, stale-check e backup datado em `backups/escrita/`. Nenhum teste
  acessa o vault real.

## Abordagem

### Aggregate `TrechoDeEscrita`

O root de domínio tem ID estável, título e uma lista ordenada de versões. Uma versão contém ID,
número, data, origem (`original` ou `escrita`) e, quando gerada pelo perfil, ID da versão base.
O comportamento de domínio é append-only: criar Original requer uma gravação explícita; aprovar
rascunho acrescenta uma versão; não existe operação da aplicação que altere o corpo de uma versão
salva.

O codec de `escrita.md` preserva quebras de linha, conteúdo Markdown arbitrário e linhas desconhecidas.
Cada corpo de versão usa delimitadores de comentário identificados pelo ID da versão; o writer
gera um ID cujo delimitador de fechamento não apareça no corpo antes de serializá-lo. Um arquivo
malformado não é regravado parcialmente: a biblioteca apresenta erro e pede revisão manual.

### Contextos e fluxo

1. **Biblioteca local:** lista trechos e versões; criar Original é um formulário local com botão
   explícito `Salvar original`.
2. **Preparar revisão:** a usuária escolhe trecho/versão e escreve uma instrução (até 2.000
   caracteres). Main lê `escrita.md` e constrói uma prévia local contendo apenas esse texto e a
   instrução fixa do perfil Agatha.
3. **Enviar:** após revisar a prévia, a usuária clica `Enviar à Agatha`. Main consome um token
   de uso único e chama Claude uma vez com `tools: []` e sem sessão persistente. A resposta precisa
   ser texto dentro do limite; texto inválido não vira rascunho.
4. **Revisar rascunho:** a usuária compara a versão base com o rascunho, pode editar o rascunho e
   pode cancelar. Cancelar não altera `escrita.md`.
5. **Salvar versão:** `Salvar nova versão` relê `escrita.md`, valida que o snapshot continua igual
   ao usado para revisão, cria backup e acrescenta a nova versão atomicamente. Se houve edição no
   Obsidian durante a chamada, recusa gravação e pede recarregar/reconciliar.

O fluxo de escrita é um bounded context distinto do planner de tarefas/agenda e do catálogo de
mídias. A conversa geral da Luna não recebe o arquivo `escrita.md` inteiro nem outros trechos.

## Formato e segurança

- O ID do trecho e o ID da versão têm formatos próprios e são validados antes de acessar o writer.
- Título: uma linha, até 200 caracteres. Corpo: até 50.000 caracteres. Instrução: até 2.000.
- Toda entrada IPC é `unknown` e passa por Zod no main. Renderer não escolhe caminho de arquivo.
- Um token temporário identifica a prévia; envio, cancelamento e salvamento são operações distintas.
  Tokens expirados/reutilizados são recusados e limpos.
- A gravação usa só o vault configurado. Backup não sobrescreve cópia anterior. Stale-check compara
  o texto completo antes de qualquer gravação.
- Não usar `saveMarkdown`, `fs.writeFile` direto ou persistir conteúdo em `planning.json`, logs ou
  resultados gerais de agente.
- Se Claude falhar, retornar resposta inválida, a usuária cancelar, o backup falhar ou o writer
  detectar conflito, nenhuma versão é acrescentada.

## Interface

Um comando `Escrita` na UI existente abre a biblioteca de trechos. Cada trecho mostra título,
versão atual e histórico. A usuária pode criar Original manualmente ou escolher uma versão e clicar
`Revisar com Agatha`; a prévia mostra exatamente o que sairá do computador. O resultado mostra
base e rascunho, oferece edição e termina em `Salvar nova versão` ou `Cancelar`. Nenhum layout de
andar ou área de escrita física é alterado neste ticket.

## Testes e verificação

- Codec round-trip em LF e CRLF, texto Markdown multilinear, delimitadores, linhas desconhecidas,
  IDs inválidos/duplicados e versões ordenadas.
- Aggregate: Original imutável, versão nova aponta para base, número/data, corpo e limite.
- Writer: backup datado sem overwrite, stale-check e conflito durante chamada, escrita atômica,
  falha sem alterar arquivo, cancelamento e repetição idempotente do token.
- Assistência: texto enviado é somente a versão selecionada + instrução + escopo fixo; não entram
  tarefas, agenda, outros textos ou memória de perfil; nenhuma persistência prévia ao aceite.
- UI/IPC: cancelar não escreve; resposta inválida não grava; salvar cria nova versão; mensagens de
  erro pt-BR; foco/teclado; sem caminho livre vindo do renderer.
- Todos os testes usam `mkdtemp`/vault sintético e mocks locais. Nenhum dado pessoal é enviado ou
  lido durante testes.
- Antes do PR: typecheck, lint dos arquivos tocados, testes focados e suíte completa, build,
  `git diff --check` e QA manual com vault sintético. Falhas preexistentes são relatadas separadas.

## Fora de escopo

- Revisão automática ou em background; nenhuma revisão acontece sem solicitação explícita.
- Sobrescrever, reescrever ou apagar uma versão salva automaticamente.
- Usar o executor genérico de propostas para escrita; escrever tarefas, agenda ou rotinas.
- Indexar a biblioteca completa ou enviar outros trechos/memórias ao modelo.
- Sincronização externa, publicação, colaboração, export/import global ou acesso ao vault real nos testes.
