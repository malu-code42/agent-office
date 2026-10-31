# Motor 2D: pixel art isométrica no lugar do mundo 3D

**Status:** fases 1 (motor + andar de projeto), 2 (Casa) e 3 (andar de estudos) entregues, atrás de Configurações → Vídeo → Visual (2D beta, padrão). Com Visual = 2D, todos os andares são 2D.
**Aprovado em:** 2026-10-30.

## Por quê

1. O escritório tem que ficar igual à arte aprovada (`scripts/pixel-art/`, prévia `scene-projeto.png`).
2. Gastar menos CPU/GPU que o mundo 3D (WebGL + passe de pixelização + sombras).

## Como funciona (fase 1)

A lógica do jogo (`src/renderer/src/game/*`) não muda: os avatares continuam andando, sentando e
indo ao elevador como antes, com caminhos no `Grid` do andar. O que muda é o **andar** e quem
**desenha** quando o jogador está num andar de projeto com Visual = 2D:

- O plano do andar (`ProjectPlan`: salas, mesas, cadeiras, coordenação, reunião, elevador) vem do
  layout exportado da arte (`assets/pixel/project.json`) por `projectPlan2d`, com as mesmas regras de
  sala por squad, propostas e avisos de `projectPlan`.
- O `Grid` vem dos móveis e das paredes de vidro do mesmo layout.
- O WebGL do 3D não renderiza: um `<canvas>` 2D desenha o andar, e as tags HTML (nomes, balões de
  texto, passo do squad, gasto, alarme) seguem posicionadas pela projeção 2D.
- A Casa (térreo) também é 2D desde a fase 2 (abaixo).

### Desenho

- Canvas2D com `imageSmoothingEnabled = false`, escala só inteira (1×, 2×, 3× vezes a parte inteira
  do `devicePixelRatio`). O zoom inicial é o maior em que o andar inteiro cabe.
- **Cache estático**: imagem base + todos os móveis em ordem de profundidade + sombras de sala
  apagada. Só é refeito quando o andar muda (mesa aparece, monitor muda de cor, sala muda de estado).
- **Quadro nativo** (736×460): guarda a última imagem. A cada frame, só os retângulos das pessoas que
  andaram ou mudaram são recompostos a partir da base (móveis e pessoas que tocam o retângulo, de trás
  para frente, depois balões, tile sob o mouse e placas).
- **Tela**: recebe só esses retângulos, escalados. Frame sem mudança não desenha nada.
- Ordem de profundidade: a mesma regra do gerador (`room.py draw_sorted`), em `world2d/depth.ts`.
- Quem senta (pose `sit`/`type`/`relax` perto de uma cadeira) é desenhado entre o assento e o encosto.

### Entrada

`game/input.ts` pergunta ao renderizador 2D quando ele está na tela: arrastar move a câmera (presa ao
andar), roda/zoom do HUD troca 1×/2×/3×, clique acerta pessoa (pixel pintado do sprite, a da frente
primeiro), placa de sala (`onRoomClick`), placa da reunião (`onMeetingRoomClick`), Emi (abre a conversa
dela), porta do elevador (o jogador anda até lá e o painel Elevador ganha o foco) ou o chão (anda).

## A Casa (fase 2)

- `scene_casa2.py` foi dividida como o projeto: `shell()` (piso, paredes, tapetes, elevador, quadros de
  cortiça, decoração de parede) vira `casa-base.png`; as outras partes viram sprites ordenáveis em
  `casa.json`. A prévia (`build()`) sai pixel a pixel igual à arte aprovada.
- `casa.json`: móveis (os clicáveis com `act`: `radio`, `books`, `films`, `games`, `writing`, `skull`,
  `totem`, `computer`), quadros da parede (`hot`: agenda, objetivos, rotinas pessoais, clicados pela
  caixa), as 6 cadeiras da mesa da Luna (a dela primeiro, depois a ordem em que a arte enche), a cadeira e
  a mesa do Você, meias-paredes com portas, tiles ocupados, cantos de lazer (`hang`), zonas (nome no
  hover), onde ficam as tags HTML e a tela da Claude FM.
- O jogo pergunta os lugares do térreo a um `HomePlan` (`world/home-layout.ts`): `HOME_PLAN_3D` (os
  valores de antes) ou `casaPlan` (`world2d/casa.ts`). Cadeira do jogador, visitas, mesa da Luna e
  cadeiras dos residentes (`homeSpot(grid, n, plan)`, lugar fixo por agente), cantos de lazer,
  elevador e espera. `floorOf(0)` devolve o grid da Casa 2D (`buildCasa2d`).
