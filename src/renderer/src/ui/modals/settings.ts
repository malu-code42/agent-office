import { HAIR_COLORS, HAIR_STYLES, PANTS_COLORS, SHIRT_COLORS, SKIN_TONES } from '@shared/describe'
import { floorNameFor, MAX_PROJECT_FLOORS } from '@shared/projects'
import type { AlwaysAllowRule, Look, OfficePermissionMode, ProjectFloor } from '@shared/types'
import type { ParsedBoard } from '@shared/tasks'
import type { State } from '../../state'
import {
  DEFAULT_VIDEO,
  QUALITY_LABELS,
  QUALITY_PRESETS,
  qualityOf,
  type FpsLimit,
  type Quality,
  type ShadowMapSize,
  type VideoSettings,
} from '@shared/video'
import { openAccounts } from '../accounts'
import { dataSection } from '../data'
import { h, icon } from '../dom'
import { portrait } from '../portrait'
import { updateSettingsBox } from '../updates'
import { cleanError, field, modal } from './common'
import { brainFields, meterField, MODES } from './brain'
import { brandFields } from './brand'

// Configurações: player, defaults, floors, accounts, data, video and the terminal bridge.

/** `section: 'bridge'` opens scrolled to the terminal sessions box (the dock's gear does it when the bridge fails). */
export function openSettings(
  root: HTMLElement,
  state: State,
  toast: (t: string, k?: 'info' | 'ok' | 'err') => void,
  opts: { section?: 'bridge'; tour?: () => void; openTasks?: (board: ParsedBoard) => void } = {},
): void {
  const s = state.settings
  const look: Look = { ...s.playerLook }
  const name = h('input', { class: 'input', value: s.playerName, maxlength: 24 })
  const preview = h('div', { class: 'look-preview' })
  const renderPreview = () => preview.replaceChildren(portrait(look, 96))
  renderPreview()

  const swatches = (key: keyof Look, colors: string[]) => {
    const row = h('div', { class: 'swatches' })
    const paint = () => row.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.c === look[key]))
    for (const c of colors) {
      const b = h('button', { class: 'swatch', style: `background:${c}`, type: 'button' })
      b.dataset.c = c
      b.addEventListener('click', () => {
        ;(look[key] as string) = c
        paint()
        renderPreview()
      })
      row.append(b)
    }
    paint()
    return row
  }
  const styles = h('div', { class: 'swatches' })
  for (let i = 0; i < HAIR_STYLES; i++) {
    const b = h('button', { class: 'swatch swatch-style', type: 'button' }, String(i + 1))
    b.classList.toggle('on', look.hairStyle === i)
    b.addEventListener('click', () => {
      look.hairStyle = i
      styles.querySelectorAll('button').forEach((x, j) => x.classList.toggle('on', j === i))
      renderPreview()
    })
    styles.append(b)
  }

  const pixel = h(
    'select',
    { class: 'input' },
    ...[2, 3, 4, 5].map((n) => h('option', { value: n }, `${n}px${n === 3 ? ' (padrão)' : ''}`)),
  )
  pixel.value = String(s.pixelSize)
  const notify = h('input', { type: 'checkbox' }) as HTMLInputElement
  notify.checked = s.notifications
  const brain = brainFields({ model: s.defaultModel, effort: s.defaultEffort })
  const mode = h('select', { class: 'input' }, ...MODES.map((m) => h('option', { value: m.value }, m.label)))
  mode.value = s.defaultPermissionMode
  const maxSubs = h('input', { class: 'input', type: 'number', min: 0, max: 100, step: 1, value: s.maxSubagents ?? 10 }) as HTMLInputElement
  const budget = h('input', { class: 'input', type: 'number', min: 0, step: 0.5, value: s.agentBudgetUsd ?? 0 }) as HTMLInputElement
  const updates = updateSettingsBox(root, s.updateChannel)
  const video = videoFields(state)
  const vaultPath = h('input', {
    class: 'input',
    type: 'text',
    value: s.vaultPath ?? '',
    readonly: true,
    'aria-label': 'Pasta do vault',
  }) as HTMLInputElement
  const vaultStatus = h(
    'span',
    { class: 'field-hint', role: 'status' },
    s.vaultPath ? 'Pasta salva. O Office só lê tarefas.md.' : 'Escolha a pasta do vault; o Office só lê tarefas.md.',
  )
  const vaultSummary = (board: ParsedBoard) =>
    `${board.lists.length} listas encontradas · ${board.lists.reduce((n, list) => n + list.tasks.length, 0)} tarefas · ${board.warnings.length} avisos.`
  const chooseVault = h(
    'button',
    {
      class: 'btn',
      type: 'button',
      onclick: async () => {
        try {
          const selected = await window.office.selectTasksVault()
          if (!selected) return
          vaultPath.value = selected.vaultPath
          vaultStatus.textContent = vaultSummary(selected.board)
          toast('Pasta do vault selecionada e validada.', 'ok')
        } catch (err) {
          vaultStatus.textContent = cleanError(err)
          toast(cleanError(err), 'err')
        }
      },
    },
    icon('folder', 14),
    'Escolher pasta',
  )
  const verifyVault = h(
    'button',
    {
      class: 'btn',
      type: 'button',
      onclick: async () => {
        if (!vaultPath.value) return toast('Escolha a pasta que contém tarefas.md.', 'err')
        try {
          const board = await window.office.readTasks()
          vaultStatus.textContent = vaultSummary(board)
          toast('Pasta do vault verificada.', 'ok')
        } catch (err) {
          vaultStatus.textContent = cleanError(err)
          toast(cleanError(err), 'err')
        }
      },
    },
    icon('check', 14),
    'Verificar tarefas.md',
  )
  const openTasks = h(
    'button',
    {
      class: 'btn btn-primary',
      type: 'button',
      onclick: async () => {
        if (!vaultPath.value) return toast('Escolha a pasta que contém tarefas.md.', 'err')
        try {
          const board = await window.office.readTasks()
          close()
          opts.openTasks?.(board)
        } catch (err) {
          vaultStatus.textContent = cleanError(err)
          toast(cleanError(err), 'err')
        }
      },
    },
    icon('list', 14),
    'Abrir quadro Tarefas',
  )

  const b = state.bridge
  const bridgeStatus = h(
    'div',
    { class: 'bridge-status' },
    h('span', { class: `dot ${b.installed && b.listening ? 'dot-working' : b.installed ? 'dot-error' : 'dot-stopped'}` }),
    b.installed
      ? b.listening
        ? `Conectado (porta ${b.port})`
        : `Hooks instalados, servidor parado${b.error ? `: ${b.error}` : ''}`
      : 'Desconectado',
  )
  // project floors: one per folder; renaming keeps whatever else a floor carries
  let floors: ProjectFloor[] = s.projects.map((p) => ({ ...p }))
  const floorList = h('div', { class: 'floor-list' })
  const addFloor = h('button', { class: 'btn', type: 'button' }, icon('plus', 15), 'Adicionar andar')
  const renderFloors = () => {
    floorList.replaceChildren(
      ...(floors.length
        ? floors.map((p, i) => {
            const nameIn = h('input', { class: 'input', value: p.name, maxlength: 32, title: 'Nome do andar' })
            nameIn.addEventListener('input', () => (floors[i] = { ...floors[i], name: nameIn.value }))
            const squads = state.squads.filter((q) => q.cwd === p.cwd).length
            const remove = h(
              'button',
              { class: 'icon-btn', type: 'button', title: 'Tirar o andar: os agentes dele descem para o térreo' },
              icon('x', 15),
            )
            const set = (patch: Partial<ProjectFloor>) => (floors[i] = { ...floors[i], ...patch })
            const floorMode = h(
              'select',
              { class: 'input' },
              ...MODES.map((m) => h('option', { value: m.value }, m.label)),
            ) as HTMLSelectElement
            floorMode.value = p.permissionMode ?? s.defaultPermissionMode
            floorMode.addEventListener('change', () => set({ permissionMode: floorMode.value as OfficePermissionMode }))
            const ruleKind = h(
              'select',
              { class: 'input' },
              h('option', { value: 'tool' }, 'Ferramenta exata'),
              h('option', { value: 'command' }, 'Comando exato'),
            ) as HTMLSelectElement
            const ruleValue = h('input', { class: 'input', maxlength: 500, placeholder: 'Ex.: Read ou npm test' }) as HTMLInputElement
            const ruleList = h('div', { class: 'field-hint' })
            const importPreview = h('div', { class: 'field-hint' })
            const previewImport = h(
              'button',
              {
                class: 'btn',
                type: 'button',
                onclick: async () => {
                  try {
                    const preview = await window.office.previewClaudePermissions()
                    if (!preview) return
                    const choices = preview.rules.map((rule) => {
                      const check = h('input', { type: 'checkbox' }) as HTMLInputElement
                      return {
                        rule,
                        check,
                        row: h('label', { class: 'check' }, check, `${rule.kind === 'tool' ? 'Ferramenta' : 'Comando'}: ${rule.value}`),
                      }
                    })
                    const apply = h('button', { class: 'btn', type: 'button' }, 'Importar selecionadas')
                    apply.addEventListener('click', () => {
                      const existing: AlwaysAllowRule[] = floors[i]?.alwaysAllow ?? []
                      const selected = choices
                        .filter((x) => x.check.checked)
                        .map(({ rule }) => ({ ...rule, id: crypto.randomUUID(), createdAt: Date.now() }))
                      if (!selected.length) return toast('Marque ao menos uma regra para importar.', 'err')
                      set({
                        alwaysAllow: [...existing, ...selected]
                          .filter((rule, index, all) => all.findIndex((x) => x.kind === rule.kind && x.value === rule.value) === index)
                          .slice(0, 100),
                      })
                      paintRules()
                      importPreview.replaceChildren(
                        h('span', {}, 'Regras selecionadas adicionadas ao rascunho; salve as configurações para aplicá-las.'),
                      )
                    })
                    importPreview.replaceChildren(
                      h(
                        'div',
                        { class: 'field-hint' },
                        `Prévia de ${preview.source}. Nada será aplicado até você selecionar regras e salvar.`,
                      ),
                      ...(choices.length
                        ? choices.map((x) => x.row)
                        : [h('div', { class: 'field-hint' }, 'Nenhuma regra exata compatível foi encontrada.')]),
                      ...(choices.length ? [apply] : []),
                    )
                  } catch (err) {
                    importPreview.textContent = cleanError(err)
                  }
                },
              },
              'Pré-visualizar permissões Claude',
            )
            const paintRules = () => {
              const rules = floors[i]?.alwaysAllow ?? []
              ruleList.replaceChildren(
                ...(rules.length
                  ? rules.map((rule) => {
                      const revoke = h('button', { class: 'icon-btn', type: 'button', title: 'Revogar regra' }, icon('x', 14))
                      revoke.addEventListener('click', () => {
                        set({ alwaysAllow: rules.filter((x) => x.id !== rule.id) })
                        paintRules()
                      })
                      return h(
                        'div',
                        { class: 'bridge-row' },
                        h('span', {}, `${rule.kind === 'tool' ? 'Ferramenta' : 'Comando'}: ${rule.value}`),
                        revoke,
                      )
                    })
                  : [h('span', {}, 'Nenhuma regra salva.')]),
              )
            }
            const addRule = h(
              'button',
              {
                class: 'btn',
                type: 'button',
                onclick: () => {
                  const value = ruleValue.value.trim()
                  if (!value) return
                  const rules: AlwaysAllowRule[] = floors[i]?.alwaysAllow ?? []
                  if (rules.some((x) => x.kind === ruleKind.value && x.value === value))
                    return toast('Essa regra já existe neste projeto.', 'err')
                  set({
                    alwaysAllow: [
                      ...rules,
                      { id: crypto.randomUUID(), createdAt: Date.now(), kind: ruleKind.value as 'tool' | 'command', value },
                    ],
                  })
                  ruleValue.value = ''
                  paintRules()
                },
              },
              icon('plus', 14),
              'Adicionar regra',
            )
            paintRules()
            remove.addEventListener('click', () => {
              floors = floors.filter((_, j) => j !== i)
              renderFloors()
            })
            return h(
              'div',
              { class: 'floor-row' },
              h('span', { class: 'floor-num' }, String(i + 1)),
              h(
                'div',
                { class: 'floor-row-main' },
                nameIn,
                h(
                  'span',
                  { class: 'floor-row-path', title: p.cwd },
                  p.cwd,
                  squads ? ` · ${squads === 1 ? '1 squad' : `${squads} squads`}` : '',
                ),
                field('Modo padrão do projeto', floorMode),
                field(
                  'Sempre permitir (regra exata e revogável)',
                  h('div', {}, h('div', { class: 'field-row' }, ruleKind, ruleValue, addRule), ruleList, previewImport, importPreview),
                  'Só vale para ações classificadas como seguras. Ações externas, sensíveis, desconhecidas e de risco continuam pedindo confirmação.',
                ),
                brandFields(floors[i], set, toast),
              ),
              remove,
            )
          })
        : [h('div', { class: 'field-hint' }, 'Nenhum andar: o escritório fica só no térreo.')]),
    )
    addFloor.classList.toggle('hidden', floors.length >= MAX_PROJECT_FLOORS)
  }
  addFloor.addEventListener('click', async () => {
    const p = await window.office.pickFolder()
    if (!p) return
    if (floors.some((x) => x.cwd === p)) return toast('Essa pasta já tem um andar.', 'err')
    floors = [...floors, { id: `p-${Date.now().toString(36)}`, name: floorNameFor(p), cwd: p }]
    renderFloors()
  })
  renderFloors()

  const bridgeBtn = h('button', { class: 'btn' }, b.installed ? 'Desconectar' : 'Conectar')
  bridgeBtn.addEventListener('click', async () => {
    const next = b.installed ? await window.office.uninstallBridge() : await window.office.installBridge()
    toast(
      next.installed ? 'Sessões do terminal conectadas. Abra um novo `claude` no terminal.' : 'Sessões do terminal desconectadas.',
      'ok',
    )
    close()
  })

  const close = () => el.remove()
  const save = h('button', { class: 'btn btn-primary' }, icon('check', 16), 'Salvar')
  save.addEventListener('click', async () => {
    try {
      await window.office.saveSettings({
        playerName: name.value.trim() || 'Você',
        playerLook: look,
        pixelSize: Number(pixel.value),
        notifications: notify.checked,
        defaultModel: brain.model.value,
        defaultEffort: brain.value().effort ?? '',
        defaultPermissionMode: mode.value as OfficePermissionMode,
        // An emptied field keeps the current value instead of saving 0 (no limit).
        ...(numberField(maxSubs.value) !== undefined ? { maxSubagents: Math.max(0, Math.round(numberField(maxSubs.value)!)) } : {}),
        ...(numberField(budget.value) !== undefined ? { agentBudgetUsd: Math.max(0, numberField(budget.value)!) } : {}),
        updateChannel: updates.value(),
        video: video.value(),
        projects: floors.map((p) => ({ ...p, name: p.name.trim() || floorNameFor(p.cwd) })),
      })
      close()
    } catch (err) {
      toast(cleanError(err), 'err')
    }
  })

  const el = modal(
    'Configurações',
    [
      h(
        'div',
        { class: 'look-editor' },
        preview,
        h(
          'div',
          { class: 'look-fields' },
          field('Seu nome', name),
          field('Pele', swatches('skin', SKIN_TONES)),
          field('Cabelo', swatches('hair', HAIR_COLORS)),
          field('Corte', styles),
          field('Camiseta', swatches('shirt', SHIRT_COLORS)),
          field('Calça', swatches('pants', PANTS_COLORS)),
        ),
      ),
      h('div', { class: 'field-row' }, field('Pixel art', pixel), field('Modelo padrão', brain.model), field('Permissão padrão', mode)),
      meterField('Esforço padrão', brain.meter),
      h('label', { class: 'check' }, notify, 'Notificar quando um agente precisar de mim ou terminar'),
      video.el,
      h(
        'div',
        { class: 'bridge-box' },
        h('div', { class: 'bridge-title' }, icon('list', 16), 'Tarefas do Obsidian'),
        h('div', { class: 'field-hint' }, 'A pasta é escolhida no diálogo do sistema; o Office valida tarefas.md e guarda essa seleção.'),
        field('Pasta do vault', vaultPath),
        vaultStatus,
        h('div', { class: 'bridge-row' }, chooseVault, verifyVault, openTasks),
      ),
      h(
        'div',
        { class: 'bridge-box' },
        h('div', { class: 'bridge-title' }, icon('users', 16), 'Andares por projeto'),
        h(
          'div',
          { class: 'field-hint' },
          'Cada andar é uma pasta de projeto: quem você contrata ou chama lá trabalha nela. Se a pasta tiver squads (squads/<code>/squad.yaml), eles ocupam as salas de squad do andar.',
        ),
        h(
          'div',
          { class: 'field-hint' },
          'Por segurança, agentes gerenciados pelo Office não carregam settings externos do Claude nem CLAUDE.md. Inclua as instruções importantes na tarefa ou no modelo do agente.',
        ),
        floorList,
        addFloor,
      ),
      h(
        'div',
        { class: 'bridge-box' },
        h('div', { class: 'bridge-title' }, icon('coin', 16), 'Limites dos agentes'),
        h(
          'div',
          { class: 'field-row' },
          field(
            'Subagentes ao mesmo tempo',
            maxSubs,
            'Por agente. A mesa comporta 3; um valor menor aperta esse limite. 0 = o limite da mesa (3).',
          ),
          field('Teto de custo por agente (US$)', budget, 'Ao chegar nele, o agente para e avisa. 0 = sem teto.'),
        ),
      ),
      h(
        'div',
        { class: 'bridge-box' },
        h('div', { class: 'bridge-title' }, icon('users', 16), 'Contas do Claude'),
        h(
          'div',
          { class: 'field-hint' },
          `${s.accounts.length === 1 ? 'Uma conta' : `${s.accounts.length} contas`}. Adicione outras para separar projetos ou escolher outra conta no início de tarefas futuras; tarefas em andamento nunca trocam de conta.`,
        ),
        h(
          'div',
          { class: 'bridge-row' },
          h('button', { class: 'btn', type: 'button', onclick: () => openAccounts(root, state, toast) }, 'Gerenciar contas'),
        ),
      ),
      h(
        'div',
        { class: 'bridge-box bridge-terminal' },
        h('div', { class: 'bridge-title' }, icon('terminal', 16), 'Sessões do Claude Code no terminal'),
        h(
          'div',
          { class: 'field-hint' },
          'Adiciona hooks HTTP em ~/.claude/settings.json. Cada `claude` aberto no terminal aparece como agente, e os pedidos de permissão vêm até você aqui. Com o app fechado, o terminal funciona normal.',
        ),
        h('div', { class: 'bridge-row' }, bridgeStatus, bridgeBtn),
      ),
      dataSection(toast),
      h(
        'div',
        { class: 'bridge-box bridge-help' },
        h('div', { class: 'bridge-title' }, icon('alert', 16), 'Ajuda'),
        h(
          'div',
          { class: 'field-hint' },
          'O app grava um log dos erros (sem prompts nem tokens). Ao relatar um problema, cole o diagnóstico: versão, sistema, versão do Claude Code e as últimas 200 linhas do log.',
        ),
        h(
          'div',
          { class: 'bridge-row bridge-row-start' },
          h(
            'button',
            {
              class: 'btn',
              type: 'button',
              onclick: () => window.office.openLogs().catch((err) => toast(cleanError(err), 'err')),
            },
            icon('folder', 14),
            'Abrir pasta de logs',
          ),
          h(
            'button',
            {
              class: 'btn',
              type: 'button',
              onclick: async () => {
                try {
                  await window.office.copyDiagnostics()
                  toast('Diagnóstico copiado. Cole no relato do problema.', 'ok')
                } catch (err) {
                  toast(cleanError(err), 'err')
                }
              },
            },
            icon('copy', 14),
            'Copiar diagnóstico',
          ),
          opts.tour
            ? h(
                'button',
                {
                  class: 'btn',
                  type: 'button',
                  onclick: () => {
                    close()
                    opts.tour?.()
                  },
                },
                icon('walk', 14),
                'Rever o tour',
              )
            : null,
        ),
      ),
      updates.el,
    ],
    [
      h('span', { class: 'app-version', title: `Build de ${__APP_BUILD__}` }, `Agent Office v${__APP_VERSION__} · build ${__APP_BUILD__}`),
      h('button', { class: 'btn', onclick: close }, 'Cancelar'),
      save,
    ],
    close,
  )
  root.append(el)
  if (opts.section === 'bridge') el.querySelector('.bridge-terminal')?.scrollIntoView({ block: 'start' })
}

