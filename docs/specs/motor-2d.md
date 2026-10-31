# Motor 2D: pixel art isométrica no lugar do mundo 3D

**Status:** fases 1 (motor + andar de projeto), 2 (Casa), 3 (andar de estudos) e 4 (animação e remoção do 3D)
entregues. O mundo é só 2D: o three.js, o seletor Visual e as opções de vídeo do 3D saíram.
**Aprovado em:** 2026-10-30.

## Por quê

1. O escritório tem que ficar igual à arte aprovada (`scripts/pixel-art/`, prévia `scene-projeto.png`).
2. Gastar menos CPU/GPU que o mundo 3D (WebGL + passe de pixelização + sombras).

## Como funciona

A lógica do jogo (`src/renderer/src/game/*`) decide quem vai aonde; o mundo 2D (`src/renderer/src/world2d/*`)
desenha. Quem anda é um `Avatar` de `world2d/avatar.ts`: um `Walker` (posição, direção, fase do passo) com pose,
andar, Look, uniforme, tamanho e "caído". Nada de three.js.

- O plano de cada andar (`ProjectPlan`, `HomePlan`, `StudyPlan`; tipos em `world2d/plan.ts` e `home-layout.ts`)
  vem do layout exportado da arte (`assets/pixel/project.json`, `casa.json`, `estudos.json`) por `projectPlan2d`,
  `casaPlan` e `studyPlan`. O `Grid` (`world2d/pathfinding.ts`) vem dos móveis e das paredes do mesmo layout.
- Um `<canvas>` 2D desenha o andar do jogador; as tags HTML (nomes, balões de texto, passo do squad, gasto,
  alarme) seguem posicionadas pela projeção 2D (`world2d/overlays.ts`: `Anchor`/`Point3`).
- A câmera é um alvo em tiles (`GameBase.target`); o renderer suaviza até ele e `jumpTo` pula.

### Desenho

- Canvas2D com `imageSmoothingEnabled = false`, escala só inteira (1×, 2×, 3× vezes a parte inteira
  do `devicePixelRatio`). O zoom inicial é o maior em que o andar inteiro cabe.
- **Cache estático**: imagem base + todos os móveis em ordem de profundidade + sombras de sala
  apagada (+ a tela do quadro de rotinas na Casa). Só é refeito quando o andar muda.
- **Quadro nativo**: guarda a última imagem. A cada frame, só os retângulos de quem mudou são recompostos a partir
  da base: pessoas e **extras** (portas do elevador, cordões, marcas de falha por baixo dos móveis; caveira, fumaça e
  fantasma por cima de tudo). Cada um tem uma assinatura (`sig`); sem mudança, nada é desenhado.
- Ordem de profundidade: a mesma regra do gerador (`room.py draw_sorted`), em `world2d/depth.ts`.
- Quem senta (pose `sit`/`type`/`relax` perto de uma cadeira) é desenhado entre o assento e o encosto; perto de
  um sofá dos cantos de descanso da Casa (`casa.json couch`), sentado atrás do encosto.

### Entrada

`game/input.ts` pergunta ao renderer: arrastar move a câmera (presa ao andar), roda/zoom do HUD troca 1×/2×/3×,
clique acerta pessoa (pixel pintado do sprite, a da frente primeiro, escala dos ajudantes considerada), placa de
sala, placa da reunião, Emi, móveis clicáveis da Casa e do andar de estudos, porta do elevador ou o chão.

## A Casa (fase 2)

- `scene_casa2.py` dividida como o projeto: `shell()` vira `casa-base.png`; o resto vira sprites em `casa.json`.
- O jogo pergunta os lugares do térreo ao `HomePlan` de `casaPlan`: cadeira do jogador, visitas, mesa da Luna e
  cadeiras dos residentes (`homeSpot`), cantos de lazer, elevador e espera.
- Clique (`world2d/hit.ts actAt`): pessoa da frente primeiro, depois o móvel pintado naquele pixel, depois os quadros
  da parede, depois a porta do elevador. Hover: o clicável fica mais claro e o `title` diz o que faz.
- Tags pequenas (`tag-mini`) para Caveira, Rotinas de agentes, Novo agente, quadros, Claude FM, Livros, Filmes, Jogos,
  Escrita; Luna, alarme e gastos no tamanho normal.
- **Cores do Look**: `atlas.json` traz a paleta de cada variante; `skins.ts` pinta pele, cabelo, camisa, calça e
  sapato mantendo a razão de cada tom; o contorno acompanha, inclusive os cantos meio transparentes (o canvas
  devolve o RGB arredondado pelo alfa pré-multiplicado: vale a cor do mapa mais próxima dentro desse erro).

## O andar de estudos (fase 3)

- O andar de cima, depois dos de projeto (`GameBase.studyFloor` = número de andares de projeto + 1). Porta de entrada
  das telas de estudo; `scene_estudos.py` exportada como a Casa.
- O professor da vez (diagnóstico e revisão → Tutor, prática → Curador, reteste → Verificador) anda até a frente da
  carteira e volta quando a etapa muda. Cora, Bonnie e os professores usam as cores da arte.

## Fase 4: animação e remoção do 3D

### Animações (quadros novos em `scripts/pixel-art`, atlas regenerado)

- **Digitar**: `typeF`/`typeB` (mão levantada, cotovelo para dentro) alternam com `sitF`/`sitB` a 4 quadros/s
  (`TYPE_FPS`) só para quem está com pose `type` e sentado. Só o retângulo de quem digita é redesenhado; o loop não
  fica "ocupado" por isso (o tick lento de 12 fps basta) e para quando ninguém digita. Com movimento reduzido
  (Economia na bateria ou `prefers-reduced-motion`), sem animação.
