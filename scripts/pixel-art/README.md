# Pixel art 2D

Gerador (Python 3 + Pillow) da arte aprovada do mundo 2D e dos arquivos que o app desenha.
Nada daqui roda no app: o resultado fica commitado em `src/renderer/src/assets/pixel/`.

## Rodar

```sh
pip install pillow            # uma vez
cd scripts/pixel-art
python export_app.py          # gera os arquivos do app (abaixo)
python scene_projeto.py       # prévia do andar de projeto (quatro salas em L) -> out/pixel-art/scene-projeto(_2x).png
python scene_casa2.py         # prévia aprovada da Casa -> out/pixel-art/scene-casa(_2x).png
python scene_estudos.py       # prévia aprovada do andar de estudos -> out/pixel-art/scene-estudos(_2x).png
python sheets.py              # folhas de móveis e pisos
python sheet_agentes.py       # folha de personagens
```

As prévias vão para `out/pixel-art/` (ignorado pelo git). Depois de `export_app.py`, rode os testes
(`test/world2d.test.ts` confere o layout exportado) e faça o commit dos arquivos gerados.

## O que `export_app.py` gera

| Arquivo | Conteúdo |
| --- | --- |
| `atlas.png` + `atlas.json` | Todos os sprites: móveis (um quadro por cor de monitor: verde, âmbar, vermelho, desligado), paredes de vidro, cadeiras (assento e encosto separados, para o personagem sentar entre eles), personagens (8 variantes × 4 direções × parado/passo A/passo B + sentado de costas e de frente), balões, sombra e um losango por piso. `anchors` diz onde fica a ponta de cada balão e o centro da sombra; `palettes`, as cores de cada variante, para o app pintar com o Look. |
| `project-base.png` | O que nunca se ordena no andar de projeto: laje, piso, paredes do fundo, tapetes, elevador, quadros brancos. |
| `project.json` | O layout do andar: cada sprite na posição final do canvas nativo (736×460) com sua pegada para ordenar a profundidade, as quatro salas em L (retângulos em tiles, contorno, placa, sombras de luz apagada, porta, lugares de entrega e de espera), as 9 mesas de agentes e a do coordenador de cada sala com o lugar da cadeira, a mesa da Emi e o escritório dela, as paredes com portas, as janelas dos corredores, os tiles ocupados por móveis e o elevador. |
| `casa-base.png` + `casa.json` | A Casa: o que não se ordena (piso, paredes, tapetes, elevador, quadros de cortiça) e o layout (móveis com a ação do clique, quadros da parede, cadeiras da mesa da Luna e do Você, meias-paredes, tiles ocupados, cantos de lazer, zonas, tags, tela da Claude FM). |
| `estudos-base.png` + `estudos.json` | O andar de estudos: o que não se ordena (piso, paredes, tapetes, elevador, horário de aula, mural) e o layout (móveis com a ação do clique, cadeiras da Cora, da Bonnie, dos professores, das visitas, da carteira e da mesa de notas, onde o professor da vez fica, tiles ocupados, zonas, tags). |

## Regras

- Um vidro que fica no meio de um tile (posição não múltipla de 16) bloqueia os tiles que atravessa, menos os da porta; os outros bloqueiam a aresta entre dois tiles.
- Um tile tem 32×16 pixels (16 unidades do gerador). x cresce para baixo à direita, y (o z do jogo) para baixo à esquerda.
- Os sprites são exportados já na posição final, então o app só copia pixels: nada de meio pixel arredondado diferente da arte aprovada.
- `scene_projeto.py`, `scene_casa2.py` e `scene_estudos.py` são a fonte da verdade dos andares. Mudou a geometria lá, rode `export_app.py` de novo; a prévia e o app usam as mesmas funções.
- O andar de projeto (AO-106) tem quatro salas em L nos cantos, o escritório da Emi no centro e corredores em cruz, nos mesmos 24×18 tiles. `scene_projeto.py` descreve cada sala (`make_room`) e desenha tudo a partir de tiles: o vidro em volta de cada L sai das células dele (`runs_around`), as mesas vêm de `member_at`/`coord_at`. Cada sala tem 10 mesas, sempre montadas: 9 de agentes (grade 3×3, um par de tiles por mesa: mesa e cadeira) e 1 do coordenador, separada, na faixa de 2 tiles. A coluna da extensão fica livre: é por ela que se chega a toda cadeira, da porta.
- A cena é isométrica e só desenha as paredes x = 0 e y = 0. A planta aprovada foi girada para o topo dela ser x = 0 e a direita ser y = 0 (elevador na ponta direita do corredor do meio, na parede y = 0). A janela de cima está numa parede desenhada; as de baixo e da esquerda estão no `project.json` (`windows`, `drawn: false`) mas não na imagem. Lounge, sala de reunião e diretoria antigos saíram do gerador e do atlas.
- Para mexer na geometria, mude só `scene_projeto.py` e rode `export_app.py`. Confira o resultado com `test/projeto2d.test.ts` (sobreposição, tiles bloqueados, alcance a partir do elevador) e olhe a prévia.
- A mesa da Luna da Casa tem 12 computadores (AO-110): `DESKS` em `scene_casa2.py` é a grade de 3 colunas × 4 fileiras, na numeração do board `casa12` (1 a 4 são os antigos, 5 a 7 a fileira de cima, 8 e 9 a coluna leste, 10 a 12 a fileira de baixo). `LUNA_DESK` (o 10) é onde a Luna senta e `SEAT_ORDER` põe a cadeira dela primeiro em `casa.json` (`table.seats[0]`); os outros 11 são dos moradores. Para mover uma mesa, mexa só em `DESKS`/`TABLE_LOOK`/`TABLE_PEOPLE`/`DESK_RUG`/`TABLE` e rode `export_app.py`; a cadeira de cada mesa fica num tile sem mesa (o teste confere).