/**
 * Configurações → Vídeo (AO-29, AO-32). Picking a quality fills the other fields; changing one
 * by hand shows "Personalizada". Everything applies on Salvar, without restarting.
 */
function videoFields(state: State): { el: HTMLElement; value: () => VideoSettings } {
  const v: VideoSettings = { ...DEFAULT_VIDEO, ...state.settings.video }
  const quality = h(
    'select',
    { class: 'input' },
    ...(Object.keys(QUALITY_LABELS) as Quality[]).map((q) => h('option', { value: q }, QUALITY_LABELS[q])),
    h('option', { value: 'custom', disabled: true }, 'Personalizada'),
  )
  const fps = h(
    'select',
    { class: 'input' },
    h('option', { value: 30 }, '30 fps'),
    h('option', { value: 60 }, '60 fps'),
    h('option', { value: 0 }, 'Sem limite'),
  )
  const shadows = h(
    'select',
    { class: 'input' },
    h('option', { value: 'off' }, 'Desligadas'),
    h('option', { value: 1024 }, 'Ligadas · 1024'),
    h('option', { value: 2048 }, 'Ligadas · 2048'),
  )
  const effects = h(
    'select',
    { class: 'input' },
    h('option', { value: 'full' }, 'Completos'),
    h('option', { value: 'reduced' }, 'Reduzidos'),
  )
  const battery = h('input', { type: 'checkbox' }) as HTMLInputElement
  battery.checked = v.batterySaver

  const value = (): VideoSettings => ({
    shadows: shadows.value !== 'off',
    shadowMapSize: (shadows.value === 'off' ? v.shadowMapSize : Number(shadows.value)) as ShadowMapSize,
    fpsLimit: Number(fps.value) as FpsLimit,
    effects: effects.value === 'reduced' ? 'reduced' : 'full',
    batterySaver: battery.checked,
  })
  const fill = (x: Omit<VideoSettings, 'batterySaver'>) => {
    fps.value = String(x.fpsLimit)
    shadows.value = x.shadows ? String(x.shadowMapSize) : 'off'
    effects.value = x.effects
  }
  const syncQuality = () => (quality.value = qualityOf(value()) ?? 'custom')
  fill(v)
  syncQuality()
  quality.addEventListener('change', () => {
    const preset = QUALITY_PRESETS[quality.value as Quality]
    if (preset) fill(preset)
  })
  for (const sel of [fps, shadows, effects]) sel.addEventListener('change', syncQuality)

  const now: string[] = []
  if (state.onBattery && v.batterySaver) now.push('Na bateria agora: o modo Economia está valendo até ligar na tomada.')
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) now.push('O sistema pede menos movimento: os efeitos ficam reduzidos.')
  const el = h(
    'div',
    { class: 'bridge-box' },
    h('div', { class: 'bridge-title' }, icon('gauge', 16), 'Vídeo'),
    h(
      'div',
      { class: 'field-hint' },
      'Economia desliga as sombras, limita a 30 fps e reduz fumaça, faíscas e giroflex. Com o escritório parado ou a janela minimizada, o app já desenha menos sozinho.',
    ),
    h('div', { class: 'field-row' }, field('Qualidade', quality), field('Limite de fps', fps)),
    h('div', { class: 'field-row' }, field('Sombras', shadows), field('Efeitos', effects)),
    h('label', { class: 'check' }, battery, 'Economia automática na bateria'),
    ...(now.length ? [h('div', { class: 'field-hint' }, now.join(' '))] : []),
  )
  return { el, value }
}

/** A number typed in a settings field, or undefined when the field is empty or not a number. */
function numberField(raw: string): number | undefined {
  if (!raw.trim()) return undefined
  const n = Number(raw)
  return Number.isFinite(n) ? n : undefined
}
