# Pixel art 2D

Gerador (Python 3 + Pillow) da arte aprovada do mundo 2D e dos arquivos que o app desenha.
Nada daqui roda no app: o resultado fica commitado em `src/renderer/src/assets/pixel/`.

## Rodar

```sh
pip install pillow            # uma vez
cd scripts/pixel-art
python export_app.py          # gera os arquivos do app (abaixo)
python scene_projeto.py       # prévia aprovada do andar de projeto -> out/pixel-art/scene-projeto(_2x).png
python scene_casa2.py         # prévia aprovada da Casa -> out/pixel-art/scene-casa(_2x).png
python scene_estudos.py       # prévia do andar de estudos (fase 3)
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
| `project.json` | O layout do andar: cada sprite na posição final do canvas nativo (736×460) com sua pegada para ordenar a profundidade, as salas (retângulo em tiles, placa, sombra de luz apagada), as mesas de cada sala com o lugar da cadeira, a mesa da Emi, as cadeiras da sala de reunião, as paredes com portas, os tiles ocupados por móveis e o elevador. |
| `casa-base.png` + `casa.json` | A Casa: o que não se ordena (piso, paredes, tapetes, elevador, quadros de cortiça) e o layout (móveis com a ação do clique, quadros da parede, cadeiras da mesa da Luna e do Você, meias-paredes, tiles ocupados, cantos de lazer, zonas, tags, tela da Claude FM). |
| `font5.json` | A fonte das placas (9 linhas por letra, acentos do português). |

## Regras

- Um tile tem 32×16 pixels (16 unidades do gerador). x cresce para baixo à direita, y (o z do jogo) para baixo à esquerda.
- Os sprites são exportados já na posição final, então o app só copia pixels: nada de meio pixel arredondado diferente da arte aprovada.
- `scene_projeto.py` e `scene_casa2.py` são a fonte da verdade dos andares. Mudou a geometria lá, rode `export_app.py` de novo; a prévia e o app usam as mesmas funções.
- As salas de squad têm seis mesas: as quatro da arte aprovada e uma fileira do meio para o 5º e o 6º membro (essas duas não bloqueiam o corredor do meio).
