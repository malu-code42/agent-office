# Motor 2D: pixel art isométrica no lugar do mundo 3D

**Status:** fase 1 entregue (motor + andar de projeto), atrás de Configurações → Vídeo → Visual (2D beta, padrão).
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
- A Casa (térreo) continua 3D nesta fase.

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

### Placas, nomes e a Emi

- O chão 2D não tem placas de sala: o nome aparece como dica ao passar o mouse sobre a sala. A sala de
  squad abre clicando na parede do fundo dela (lado do quadro branco); a sala de reunião, na mesa.
- Todo agente tem a tag HTML com nome, ponto de status e balão, como no 3D; a Emi ganha a dela na mesa.
- A Emi usa um visual fixo (`EMI_LOOK`, o da arte aprovada) no chão, na lista e no chat: uma fonte só.
- A mesa da Emi está virada para a parede oeste: ela senta a leste da mesa (de costas para quem olha),
  as duas cadeiras de visita ficam do outro lado; a porta para a reunião fica livre.
- Luna e Emi mostram modelo e esforço no topo do painel, com dropdowns. Luna grava em `lunaModel` /
  `lunaEffort`; a Emi em `emiModel` / `emiEffort` (um ajuste para a Emi de todos os andares). Vale na
  próxima mensagem: a Luna lê a preferência a cada turno; a Emi parada fecha o processo e retoma a mesma
  sessão com as novas opções; a Emi trabalhando troca o modelo na hora e o esforço no próximo processo.

### Entrada

`game/input.ts` pergunta ao renderizador 2D quando ele está na tela: arrastar move a câmera (presa ao
andar), roda/zoom do HUD troca 1×/2×/3×, clique acerta pessoa (pixel pintado do sprite, a da frente
primeiro), parede do fundo de uma sala (`onRoomClick`), mesa da reunião (`onMeetingRoomClick`), Emi (abre a conversa
dela), porta do elevador (o jogador anda até lá e o painel Elevador ganha o foco) ou o chão (anda).

## Mapa 3D → 2D

| 3D (`world/`) | 2D (`world2d/`) | Fase |
| --- | --- | --- |
| `engine.ts` (WebGL, câmera, pick por raio) | `renderer.ts` (Canvas2D, câmera em pixels, `pick`, `floorAt`, `project`) | 1 |
| `layout.ts` `projectPlan` | `layout.ts` `projectPlan2d`, `grid2d`, `slotOfDesk` | 1 |
| `upper-floor.ts` `buildUpperFloor` | `floor.ts` `buildFloor2d` (mesmo formato `UpperFloor`, monitores = `Crt`) | 1 |
| `furniture.ts`, `workstation.ts`, `office.ts` partições, `textures.ts` | `assets/pixel/atlas.png` + `project.json` (gerados por `scripts/pixel-art/export_app.py`) | 1 |
| `screens.ts` (`Screen` animada) | cor do CRT por estado (`crtOf`: verde/âmbar/vermelho/desligado) | 1 |
| `avatar.ts` (malha + ossos) | sprite por variante/direção/quadro (`sprites.ts` `variantOf`, `iso.ts` `dirOf`) | 1 (desenho); a simulação ainda usa `Avatar` |
| `overlays.ts` (projeção 3D) | `overlays.projector` com a projeção 2D | 1 |
| `engine.ts` sombras, `effects.ts`, `aura.ts`, `skull.ts`, `totem.ts` | — | 4 (ou fora) |
| `home.ts`, `home-layout.ts` (Casa) | — | 2 |
| andar de estudos | — | 3 |

O visual do agente (`Look`) vale no 2D: o gerador exporta cada quadro do personagem como letras de
paleta (`assets/pixel/chars.json`, 6 cortes × 16 quadros) e `world2d/recolor.ts` pinta com pele,
cabelo, camiseta, calça e sapato do agente, com o contorno do gerador (teste compara pixel a pixel com
o gerador). Cada visual é pintado uma vez e guardado (`world2d/looks.ts`). Corte 1–6 = curto,
espetado, longo, coque, maria-chiquinha, rabo de cavalo. O retrato do editor (frente e costas, 4×) e
os ícones de pessoa do app (`ui/portrait.ts`: lista de agentes, painel, dock, quadro, relatórios)
usam o mesmo sprite.

Arquivos novos da fase 1: `world2d/{atlas,depth,floor,hit,iso,layout,looks,recolor,renderer,sprites}.ts`,
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

## Fases

1. **Motor + andar de projeto** (este PR).
2. **Casa**: exportar `scene_casa2.py` como o projeto (base, móveis, lugares da mesa da Luna, ações
   clicáveis: agenda, objetivos, livros, filmes, TV/Claude FM, caveira, totem de rotinas, computador
   "Novo agente"); `home-layout` vira layout 2D; Visual 2D vale para o térreo.
3. **Andar de estudos**: exportar `scene_estudos.py`.
4. **Animação e limpeza**: andar e digitar com mais quadros, balões de reação, ajudantes menores,
   marcas de falha, efeitos (faíscas/fumaça/fantasma) em 2D; simulação sem `Avatar`/three.js
   (posição, direção e fase num objeto simples); remover three.js, o seletor Visual e o 3D.

## O que falta (conhecido)

- A Casa e o andar de estudos ainda são 3D; o 3D inteiro (three.js) segue carregado.
- Os avatares ainda são objetos three.js atualizados a cada frame (só não são desenhados no 2D).
- Ajudantes (subagentes) aparecem no tamanho normal; o cordão e as marcas de falha não são desenhados.
- Sem animação de digitar (o sprite sentado é um quadro só) nem portas do elevador abrindo.
- As mesas 5 e 6 de uma sala ficam no corredor do meio e não bloqueiam a passagem (alguém pode cruzar
  uma delas). Com até 4 membros a sala é igual à arte aprovada.
- Agentes individuais sentam nas mesas livres das salas de squad (como na arte), até 10; os demais
  ficam de pé no lounge.
- Configurações → Vídeo: Pixel art, Sombras e Efeitos só mudam o 3D (Casa e estudos); com Visual 2D o
  rótulo diz isso. Limite de fps e Economia na bateria valem nos dois.
- O quadro de gastos e o giroflex do andar existem só como tags HTML.