- **Portas do elevador**: cada `ding` abre as portas daquele andar (meio aberta 0,12 s, aberta até 1,5 s, meio
  aberta, fechada); quadros `elevator.open` em cada layout, desenhados por cima da base.
- **Descanso no sofá**: quem descansa (`relax`) num canto `sit` da Casa aparece sentado de costas no sofá.
- **Caveira**: como era no 3D: a caveira cai sobre o agente, ri parada no ar, mergulha; fumaça roxa, o agente cai
  (`char/<v>/down`), "x_x", e um fantasma sobe e some. Tudo dirigido pelo `update(dt)` (`game/skull.ts`, `fx`),
  com os sons de `game/sfx.ts`.
- **Quadro de Rotinas de agentes**: a face do quadro vira uma telinha (`casa.json totem`): faixa no topo na cor do
  LED e a contagem (`2H`, `14M`) ou um símbolo, em glifos 3×5 inclinados com a parede. A tag mantém a linha inteira.
- **Gastos e alarme**: ficam como tags HTML (legíveis; o texto não cabe em pixel art).
- **Ajudantes**: desenhados a 62% (`Person2d.scale`), com o cordão no chão na cor da camisa do dono, da mesa até o
  ajudante; os que voltam para a mesa continuam visíveis. **Marcas de falha**: losango vermelho no chão.
- Sair do escritório (encolher) e o crescer dos ajudantes também são dirigidos pelo `update(dt)` (antes por
  `requestAnimationFrame`, que quase não roda numa janela oculta).

### O que saiu

- `src/renderer/src/world/` inteiro (engine WebGL, pós-processamento, Casa e andares 3D, móveis em voxel, avatar com
  malha, merge/dispose, efeitos, texturas, totem, caveira 3D, aura; 4 735 linhas) e `test/merge.test.ts`,
  `test/layout.test.ts`, `test/home-layout.test.ts` (só testavam o plano 3D). O que era puro mudou para `world2d/`
  (`plan.ts` com os tipos da planta, `home-layout.ts` com o `HomePlan`, `pathfinding.ts`, `overlays.ts`,
  `tag-avoid.ts`); `DEFAULT_BRAND` foi para `@shared/brand`.
- Dependências `three` e `@types/three`.
- Configurações: Visual 2D/3D, Pixel art (`pixelSize`), Qualidade, Sombras e Efeitos. Ficam Limite de fps e Economia
  automática na bateria (30 fps e movimento reduzido). Dados antigos: `cleanVideo` só lê `fpsLimit` e
  `batterySaver` (os outros campos somem sem erro) e `migrateSettings` descarta `pixelSize`.
- `perf.ts` não lê mais `renderer.info`; o painel F3 e o bench mostram fps, CPU por frame, tags e KB de canvas.

## Medidas (fase 4)

Demo de carga (`AGENT_OFFICE_DEMO=stress`, 50 agentes, 3 andares de projeto), janela 1424×835, dpr 1, Windows 11.

| Bundle (`out/renderer`) | antes (com three.js) | depois |
| --- | --- | --- |
| JS do renderer | 2 401 KB | 1 089 KB |
| pasta inteira | 2 850 KB | 1 548 KB |

Medida direta, 120 frames de `update(1/60)` + `draw(1/60)` seguidos, depois de 30 de aquecimento:

| andar | `update` média · p95 | `draw` média · p95 |
| --- | --- | --- |
| 1º andar de projeto | 0,09 · 0,2 ms | 1,22 · 4,1 ms |
| Casa | 0,08 · 0,2 ms | 2,41 · 3,7 ms |
| Estudos | 0,07 · 0,2 ms | 0,64 · 1,8 ms |

`npm run bench` (15 s; a janela oculta roda a ~1 frame/s, então vale o CPU por frame, que inclui 1 s de eventos do
stress): Casa 21,7 · p95 35,5 ms; 1º andar 44,2 · p95 132,9 ms. Canvas guardados: ~8–9 MB (tela, quadro nativo,
cache, placas, personagens pintados). Heap JS 9,5 MB (o Chromium arredonda `performance.memory`).

`__leakTest()` (20 andares, 30 agentes, 10 caveiradas, 30 trocas de roupa): as tags voltam a 28; os andares ficam
estáveis (+6 canvases de placas na 1ª volta, depois 0); cada Look novo pinta uma folha de personagem (~66 KB), no
máximo 96 (o cache é limpo ao chegar nisso), então agentes, caveira e roupa sobem até esse teto e param.

## O que falta (conhecido)

- No andar de estudos: os professores são fixos (não são agentes); o da vez fica de pé, sem gesto; a etapa só é
  relida a cada 4 s; as 9 estantes abrem a mesma busca; Cora e Bonnie não conversam nem andam.
- Na Casa: agentes sem projeto e sem casa esperam no hall (sem mesa); quem é derrubado no sofá cai por cima dele.
- Só os quatro balões em pixel art (`... ! ? ok`); o diamante da conta e a aura de esforço do 3D não existem no 2D
  (a conta segue no chip da tag quando há mais de uma).
- O cache de placas (`plaques`) guarda um canvas por texto já visto (ex.: "Sala de reunião · N em reunião");
  pequeno, mas sem teto.
- As mesas 5 e 6 de uma sala ficam no corredor do meio e não bloqueiam a passagem.
- Agentes individuais sentam nas mesas livres das salas de squad, até 10; os demais ficam de pé no lounge.
