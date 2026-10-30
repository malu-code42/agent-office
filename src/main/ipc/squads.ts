import { ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { isAbsolute, relative, sep, join } from 'node:path'
import { z } from 'zod'
import { projectFor } from '@shared/projects'
import { squadInRoom } from '@shared/squad-rooms'
import { ticketBrief } from '@shared/tickets'
import { SQUAD_ROOM_COUNT, type ProjectFloor } from '@shared/types'
import { emiTools } from '../emi-tools'
import { copySquadRuntime, findSquad, inspectSquads, isDir, squadInfo, validateSquad } from '../squads'
import { createWorktree, excludeSquadRuntime } from '../git'
import {
  checkedSquadMode,
  modeIsMorePermissive,
  pathSchema,
  squadAdjustmentSchema,
  squadApprovalSchema,
  squadCodeSchema,
  squadNoteSchema,
  squadProposalIdSchema,
  squadProposalRequestSchema,
  squadRenameSchema,
  parse,
  projectWorkflowGrillArgsSchema,
  projectWorkflowProjectIdSchema,
  projectWorkflowSpecArgsSchema,
  projectWorkflowTicketsArgsSchema,
} from '../validate'
import { confirmPermissionOverride, type IpcContext } from './context'
import { readProjectDocuments } from '../project-workflow-documents'

/** Squads of a project floor. */
export function registerSquadsIpc(ctx: IpcContext): void {
  const { store, manager, defaultBrain } = ctx
  ipcMain.handle('office:listSquads', (_e, cwd: unknown) => (pathSchema.safeParse(cwd).success && isDir(cwd) ? inspectSquads(cwd) : []))
  ipcMain.handle('office:runSquad', async (_e, cwd: unknown, code: unknown, mode: unknown, note: unknown, _confirmOverride: unknown) => {
    if (!pathSchema.safeParse(cwd).success || !isDir(cwd)) throw new Error('Essa pasta de squads não existe mais.')
    // Orchestrators work in the squad room of their project's floor.
    if (projectFor(store.settings.projects, cwd)?.cwd !== cwd)
      throw new Error('Crie um andar para esse projeto antes de contratar um squad.')
    const plain = squadCodeSchema.safeParse(code)
    const squad = plain.success ? findSquad(cwd, plain.data) : undefined
    if (!squad)
      throw new Error(
        `A definição do squad não foi encontrada em ${join(String(cwd), 'squads', plain.success ? plain.data : '<código>', 'squad.yaml')}. Restaure ou corrija esse arquivo manualmente e feche/reabra o Agent Office; o Agent Office não recria definições.`,
      )
    try {
      validateSquad(squad)
    } catch (err) {
      throw new Error(
        `O squad ${squad.code} está indisponível: ${err instanceof Error ? err.message : String(err)}. Corrija ${join(String(cwd), 'squads', squad.code, 'squad.yaml')} e feche/reabra o Agent Office; nenhuma definição foi alterada.`,
        { cause: err },
      )
    }
    const inherited = projectFor(store.settings.projects, cwd)?.permissionMode ?? store.settings.defaultPermissionMode
    const permissionMode = checkedSquadMode(mode, inherited, true)
    if (
      modeIsMorePermissive(permissionMode, inherited) &&
      !(await confirmPermissionOverride(ctx.win(), `O squad ${squad.name} executará o ciclo com o modo selecionado.`))
    )
      throw new Error('Ciclo cancelado.')
    const extra = (squadNoteSchema.parse(note) ?? '').trim().slice(0, 2000)
    // A ticket cycle gets a fresh worktree from project HEAD. Squad definitions may be
    // untracked, so copy their read-only runtime into the worktree without touching the
    // canonical source or including it in result commits.
    const queue = ctx.creation.queue(squad.code)
    const active = queue?.active ? ctx.board.get(queue.active) : undefined
    const ticketNote = active ? `\n\nA equipe começa pelo ticket ${active.key} (${active.title}):\n${ticketBrief(active)}` : ''
    let worktree
    if (active) {
      const running = manager
        .list()
        .find((a) => a.role === 'orchestrator' && a.squad === squad.code && a.cwd === cwd && a.ticketId === active.id && a.worktree)
      if (running && manager.pendingResults().some((result) => result.agentId === running.id && !result.isError))
        throw new Error(`O resultado do ticket ${active.key} está aguardando publicação segura; não vou substituí-lo.`)
      worktree = running?.worktree ?? (queue?.cycle?.ticketId === active.id ? queue.cycle.worktree : undefined)
      if (!worktree) {
        worktree = await createWorktree(cwd, `${squad.name}-${active.key}`, randomUUID())
        if (!worktree) throw new Error('O ciclo de tickets de squad exige um repositório git para criar uma cópia isolada.')
        ctx.creation.setCycle(squad.code, { ticketId: active.id, worktree })
      }
      try {
        await excludeSquadRuntime(worktree, squad.code)
        copySquadRuntime(cwd, squad.code, worktree.path)
      } catch (err) {
        // Keep both the cycle journal and worktree so the exact copy can be repaired/retried.
        ctx.creation.setStartupError(squad.code, active.id, err instanceof Error ? err.message : String(err))
        throw new Error(
          `Não consegui preparar a definição isolada do squad: ${err instanceof Error ? err.message : String(err)}. A cópia ficou em ${worktree.root}.`,
          { cause: err },
        )
      }
    }
    try {
      const agent = await manager.runSquad(
        squadInfo({ ...squad, cwd: projectFor(store.settings.projects, cwd)!.cwd }),
        `Rode um ciclo do squad ${squad.name} (squads/${squad.code}), do primeiro passo do pipeline até o fim.${ticketNote}${extra ? `\n\nRecado de ${store.settings.playerName}: ${extra}` : ''}`,
        `Rodar um ciclo de ${squad.icon} ${squad.name}${extra ? `\n\n${extra}` : ''}`,
        {
          ...defaultBrain(),
          model: 'claude-haiku-5-5',
          // Same rule as tickets: a cycle reaches real systems, so it never runs with "bypass".
          permissionMode,
        },
        worktree,
        active?.id,
      )
      if (active) ctx.creation.clearStartupError(squad.code, active.id)
      return agent
    } catch (err) {
      if (active && ctx.creation.queue(squad.code)?.cycle?.ticketId === active.id)
        ctx.creation.setStartupError(squad.code, active.id, err instanceof Error ? err.message : String(err))
      throw err
    }
  })

  const workflowProject = (raw: unknown) => {
    const projectId = parse(projectWorkflowProjectIdSchema, raw, 'Andar de projeto inválido.')
    const project = store.settings.projects.find((item) => item.id === projectId)
    if (!project) throw new Error('Esse andar de projeto não existe mais.')
    return project
  }
  ipcMain.handle('office:getProjectWorkflow', (_e, raw: unknown) => ctx.projectWorkflows.get(workflowProject(raw).id))
  ipcMain.handle('office:saveProjectWorkflowGrill', (_e, ...raw: unknown[]) => {
    const [projectId, goal, grill] = parse(projectWorkflowGrillArgsSchema, raw, 'Rascunho do grill inválido.')
    const project = workflowProject(projectId)
    return ctx.projectWorkflows.saveGrill(project.id, goal, grill)
  })
  ipcMain.handle('office:approveProjectWorkflowGrill', (_e, raw: unknown) => {
    const project = workflowProject(raw)
    return ctx.projectWorkflows.approveGrill(project.id)
  })
  ipcMain.handle('office:saveProjectWorkflowSpec', (_e, ...raw: unknown[]) => {
    const [projectId, spec, criteria] = parse(projectWorkflowSpecArgsSchema, raw, 'Rascunho da especificação inválido.')
    const project = workflowProject(projectId)
    return ctx.projectWorkflows.saveSpec(project.id, spec, criteria)
  })
  ipcMain.handle('office:approveProjectWorkflowSpec', (_e, raw: unknown) => {
    const project = workflowProject(raw)
    return ctx.projectWorkflows.approveSpec(project.id)
  })
  const assertFloorTickets = (project: ProjectFloor, ticketIds: string[]) => {
    for (const id of ticketIds) {
      const ticket = ctx.board.get(id)
      if (!ticket || projectFor(store.settings.projects, ticket.cwd)?.id !== project.id || ticket.closedAt)
        throw new Error('Todos os tickets precisam estar abertos e pertencer a este andar.')
    }
  }
  ipcMain.handle('office:saveProjectWorkflowTickets', (_e, ...raw: unknown[]) => {
    const [projectId, ticketIds] = parse(projectWorkflowTicketsArgsSchema, raw, 'Seleção de tickets inválida.')
    const project = workflowProject(projectId)
    assertFloorTickets(project, ticketIds)
    return ctx.projectWorkflows.saveTickets(project.id, ticketIds)
  })

  // ---------- Emi, the facilitator of each floor: the same stores and writers, from her chat ----------

  const ticketIdsOf = (keys: string[]) =>
    keys.map((key) => {
      const ticket = ctx.board.byKey(key.trim())
      if (!ticket) throw new Error(`Não achei o ticket aberto ${key}. Use tickets_list para ver as chaves.`)
      return ticket.id
    })
  ctx.manager.emiTools = (projectId) => {
    const floor = () => workflowProject(projectId)
    return emiTools({
      squads: () => inspectSquads(floor().cwd),
      plan: () => {
        const w = ctx.projectWorkflows.get(floor().id)
        const ticket = (id: string) => {
          const t = ctx.board.get(id)
          return `- ${t ? `${t.key} · ${t.title}` : id}${w.assignments[id] ? ` · squad ${w.assignments[id]}` : ''}`
        }
        if (!w.goal && !w.ticketIds.length) return 'Este andar ainda não tem plano aprovado.'
        return [
          `Objetivo: ${w.goal || '(sem objetivo)'}`,
          `Grill: ${w.grillApprovedAt ? 'aprovado' : 'não aprovado'} · Spec: ${w.specApprovedAt ? 'aprovada' : 'não aprovada'} · Tickets: ${w.ticketsApprovedAt ? 'aprovados' : 'não aprovados'}`,
          '',
          w.spec ? `Especificação:\n${w.spec}` : 'Sem especificação.',
          w.criteria.length ? `Critérios:\n${w.criteria.map((c) => `- ${c}`).join('\n')}` : '',
          w.ticketIds.length ? `Tickets do plano:\n${w.ticketIds.map(ticket).join('\n')}` : 'Sem tickets no plano.',
        ].join('\n')
      },
      approvePlan: (plan) => {
        const project = floor()
        const ids = ticketIdsOf(plan.tickets)
        assertFloorTickets(project, ids)
        // The same steps the "Fluxo do projeto" window takes, one after the other, after the user's card.
        const w = ctx.projectWorkflows
        w.saveGrill(project.id, plan.goal, plan.grill)
        w.approveGrill(project.id)
        w.saveSpec(project.id, plan.spec, plan.criteria)
        w.approveSpec(project.id)
        w.saveTickets(project.id, ids)
        w.approveTickets(project.id)
        return `Plano do andar ${project.name} aprovado, com ${ids.length} ticket${ids.length === 1 ? '' : 's'}.`
      },
      createSquad: async (req) => {
        const project = floor()
        const squads = inspectSquads(project.cwd)
        const held = (room: number) =>
          ctx.creation.list().some((p) => p.projectId === project.id && p.room === room && p.status !== 'assigned')
        const room =
          req.room !== undefined
            ? req.room - 1
            : Array.from({ length: SQUAD_ROOM_COUNT }, (_, i) => i).find((r) => !squadInRoom(squads, r) && !held(r))
        if (room === undefined) throw new Error('Todas as salas de squad deste andar estão ocupadas.')
        const id = randomUUID()
        await ctx.creation.propose({
          id,
          projectId: project.id,
          room,
          brief: req.brief,
          ticketIds: ticketIdsOf(req.tickets),
          members: req.members,
        })
        try {
          const { squad } = await ctx.creation.approve(id, req.name)
          ctx.broadcast({ type: 'squads', squads: ctx.rereadSquads() })
          return squad
        } catch (err) {
          // A refused approval must not leave a proposal holding the room.
          if (ctx.creation.get(id)?.status === 'pending') ctx.creation.discard(id)
          throw err
        }
      },
    })
  }
  ipcMain.handle('office:approveProjectWorkflowTickets', (_e, raw: unknown) => {
    const project = workflowProject(raw)
    const workflow = ctx.projectWorkflows.get(project.id)
    if (!workflow.ticketsApprovedAt && workflow.ticketIds.length === 0 && workflow.ticketDrafts?.length) {
      const vaultPath = store.settings.vaultPath
      if (vaultPath) {
        try {
          const root = realpathSync(project.cwd)
          const vault = realpathSync(vaultPath)
          const rel = relative(vault, root)
          if (rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel)))
            throw new Error('O fluxo da Emi não pode criar tickets dentro do vault real.')
        } catch (error) {
          if (error instanceof Error && error.message.includes('vault real')) throw error
        }
      }
      const ids = workflow.ticketDrafts.map(
        (draft) =>
          ctx.board.create(
            {
              title: draft.title,
              description: draft.description,
              acceptance: draft.acceptance.map((text) => ({ text, done: false })),
              cwd: project.cwd,
            },
            ctx.player(),
          ).id,
      )
      ctx.projectWorkflows.saveTickets(project.id, ids)
    }
    return ctx.projectWorkflows.approveTickets(project.id)
  })

  ipcMain.handle('office:generateProjectWorkflowDraft', async (_e, projectIdRaw: unknown, kindRaw: unknown) => {
    const project = workflowProject(projectIdRaw)
    const kind = z.enum(['grill', 'spec', 'tickets', 'redistribution']).parse(kindRaw)
    const workflow = ctx.projectWorkflows.get(project.id)
    if (kind === 'grill' && !workflow.goal.trim()) throw new Error('Informe o objetivo antes de pedir o grill à Emi.')
    if (kind === 'spec' && !workflow.grillApprovedAt) throw new Error('Aprove o grill antes de gerar a especificação.')
    if ((kind === 'tickets' || kind === 'redistribution') && !workflow.specApprovedAt)
      throw new Error('Aprove a especificação antes de continuar.')
    const docs = (() => {
      if (store.settings.vaultPath) {
        try {
          const root = realpathSync(project.cwd)
          const vault = realpathSync(store.settings.vaultPath)
          const rel = relative(vault, root)
          if (rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel)))
            throw new Error('A Emi não lê documentos do vault real. Configure um projeto separado fora do vault.')
        } catch (error) {
          if (error instanceof Error && error.message.includes('vault real')) throw error
        }
      }
      return readProjectDocuments(project.cwd, store.settings.vaultPath ? [store.settings.vaultPath] : [])
    })()
    const result = await ctx.projectWorkflowGenerator.generate({
      kind,
      workflow,
      documents: docs.documents,
      squads:
        kind === 'redistribution'
          ? ctx
              .rereadSquads()
              .filter((squad) => squad.cwd === project.cwd)
              .map((squad) => squad.code)
          : undefined,
      tickets:
        kind === 'redistribution'
          ? workflow.ticketIds.flatMap((id) => {
              const ticket = ctx.board.get(id)
              return ticket && !ticket.closedAt ? [{ id, title: ticket.title, description: ticket.description }] : []
            })
          : undefined,
    })
    if (kind === 'grill') {
      const parsed = z.object({ grill: z.string().trim().min(1).max(20_000) }).parse(result)
      return ctx.projectWorkflows.saveGrill(project.id, workflow.goal, parsed.grill)
    }
    if (kind === 'spec') {
      const parsed = z
        .object({ spec: z.string().trim().min(1).max(20_000), criteria: z.array(z.string().trim().min(1).max(500)).min(1).max(15) })
        .parse(result)
      return ctx.projectWorkflows.saveSpec(project.id, parsed.spec, parsed.criteria)
    }
    if (kind === 'tickets') {
      const parsed = z
        .object({
          tickets: z
            .array(
              z
                .object({
                  title: z.string().trim().min(1).max(200),
                  description: z.string().max(4000),
                  acceptance: z.array(z.string().max(500)).max(20),
                })
                .strict(),
            )
            .min(1)
            .max(30),
        })
        .strict()
        .parse(result)
      return ctx.projectWorkflows.saveTicketDrafts(project.id, parsed.tickets)
    }
    const parsed = z
      .object({
        changes: z
          .array(
            z
              .object({
                ticketId: z.string().min(1).max(100),
                fromSquad: z.string().max(64).nullable(),
                toSquad: z.string().max(64).nullable(),
              })
              .strict(),
          )
          .max(30),
      })
      .strict()
      .parse(result)
    return ctx.projectWorkflows.saveRedistributionProposal(project.id, parsed.changes)
  })
  ipcMain.handle('office:approveProjectWorkflowRedistribution', (_e, raw: unknown) => {
    const project = workflowProject(raw)
    const workflow = ctx.projectWorkflows.get(project.id)
    const proposal = workflow.redistributionProposal
    if (!proposal || proposal.approvedAt) throw new Error('Não há proposta pendente para aprovar.')
    ctx.creation.redistribute(project.id, proposal.changes)
    return ctx.projectWorkflows.approveRedistribution(project.id)
  })

  // ---------- a squad proposed for an empty room (ticket 04) ----------

  // The page sends the id of the proposal and the room it means: never a path.
  ipcMain.handle('office:proposeSquad', async (_e, raw: unknown) => {
    const input = parse(squadProposalRequestSchema, raw, 'Proposta inválida.')
    return ctx.creation.propose(input)
  })
  ipcMain.handle('office:adjustSquadProposal', async (_e, raw: unknown) => {
    const input = parse(squadAdjustmentSchema, raw, 'Ajuste inválido.')
    return ctx.creation.adjust(input.id, input.adjustment, input.name)
  })
  ipcMain.handle('office:renameSquadProposal', async (_e, raw: unknown) => {
    const input = parse(squadRenameSchema, raw, 'Nome inválido.')
    return ctx.creation.rename(input.id, input.name)
  })
  ipcMain.handle('office:discardSquadProposal', (_e, raw: unknown) => {
    const { id } = parse(squadProposalIdSchema, raw, 'Proposta inválida.')
    ctx.creation.discard(id)
  })
  ipcMain.handle('office:approveSquadProposal', async (_e, raw: unknown) => {
    const input = parse(squadApprovalSchema, raw, 'Aprovação inválida.')
    const { squad } = await ctx.creation.approve(input.id, input.name)
    // The room has a squad now: the floor is built again with it.
    ctx.broadcast({ type: 'squads', squads: ctx.rereadSquads() })
    return squad
  })
  ipcMain.handle('office:squadQueue', (_e, code: unknown) => {
    const plain = squadCodeSchema.safeParse(code)
    return plain.success ? ctx.creation.queue(plain.data) : undefined
  })
  ipcMain.handle('office:retrySquadPublication', async (_e, code: unknown) => {
    const parsed = squadCodeSchema.safeParse(code)
    if (!parsed.success) throw new Error('Squad inválido.')
    return ctx.retrySquadPublication(parsed.data)
  })
  ipcMain.handle('office:retrySquadStart', async (_e, code: unknown) => {
    const parsed = squadCodeSchema.safeParse(code)
    if (!parsed.success) throw new Error('Squad inválido.')
    const queue = ctx.creation.queue(parsed.data)
    if (!queue?.active || queue.cycle?.ticketId !== queue.active) throw new Error('Não há ciclo ativo salvo para retomar.')
    await ctx.startActiveSquadTicket(parsed.data)
  })
}
