# Entrega 21: verificação final (#59)

**Data:** 2026-10-31 · **Base:** `main` em 4596f54 · **Spec:** #38 (`centro-de-controle-da-vida-design.md`)

Verificação da entrega completa com fixtures, antes de propor uma release. Este documento não autoriza push de
release, alteração de versão nem publicação: isso continua exigindo pedido separado da usuária.

## Escopo

Entram as fases entregues: Casa e Luna, registros pessoais, Estudos/Bonnie/Cora, Projetos/Emi/squads e sala de
reunião. **Telegram, captura remota e resumo diário ficam fora**: a integração foi removida por decisão da usuária em
2026-10-30 (PR #114, #55 encerrada como "não planejada").

## Bateria técnica

| Checagem | Comando | Resultado |
| --- | --- | --- |
| Testes | `npm test` | 158 arquivos, 2 252 aprovados, 15 ignorados, 0 falhas |
| Typecheck | `npm run typecheck` (node, web, test) | sem erros |
| Lint de todas as worktrees | `npm run lint` | sem erros |
| Contraste | `npm run contrast -- --check` | sem falhas |
| Build | `npm run build` | ok (renderer 1,11 MB; sem three.js) |
| Vazamento das cenas | `__leakTest()` sem janela, pasta de dados temporária | ver abaixo |

### Vazamento das cenas (`__leakTest`)

Rodado com `AGENT_OFFICE_DATA_DIR` numa pasta temporária vazia (nenhum dado real carregado):

```
AGENT_OFFICE_DATA_DIR=<pasta vazia> AGENT_OFFICE_SHOTS=leak:1100000 \
AGENT_OFFICE_EVAL='__leakTest().then(r => JSON.stringify(r))' electron .
```

O prefixo de `AGENT_OFFICE_SHOTS` não pode ser um caminho com letra de unidade do Windows (`C:\…`): o `:` separa os
tempos. Rode dentro da pasta de saída com um prefixo relativo.

Resultado (2026-10-31):

| Etapa | Canvases (KB) | Folhas pintadas | Etiquetas | Heap |
| --- | --- | --- | --- | --- |
| início | 7 (7 491) | 3 | 29 | 9,5 MB |
| 20 andares criados e removidos | 7 (7 491) em todas as voltas | 3 | 29 | 9,5 MB |
| 10 / 20 / 30 agentes | 22 / 37 / 52 | 18 / 33 / 48 | 33 / 33 / 31 | 9,5 MB |
| caveira 1/10 | 53 (10 555) | 49 | 29 | 9,5 MB |

- **Andares:** estáveis, nada cresce em 20 voltas.
- **Agentes:** as etiquetas voltam a 29 quando saem. Cada Look novo pinta uma folha (~66 KB), como esperado até o teto
  de 96.
- **Bloqueio documentado:** a janela oculta do modo de captura desenha cerca de 1,3 quadro por segundo (medido:
  4 `requestAnimationFrame` em 3 s, com ou sem `--disable-renderer-backgrounding`). A animação da caveira depende de
  quadros, então as 9 caveiras restantes e as 30 trocas de roupa não terminaram em 22 minutos. Para completar, abra o
  app em modo dev com uma pasta de dados temporária e rode `await __leakTest()` no console (F12):
  `AGENT_OFFICE_DATA_DIR=<pasta vazia> npm run dev`.

## Critérios de aceite

### 1. Migrações e conflitos de vault com fixtures, sem tocar o vault real

- `test/store.test.ts`: migra configurações OpenCode para Claude, descarta só o consentimento obsoleto e preserva
  agentes, logs, resultados e métricas OpenCode como histórico.
- `test/routine-personal.test.ts`, `test/personal-routines-store.test.ts`: migração e identidade das rotinas legadas.
- `test/tasks-*.test.ts`: linhas legadas de `tarefas.md` ganham id sem reformatar o texto.
- **Novo** `test/entrega-integracao.test.ts`: um vault fixture com `tarefas.md`, `agenda.md`, `objetivos.md` e
  `livros.md` abertos ao mesmo tempo. O Obsidian edita todos; tarefas, agenda, objetivos e mídias recusam a escrita,
  o vault fica idêntico à edição externa e nenhum backup é criado. Depois de reler, cada fluxo grava só o próprio
  arquivo e preserva a edição.
- **Novo**, no mesmo arquivo: trava que falha se algum teste citar o vault real (`vault-agent-office`), a pasta de
  dados do app (`AppData/Roaming/agent-office`) ou os caches de PDF/OCR.

### 2. Typecheck, lint, testes, build, contraste e vazamento

Ver a tabela acima. Nenhum bloqueio.

### 3. Privacidade, segredos locais, OpenCode somente leitura e gates humanos

- Segredos: `test/log.test.ts` (tokens, chaves, cabeçalhos de autorização e o segredo da ponte saem do log e do
  arquivo), `test/permission-notice.test.ts` (`redactSecrets` nos cartões), `test/backups.test.ts` (exportação recusa
  chaves `sk-ant`/`sk-proj`).
- OpenCode: `test/agents-policy.test.ts` (agentes OpenCode são histórico só de leitura; retomar e apagar são
  bloqueados), `test/ledger.test.ts` (uso antigo fica visível como desconhecido), `test/project-orchestration.test.ts`
  (OpenCode recusado como motor ativo).
- Estudos e Claude: `test/study-questions.test.ts` (IA recusada no gate de tokens do processo principal; verificação de
  procedência só com confirmação explícita), `docs/study-cycle-privacy.md`. A busca da Cora é local; o conteúdo dos PDFs
  não vai ao Claude.
- Gates humanos: `test/study-cycle.test.ts` (gates de diagnóstico, revisão de erros e reteste com 80% e confirmação),
  `test/proposals-apply.test.ts` (proposta sem confirmação não grava nada), `test/squad-result-ack-ipc.test.ts` (aceite de
  resultado de squad recusado sem PR e repositório verificáveis), `test/policy.test.ts`, `test/luna-permissions.test.ts`,
  `test/emi-permissions.test.ts` (o que sai das pastas, comandos de risco e internet vão ao cartão).

### 4. QA visual com dados sintéticos

Capturas com `AGENT_OFFICE_DEMO=1` e pasta de dados temporária: Casa e andar de Estudos renderizam completos, com
painel de agentes, elevador, barra inferior e etiquetas legíveis.

Observações (não bloqueiam; mudanças visuais passam antes pelo canvas):

- Casa com 10 agentes de demonstração: as etiquetas e balões dos agentes que estão nas mesas da direita se amontoam
  (nomes cortados como "Ra…", "Buscando thr…") e a etiqueta de custo `$ 0,00` fica parcialmente atrás do painel de
  agentes. Com poucos agentes não acontece.
- Estudos: as etiquetas "Tutor", "Assistente de cartões" e "Verificador de fontes" ficam encostadas na mesa da
  esquerda.
- O modo demonstração não cria andar de projeto; a sala de reunião foi verificada pelos testes
  (`test/project-meeting-results.test.ts`, `test/squad-rooms.test.ts`) e pela aprovação do protótipo no #56.

## Pendências fora deste ticket

- OCR dos PDFs escaneados da Cora: segue com o app aberto (cerca de 3 300 páginas).
- "Use a cabeça! Java" tem só 33 páginas e pode estar incompleto.
- Decisões da usuária em aberto: fluxo "Cora busca obra na internet", 12 perguntas do ciclo da Bonnie, plugin EGM da
  Emi, etiqueta de dinheiro da Casa.
