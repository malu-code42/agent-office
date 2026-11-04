# Preparar disciplina antes de gerar o material de estudo

- **Data:** 2026-11-03
- **Origem:** conversa de grilling com a usuária (sem EGM completo, por escolha dela).
- **Caso que motivou:** Hardware I (`P2-HW`, 13 tópicos) não conseguiu gerar todas as questões do banco.

## Problema

O banco de questões só descobre durante a geração que um tópico não tem fonte. Em Hardware I:

- As pastas da disciplina (`textbooks/Eletrônica`, `Física`, `Organização de Computadores`) não têm livro para os tópicos digitais (06 a 13) nem para ondas e óptica (04 e 05).
- Quando a pasta da disciplina não dá nenhum trecho, o código desiste do tópico sem procurar no resto da biblioteca (`src/main/study-bank-builder.ts`, busca ampla só roda se já houver um trecho).
- 13 dos 14 tópicos já tentados ficaram `sem-acordo` nos subtemas (`study-subtopics.json`).
- O relatório da montagem some quando a usuária o dispensa, então o motivo da falha se perde.

## Decisões

1. **Etapa "Preparar disciplina"**, passo 1 da janela do banco, antes de "Gerar". Confere, por tópico: fonte, subtemas e trechos. Gera um relatório de prontidão. "Gerar" libera só os tópicos prontos.
2. **Prova real:** nos tópicos prontos, gera 1 questão de verdade como teste. Se passar, ela fica no banco e conta para a meta do tópico.
3. **Fontes:** só `textbooks/`, como hoje. Não se incluem livros que precisam de OCR. O status "pending-review" dos READMEs é ignorado. PDF sem texto aparece no relatório como "precisa de OCR, fora do escopo".
4. **Tópico travado:** fica travado quando não tem fonte, ou quando os subtemas não fecham (`sem-acordo`). O relatório mostra o motivo, sugere livros da web (função `suggestBooks` já existente) e diz a pasta exata onde colocar o arquivo. Nada é baixado sozinho. A usuária só coloca livros nas pastas.
5. **Mesma base para tudo:** cartões, projetos de software e zettels usam o mesmo relatório. Tópico travado trava todos.
6. **Reexecutar:** botão que reconfere só os tópicos travados e mantém os prontos.
7. **Relatório guardado por disciplina** até a próxima preparação. Não some ao dispensar.
8. **Quantidade:** a janela pede só "questões por tópico". O app reparte entre os subtemas. O campo "por subtema" e qualquer total escolhido pela usuária saem.
9. **Fonte da verdade da trilha:** `trilha zettel.md`.
10. **Começa só por Hardware I.** Outras disciplinas depois.

## Critério de pronto

Hardware I com 13 de 13 tópicos prontos: cada um com fonte, subtemas que fecharam e 1 questão de prova aprovada. Depois, a geração entrega o número de questões por tópico pedido pela usuária em todos os 13.

## Fora do escopo

- OCR de livros.
- Baixar livros automaticamente.
- Preparar as outras disciplinas.

## Riscos

- Com "tópico sem subtemas fechados trava", quase tudo começa travado (13 de 14 estavam `sem-acordo`). A causa provável é índice do livro que não casa com o nome do tópico, mas isso é hipótese e precisa ser verificada no ticket de subtemas.
- A prova real gasta chamadas ao modelo (até 13 por execução). A checagem estática vem antes para não gastar com tópico sem fonte.
- Livro novo colocado na pasta precisa já ter texto selecionável; senão o tópico continua travado.

## Alternativas descartadas

- EGM completo (brainstorm, draft, 5 estágios de revisão): caro para uma decisão de desenho que coube numa conversa.
- Só avisar sem travar: não dá a garantia que a usuária quer antes de gerar.
- Tudo ou nada por disciplina: bloqueia tópicos que já estão prontos.
- Tentar de novo os subtemas, ou seguir sem eles: descartadas pela usuária em favor de travar o tópico.