- Clique (`world2d/hit.ts actAt`): pessoa da frente primeiro (Luna abre a conversa dela ou a revisão do
  dia), depois o móvel da frente pintado naquele pixel (um móvel sem ação na frente esconde o de trás),
  depois os quadros da parede, depois a porta do elevador. Hover: o clicável fica mais claro e o
  `title` do canvas diz o que o clique faz ou o nome da zona. Sem placas no chão.
- Tags HTML: Caveira, Rotinas de agentes, Novo agente, quadros, Claude FM, Livros, Filmes, Jogos, Escrita
  ficam pequenas (`tag-mini`) no 2D; Luna, alarme e gastos no tamanho normal. Cada tag guarda a âncora 3D
  e a 2D e troca com o Visual (`placeCasa`). O player da Claude FM vai para a tela do console 2D.
- **Cores do Look**: `atlas.json` traz a paleta de cada variante (`palettes`, de `chars.py`); `skins.ts`
  pinta pele, cabelo, camisa, calça e sapato mantendo a razão de cada tom com a base, e o contorno
  acompanha. Uma tira pintada por variante + Look (cache de 96). Vale para todos: jogador, agentes,
  ajudantes, membros, Luna (look salvo) e Emi; a camisa do uniforme da empresa também.
- O penteado escolhe a variante (`hairStyle % 6`: curto, espetado, longo, coque, maria-chiquinha,
  cacheado → 0, 4, 1, 3, 7, 5); a Luna usa a 6 (fone).
- Trocar o Visual no térreo senta o jogador na cadeira do plano novo e reposiciona quem está na Casa.
- Com Visual 2D, a Casa 3D continua construída (para trocar de volta), mas não atualiza nem desenha.

## O andar de estudos (fase 3)

- Não existia andar de estudos no 3D: as telas de estudo (`ui/study-cycle.ts`, `study-cards.ts`,
  `study-questions.ts`) não abriam de lugar nenhum. O andar existe só no 2D e é a porta de entrada delas.
- É o andar de cima, depois dos de projeto (`GameBase.studyFloor` = número de andares de projeto + 1; -1 no
  3D). O elevador mostra "Estudos"; quem está lá continua lá quando um andar de projeto entra ou sai; trocar
  para 3D leva o jogador para a Casa. O botão "Andar de projeto" conta só os andares de projeto.
- `scene_estudos.py` foi dividida como a Casa: `shell()` (piso, paredes, tapetes, elevador, horário de aula,
  mural e quadro na parede oeste) vira `estudos-base.png`; o resto vira sprites em `estudos.json`. A prévia
  (`build()`) sai pixel a pixel igual à arte aprovada.
- `estudos.json`: móveis (os clicáveis com `act`), o horário de aula (`hot`, desenhado na base), as cadeiras
  da Cora, da Bonnie, das visitas, dos 5 professores (na ordem de `TEACHERS`), a carteira do usuário e a da
  mesa de notas, onde o professor da vez fica (`class`), zonas, tags e elevador. Os vidros que caem no meio
  de um tile (biblioteca, diretoria, parede entre professores e aula) bloqueiam o tile inteiro, menos a porta.
- `world2d/estudos.ts`: `studyPlan` (cadeiras, lugar da aula, elevador, em tiles, como o `HomePlan`),
  `studyZoneAt`, `teacherOfStage` e os professores (Curador, Tutor, Verificador, Assistente de cartões,
  Verificador de fontes). `game/study.ts` (`StudyFloor`) guarda o andar, os professores e as tags.
- **Professor da vez**: a etapa do ciclo ativo escolhe quem dá aula (diagnóstico e revisão → Tutor, prática →
  Curador, reteste → Verificador; sem ciclo, ninguém). Ele levanta, anda pelo `Grid` até a frente da carteira
  e fica de pé virado para ela com o balão `?`; quando a etapa muda, volta para a cadeira. Os professores
  andam com `world2d/walker.ts` (posição, direção e passo, sem three.js). O ciclo é lido no início, ao chegar
  no andar e a cada 4 s enquanto o jogador está lá (`main.ts refreshStudy`).
- Clique (`hit.ts actAt`, `Hit` `study`): Bonnie, um professor, o quadro "Tópico atual" e a carteira abrem o
  ciclo de estudo (a carteira também senta o jogador nela); Cora e as 11 estantes (9 da biblioteca, 1 da sala
  de aula, 1 do estudo individual) abrem a biblioteca (`ui/study-library.ts`, busca local da Cora, com o
  tópico atual); o arquivo da sala dos professores e o cavalete abrem o banco de questões; a mesa de notas, a
  mesa de cartões e os arquivos do estudo individual abrem notas e cartões; o horário de aula abre a Agenda
  (onde ficam as aulas de `aulas.md`). Hover: o clicável fica mais claro e o `title` diz o que faz ou o nome
  da sala. Sem placas.
