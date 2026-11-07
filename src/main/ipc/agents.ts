import { ipcMain } from 'electron'
import { isAbsolute } from 'node:path'
import { isDir } from '../squads'
import { cleanLook } from '../templates'
import { pullRequestRemoteIdentity, repoRoot } from '../git'
import { isPullRequestUrl } from '@shared/pull-request-url'
import {
  worktreeFlagSchema,
  attachmentsSchema,
  cleanBrain,
  cleanHire,
  messageSchema,
  modeIsMorePermissive,
  parse,
  pathSchema,
  permissionDecisionSchema,
  permissionModeSchema,
  subagentLogArgsSchema,
  setHomeResidentArgsSchema,
  setPermissionLevelsArgsSchema,
  homeResidentSchema,
} from '../validate'
import { projectFor } from '@shared/projects'
import type { LevelChange, LevelsSnapshot } from '@shared/permission-levels'
import { applyLevelChanges, levelRows } from '../permissions/screen'
import { normalizeGithubAccounts } from '../git/owner-gate'
import { confirmPermissionOverride, id, type IpcContext } from './context'

/** Agents: hire, summon, talk to them, answer permissions and ack results. */
export function registerAgentsIpc(ctx: IpcContext): void {
  const { store, manager, bridge, updateBadge, defaultBrain } = ctx
  ipcMain.handle('office:getLog', (_e, raw: unknown) => manager.getLog(id(raw)))
  ipcMain.handle('office:getSubagentLog', (_e, ...args: unknown[]) => {
    const [agentId, subId] = parse(subagentLogArgsSchema, args, 'ID inválido.')
    return manager.getSubagentLog(agentId, subId)
  })
  // A permission mode outside the list falls back to the office default.
  ipcMain.handle('office:hire', async (_e, req: unknown) => {
    const record = req && typeof req === 'object' ? (req as Record<string, unknown>) : {}
    const hire = cleanHire({ ...record, confirmPermissionOverride: true }, store.settings)
    const inherited = projectFor(store.settings.projects, hire.cwd)?.permissionMode ?? store.settings.defaultPermissionMode
    if (
      modeIsMorePermissive(hire.permissionMode, inherited) &&
      !(await confirmPermissionOverride(
        ctx.win(),
        `O agente ${hire.name || '(sem nome)'} será contratado para ${hire.cwd}.`,
      ))
    ) {
      throw new Error('Contratação cancelada.')
    }
    return manager.hire({ ...hire, look: cleanLook((req as { look?: unknown } | null)?.look) })
  })
  ipcMain.handle(
    'office:summon',
    async (
      _e,
      cwd: unknown,
      mode: unknown,
      brain: unknown,
      worktree: unknown,
      _confirmOverride: unknown,
      _engine: unknown,
      homeResident: unknown,
    ) => {
      if (!pathSchema.safeParse(cwd).success || !isDir(cwd)) throw new Error('Escolha uma pasta de projeto que exista.')
      const wantsHome = homeResidentSchema.parse(homeResident) ?? false
      const m = permissionModeSchema.safeParse(mode)
      const inherited = projectFor(store.settings.projects, cwd)?.permissionMode ?? store.settings.defaultPermissionMode
      const permissionMode = m.success ? m.data : inherited
      if (
        modeIsMorePermissive(permissionMode, inherited) &&
        !(await confirmPermissionOverride(
          ctx.win(),
          `O agente será chamado para trabalhar em ${cwd}.`,
        ))
      )
        throw new Error('Chamada cancelada.')
      return manager.summon(
        cwd,
        { ...defaultBrain(), ...cleanBrain(brain, store.settings.accounts), permissionMode },
        worktreeFlagSchema.parse(worktree),
        'claude',
        wantsHome,
      )
    },
  )
  // AO-109, parte 4: a tela "Níveis de permissão". SÓ a usuária muda um nível: este canal vem da janela, e nenhuma
  // ferramenta de agente (Luna, Emi, Bonnie, MCP da casa) chama `setPermissionLevel`. Nível inválido recusa o lote todo.
  ipcMain.handle(
    'office:permissionLevels',
    (): LevelsSnapshot => ({ rows: levelRows(manager.list()), githubAccounts: normalizeGithubAccounts(store.settings.githubAccounts) }),
  )
  ipcMain.handle('office:setPermissionLevels', (_e, ...args: unknown[]) => {
    const [changes] = parse(setPermissionLevelsArgsSchema, args, 'Nível inválido: escolha de 1 a 5.')
    applyLevelChanges(manager, changes as LevelChange[], store.settings.githubAccounts)
    return { rows: levelRows(manager.list()), githubAccounts: normalizeGithubAccounts(store.settings.githubAccounts) } satisfies LevelsSnapshot
  })
  ipcMain.handle('office:setHomeResident', (_e, ...args: unknown[]) => {
    const [agentId, resident] = parse(setHomeResidentArgsSchema, args, 'Presença inválida.')
    manager.setHomeResident(agentId, resident)
  })
  ipcMain.handle('office:isGitRepo', async (_e, cwd: unknown) => {
    const p = pathSchema.safeParse(cwd)
    return p.success && isAbsolute(p.data) && isDir(p.data) && !!(await repoRoot(p.data))
  })
  ipcMain.handle('office:send', (_e, raw: unknown, text: unknown, attachments: unknown) =>
    manager.sendMessage(
      id(raw),
      parse(messageSchema, text, 'Mensagem grande demais. Mande em partes ou anexe como arquivo.'),
      undefined,
      parse(attachmentsSchema.optional(), attachments, 'Anexos inválidos.') ?? [],
    ),
  )
  ipcMain.handle('office:interrupt', (_e, raw: unknown) => manager.interrupt(id(raw)))
  ipcMain.handle('office:compact', (_e, raw: unknown) => manager.compact(id(raw)))
  ipcMain.handle('office:clearContext', (_e, raw: unknown) => manager.clearContext(id(raw)))
  ipcMain.handle('office:closeTerminal', (_e, raw: unknown) => bridge.closeSession(id(raw)))

  ipcMain.handle('office:respond', (_e, d: unknown) => manager.respond(parse(permissionDecisionSchema, d, 'Resposta inválida.')))
  ipcMain.handle('office:continueOn', (_e, raw: unknown, account: unknown) => manager.continueOn(id(raw), id(account)))
  ipcMain.handle('office:waitOnSameAccount', (_e, raw: unknown) => manager.waitOnSameAccount(id(raw)))
  ipcMain.handle('office:endQuotaTask', (_e, raw: unknown) => manager.endQuotaTask(id(raw)))
  ipcMain.handle('office:ackResult', async (_e, raw: unknown) => {
    const resultId = id(raw)
    const result = manager.result(resultId)
    const agent = result ? manager.agent(result.agentId) : undefined
    if (result && !result.isError && agent?.role === 'orchestrator' && agent.squad && agent.ticketId) {
      const remote = agent.worktree ? await pullRequestRemoteIdentity(agent.worktree).catch(() => null) : null
      const queue = ctx.creation.queue(agent.squad)
      const pendingPRs = queue && Array.isArray(queue.pendingPRs) ? queue.pendingPRs : []
      const hasVerifiedPR = pendingPRs.some(
        (pr) =>
          pr &&
          typeof pr === 'object' &&
          pr.ticketId === agent.ticketId &&
          typeof pr.ticketKey === 'string' &&
          typeof pr.title === 'string' &&
          typeof pr.branch === 'string' &&
          /^agent\/[a-z0-9][a-z0-9-]{0,60}$/.test(pr.branch) &&
          Number.isFinite(pr.createdAt) &&
          typeof pr.url === 'string' &&
          isPullRequestUrl(pr.url, remote?.host ?? null, remote?.repository ?? null),
      )
      if (!hasVerifiedPR) {
        const message =
          'O resultado continua guardado: a fila do squad ainda não tem o PR verificado deste ticket. Retome a publicação pelo painel do squad; depois que o PR estiver registrado, clique em Recebido de novo.'
        manager.noteAckBlocked(resultId, message)
        throw new Error(message)
      }
    }
    manager.ackResult(resultId)
    updateBadge()
  })
}