- Tags: Cora e Bonnie com nome e papel (tamanho normal); o professor da vez com nome e etapa; Biblioteca,
  Tópico atual (com o tópico), Horário de aula, Questões, Sua carteira, Notas e cartões pequenas (`tag-mini`).
- Os NPCs do andar (Cora, Bonnie, professores) não têm Look salvo: usam as cores da arte. Quem sobe ao
  andar (jogador, agentes que vêm entregar algo) usa as cores do seu Look.

## Mapa 3D → 2D

| 3D (`world/`) | 2D (`world2d/`) | Fase |
| --- | --- | --- |
| `engine.ts` (WebGL, câmera, pick por raio) | `renderer.ts` (Canvas2D, câmera em pixels, `pick`, `floorAt`, `project`) | 1 |
| `layout.ts` `projectPlan` | `layout.ts` `projectPlan2d`, `grid2d`, `slotOfDesk` | 1 |
| `upper-floor.ts` `buildUpperFloor` | `floor.ts` `buildFloor2d` (mesmo formato `UpperFloor`, monitores = `Crt`) | 1 |
| `furniture.ts`, `workstation.ts`, `office.ts` partições, `textures.ts` | `assets/pixel/atlas.png` + `project.json` (gerados por `scripts/pixel-art/export_app.py`) | 1 |
| `screens.ts` (`Screen` animada) | cor do CRT por estado (`crtOf`: verde/âmbar/vermelho/desligado) | 1 |
| `avatar.ts` (malha + ossos) | sprite por variante/direção/quadro (`sprites.ts` `variantOf`, `iso.ts` `dirOf`), cores do Look (`skins.ts`) | 1 (desenho), 2 (cores); a simulação ainda usa `Avatar` |
| `overlays.ts` (projeção 3D) | `overlays.projector` com a projeção 2D | 1 |
| `engine.ts` sombras, `effects.ts`, `aura.ts`, `skull.ts`, `totem.ts` | — | 4 (ou fora) |
| `home.ts`, `home-layout.ts` (Casa) | `casa.ts` `casaPlan`, `floor.ts` `buildCasa2d`, `assets/pixel/casa*`, `HomePlan` | 2 |
| andar de estudos (não havia) | `estudos.ts` `studyPlan`, `floor.ts` `buildEstudos2d`, `walker.ts`, `game/study.ts`, `assets/pixel/estudos*` | 3 |

Arquivos novos da fase 1: `world2d/{atlas,depth,floor,font,hit,iso,layout,plaque,renderer,sprites}.ts`,
`assets/pixel/*`, `scripts/pixel-art/*`, `test/world2d.test.ts`.

Mudanças no jogo: `ProjectPlan` ganhou `size`, `elevator`, `meeting` (sala, mesa, cadeiras) e `overflow`,
preenchidos também no 3D com os valores antigos; o elevador de cada andar vem do plano
(`GameBase.elevatorOf`); visitantes de resultado sentam nas cadeiras da reunião quando o andar tem
cadeiras; `Office.deskScreens` aceita qualquer `DeskScreen`; `Avatar` expõe `heading`, `stride`,
`isStepping`.

## Medidas (fase 1)

Demo de carga (`AGENT_OFFICE_DEMO=stress`, 50 agentes, 3 andares), jogador no 1º andar, Windows 11,
janela 1424×835, dpr 1.

`npm run bench` com `AGENT_OFFICE_BENCH_EVAL` (sobe ao 1º andar e escolhe o visual). A janela oculta do
bench roda a ~1 frame/s nesta máquina (os dois modos), então o número que vale é o trabalho de CPU por
frame:

| | 3D | 2D |
| --- | --- | --- |
| CPU por frame (`workMs`), média · p95 | 35,0 · 60,6 ms | 33,0 · 50,5 ms |
| draw calls (WebGL) | 1548 | 0 (Canvas2D; N/A) |
| triângulos | 58 338 | 0 |
| geometrias · texturas na GPU | 113 · 73 | 77 · 42 (sobra da Casa 3D) |
| heap JS | 23,4 MB | 24,8 MB |

O `workMs` do bench inclui o 1 s de eventos do stress acumulado por frame (HUD, tags), igual nos dois.
Medida direta, 120 frames de `update(1/60)` + `draw(1/60)` seguidos no mesmo cenário:

| | 3D | 2D |
| --- | --- | --- |
| `update` média · p95 | 0,88 · 1,8 ms | 0,53 · 0,8 ms |
| `draw` (render + tags HTML) média · p95 | 37,3 · 27,9 ms | 1,28 · 2,5 ms |
| heap JS depois | 29,8 MB | 18,4 MB |

## Medidas (fase 2, Casa)

Mesmo cenário (stress, 50 agentes), jogador na Casa, janela 1424×835, dpr 1.

| | 3D | 2D |
| --- | --- | --- |
| bench `workMs` média · p95 (15 s) | 190 · 1638 ms | 45 · 72 ms |
| draw calls · triângulos | 2396 · 87 666 | 0 · 0 |
| `update` média · p95 (120 frames seguidos) | 1,09 · 2,2 ms | 0,52 · 0,7 ms |
| `draw` média · p95 | 39,6 · 43,8 ms | 1,34 · 1,8 ms |

## Medidas (fase 3, andar de estudos)

Mesmo cenário (stress, 50 agentes, 3 andares de projeto), janela 1424×835, dpr 1. Não há andar de estudos
no 3D: a comparação é com o 1º andar de projeto em 3D.

| | 3D (1º andar) | 2D (estudos) |
| --- | --- | --- |
| bench `workMs` média · p95 (15 s) | 28,3 · 47,6 ms | 18,8 · 38,3 ms |
| draw calls · triângulos | 1489 · 57 645 | 0 · 0 |
| `update` média · p95 (120 frames seguidos) | 0,66 · 1,4 ms | 0,38 · 0,6 ms |
| `draw` média · p95 | 25,7 · 57,1 ms | 5,1 · 32,2 ms |
| heap JS depois | 47,4 MB | 29,4 MB |

O p95 do `draw` 2D vem dos quadros inteiros redesenhados enquanto a câmera ainda acompanha o jogador saindo
do elevador e os agentes do stress que sobem para entregar algo.

## Fases

1. **Motor + andar de projeto** (este PR).
2. **Casa** (feito): `scene_casa2.py` exportada como o projeto; `HomePlan`; Visual 2D vale para o térreo.
3. **Andar de estudos** (feito): `scene_estudos.py` exportada; professores chamados à sala de aula pela etapa do ciclo.
4. **Animação e limpeza**: andar e digitar com mais quadros, balões de reação, ajudantes menores,
   marcas de falha, efeitos (faíscas/fumaça/fantasma) em 2D; simulação sem `Avatar`/three.js
   (posição, direção e fase num objeto simples); remover three.js, o seletor Visual e o 3D.

## O que falta (conhecido)

- O 3D inteiro (three.js) segue carregado, inclusive a Casa 3D. O andar de estudos não existe no 3D.
- No andar de estudos: os 5 professores são fixos (não são agentes, não conversam); o professor que dá aula
  fica de pé, sem gesto; a etapa só é relida a cada 4 s; as 9 estantes da biblioteca abrem a mesma
  busca (não há estante por tópico com livros próprios); Cora e Bonnie não são agentes (sem conversa) nem
  andam; o mural da sala dos professores e o quadro na parede são só decoração.
- Na Casa 2D: agentes sem projeto e sem casa não têm mesa (esperam no hall, perto do elevador); quem
  descansa "senta" no sofá em pé (sem quadro sentado fora de cadeira); a caveira não anda até o agente
  nem mostra o golpe/fantasma (efeitos 3D); o totem não mostra a tela (a tag carrega o texto); quadro
  de gastos e giroflex só como tag; sem porta do elevador abrindo.
- Os pixels meio transparentes do contorno (cantos) não mudam de cor no Look (o canvas arredonda o alfa).
- Os avatares ainda são objetos three.js atualizados a cada frame (só não são desenhados no 2D).
- Ajudantes (subagentes) aparecem no tamanho normal; o cordão e as marcas de falha não são desenhados.
- Sem animação de digitar (o sprite sentado é um quadro só) nem portas do elevador abrindo.
- As mesas 5 e 6 de uma sala ficam no corredor do meio e não bloqueiam a passagem (alguém pode cruzar
  uma delas). Com até 4 membros a sala é igual à arte aprovada.
- Agentes individuais sentam nas mesas livres das salas de squad (como na arte), até 10; os demais
  ficam de pé no lounge.
- O quadro de gastos e o giroflex do andar existem só como tags HTML.
