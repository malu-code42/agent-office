import { ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { lstatSync, realpathSync } from 'node:fs'
import { isAbsolute, relative, sep, join } from 'node:path'
import { z } from 'zod'
import { projectFor } from '@shared/projects'
import { squadInRoom } from '@shared/squad-rooms'
import { ticketBrief } from '@shared/tickets'
import { SQUAD_ROOM_COUNT, type ProjectFloor } from '@shared/types'
import { emiTools } from '../emi-tools'
import { copySquadRuntime, findSquad, inspectSquads, isDir, squadDir, squadInfo, validateSquad } from '../squads'
import { brainForTicket } from '../ticket-brain'
import { isBeingCreated, removeSquad } from '../squad-writer'
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
  setSquadPausedArgsSchema,
  parse,
  projectWorkflowBootstrapArgsSchema,
  projectWorkflowBrainstormArgsSchema,
  projectWorkflowDesignArgsSchema,
  projectWorkflowDraftKindSchema,
  projectWorkflowProjectIdSchema,
  projectWorkflowReviewArgsSchema,
  projectWorkflowTicketsArgsSchema,
} from '../validate'
import { confirmPermissionOverride, type IpcContext } from './context'
import { readProjectDocuments } from '../project-workflow-documents'

/** Squads of a project floor. */
export function registerSquadsIpc(ctx: IpcContext): void {
  const { store, manager, defaultBrain } = ctx
  ipcMain.handle('office:listSquads', (_e, cwd: unknown) =>
    pathSchema.safeParse(cwd).success && isDir(cwd) ? ctx.squadStatus.apply(cwd, inspectSquads(cwd)) : [],
  )
  const runSquadCycle = async (cwd: unknown, code: unknown, mode: unknown, note: unknown) => {
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
    const state = ctx.squadStatus.get(cwd, squad.code)
    if (state) throw new Error(`O squad ${squad.code} está ${state === 'paused' ? 'pausado' : 'desativado'}; retome-o antes de rodar.`)
    try {
      validateSquad(squad)
    } catch (err) {
      throw new Error(
        `O squad ${squad.code} está indisponível: ${err instanceof Error ? err.message : String(err)}. Corrija ${join(String(cwd), 'squads', squad.code, 'squad.yaml')} e feche/reabra o Agent Office; nenhuma definição foi alterada.`,
        { cause: err },
      )
    }
    const release = manager.reserveSquadStart(cwd, squad.code)
    if (!release) throw new Error('O ciclo desse squad já está sendo iniciado.')
    try {
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
      const latestState = ctx.squadStatus.get(cwd, squad.code)
      if (latestState)
        throw new Error(`O squad ${squad.code} está ${latestState === 'paused' ? 'pausado' : 'desativado'}; retome-o antes de rodar.`)
      if (ctx.creation.queue(squad.code)?.active !== active?.id) throw new Error('O ticket ativo mudou durante a preparação do ciclo.')
      try {
        const agent = await manager.runSquad(
          squadInfo({ ...squad, cwd: projectFor(store.settings.projects, cwd)!.cwd }),
          `Rode um ciclo do squad ${squad.name} (squads/${squad.code}), do primeiro passo do pipeline até o fim.${ticketNote}${extra ? `\n\nRecado de ${store.settings.playerName}: ${extra}` : ''}`,
          `Rodar um ciclo de ${squad.icon} ${squad.name}${extra ? `\n\n${extra}` : ''}`,
          {
            ...defaultBrain(),
            // AO-86: o par julgado para o ticket ativo; sem ticket, o padrão das configurações.
            ...(active ? brainForTicket(active, defaultBrain()) : {}),
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
    } finally {
      release()
    }
  }
  ipcMain.handle('office:runSquad', (_e, cwd: unknown, code: unknown, mode: unknown, note: unknown, _confirmOverride: unknown) =>
    runSquadCycle(cwd, code, mode, note),
  )

  const workflowProject = (raw: unknown) => {
    const projectId = parse(projectWorkflowProjectIdSchema, raw, 'Andar de projeto inválido.')
    const project = store.settings.projects.find((item) => item.id === projectId)
    if (!project) throw new Error('Esse andar de projeto não existe mais.')
    return project
  }
  ipcMain.handle('office:getProjectWorkflow', (_e, raw: unknown) => ctx.projectWorkflows.get(workflowProject(raw).id))
  ipcMain.handle('office:setProjectWorkflowBootstrap', (_e, ...raw: unknown[]) => {
    const [projectId, status] = parse(projectWorkflowBootstrapArgsSchema, raw, 'Estado do bootstrap inválido.')
    return ctx.projectWorkflows.setBootstrap(workflowProject(projectId).id, status)
  })
  ipcMain.handle('office:saveProjectWorkflowBrainstorm', (_e, ...raw: unknown[]) => {
    const [projectId, goal, brainstorm] = parse(projectWorkflowBrainstormArgsSchema, raw, 'Rascunho do brainstorm inválido.')
    return ctx.projectWorkflows.saveBrainstorm(workflowProject(projectId).id, goal, brainstorm)
  })
  ipcMain.handle('office:approveProjectWorkflowBrainstorm', (_e, raw: unknown) =>
    ctx.projectWorkflows.approveBrainstorm(workflowProject(raw).id),
  )
  ipcMain.handle('office:saveProjectWorkflowDesign', (_e, ...raw: unknown[]) => {
    const [projectId, design, criteria, designPath] = parse(projectWorkflowDesignArgsSchema, raw, 'Rascunho do design inválido.')
    return ctx.projectWorkflows.saveDesign(workflowProject(projectId).id, design, criteria, designPath)
  })
  ipcMain.handle('office:approveProjectWorkflowDesign', (_e, raw: unknown) => ctx.projectWorkflows.approveDesign(workflowProject(raw).id))
  ipcMain.handle('office:saveProjectWorkflowReview', (_e, ...raw: unknown[]) => {
    const [projectId, review] = parse(projectWorkflowReviewArgsSchema, raw, 'Resultado da Revisão Goldfish inválido.')
    return ctx.projectWorkflows.saveReview(workflowProject(projectId).id, review)
  })
  ipcMain.handle('office:approveProjectWorkflowReview', (_e, raw: unknown) => ctx.projectWorkflows.approveReview(workflowProject(raw).id))
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
      squads: () => ctx.squadStatus.apply(floor().cwd, inspectSquads(floor().cwd)),
      plan: () => {
        const w = ctx.projectWorkflows.get(floor().id)
        const ticket = (id: string) => {
          const t = ctx.board.get(id)
          return `- ${t ? `${t.key} · ${t.title}` : id}${w.assignments[id] ? ` · squad ${w.assignments[id]}` : ''}`
        }
        const bootstrap = { pending: 'pendente', done: 'feito', skipped: 'pulado' }[w.bootstrap]
        const ok = (at: number | null) => (at ? 'aprovado' : 'não aprovado')
        if (!w.goal && !w.ticketIds.length) return `Este andar ainda não tem plano aprovado. Bootstrap EGM: ${bootstrap}.`
        return [
          `Objetivo: ${w.goal || '(sem objetivo)'}`,
          `Bootstrap: ${bootstrap} · Brainstorm: ${ok(w.brainstormApprovedAt)} · Design: ${ok(w.designApprovedAt)} · ` +
            `Revisão Goldfish: ${ok(w.reviewApprovedAt)} · Tickets: ${w.ticketsApprovedAt ? 'aprovados' : 'não aprovados'}`,
          '',
          w.design ? `Design doc${w.designPath ? ` (${w.designPath})` : ''}:\n${w.design}` : 'Sem design doc.',
          w.review ? `Revisão Goldfish:\n${w.review}` : '',
          w.criteria.length ? `Critérios:\n${w.criteria.map((c) => `- ${c}`).join('\n')}` : '',
          w.ticketIds.length ? `Tickets do plano:\n${w.ticketIds.map(ticket).join('\n')}` : 'Sem tickets no plano.',
          w.driftReport
            ? `\nÚltimo relatório de drift (${new Date(w.driftReport.at).toISOString().slice(0, 10)}):\n${w.driftReport.summary}`
            : '',
        ].join('\n')
      },
      approvePlan: (plan) => {
        const project = floor()
        const ids = ticketIdsOf(plan.tickets)
        assertFloorTickets(project, ids)
        // The same steps the "Fluxo do projeto" window takes, one after the other, after the user's card.
        const w = ctx.projectWorkflows
        if (plan.bootstrap) w.setBootstrap(project.id, plan.bootstrap)
        w.saveBrainstorm(project.id, plan.goal, plan.brainstorm)
        w.approveBrainstorm(project.id)
        w.saveDesign(project.id, plan.design, plan.criteria, plan.designPath ?? '')
        w.approveDesign(project.id)
        w.saveReview(project.id, plan.review)
        w.approveReview(project.id)
        w.saveTickets(project.id, ids)
        w.approveTickets(project.id)
        return `Plano do andar ${project.name} aprovado, com ${ids.length} ticket${ids.length === 1 ? '' : 's'}.`
      },
      saveDrift: (summary) => {
        ctx.projectWorkflows.saveDriftReport(floor().id, summary)
        return 'Relatório de drift registrado no fluxo do andar. Nada foi alterado: a usuária decide se atualiza o design doc ou o código.'
      },
      // The floor's own permission mode, never a more permissive one: so no override card is needed.
      runSquad: async (code, note) => {
        const agent = await runSquadCycle(floor().cwd, code, undefined, note)
        return `Ciclo do squad ${agent.name} iniciado (${agent.status}). Acompanhe pelo escritório; use squad_message para mandar um recado.`
      },
      messageSquad: (code, text) => {
        const cwd = floor().cwd
        const orch = ctx.manager
          .list()
          .filter((a) => a.role === 'orchestrator' && a.squad === code && a.cwd === cwd)
          .at(-1)
        if (!orch) throw new Error(`O squad ${code} não está rodando. Inicie um ciclo com squad_run.`)
        const sent = `Recado de Emi: ${text}`
        void ctx.manager.sendMessage(orch.id, sent, sent)
        return `Recado entregue ao orquestrador de ${orch.name}, que o repassa aos membros do squad.`
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
      setSquadState: (code, state) => {
        const cwd = floor().cwd
        const squad = findSquad(cwd, squadCodeSchema.parse(code))
        if (!squad) throw new Error(`O squad ${code} não existe neste andar. Use squads_list para ver os códigos.`)
        ctx.squadStatus.set(cwd, squad.code, state)
        ctx.broadcast({ type: 'squads', squads: ctx.rereadSquads() })
        return state === 'paused'
          ? `Squad ${squad.name} pausado: ele não inicia novos ciclos até ser retomado.`
          : state === 'disabled'
            ? `Squad ${squad.name} desativado: ele fica fora dos squads rodáveis até ser retomado.`
            : `Squad ${squad.name} retomado.`
      },
      // Runs only after the user's card (EMI_CONFIRM_TOOLS). Refuses while the squad works or is being written.
      deleteSquad: (code) => {
        const cwd = floor().cwd
        const squad = findSquad(cwd, squadCodeSchema.parse(code))
        if (!squad) throw new Error(`O squad ${code} não existe neste andar.`)
        const dir = squadDir(squad)
        if (lstatSync(dir).isSymbolicLink()) throw new Error(`A pasta squads/${squad.code} é um link; não vou apagar.`)
        if (isBeingCreated(dir)) throw new Error(`O squad ${squad.code} está sendo gravado agora; tente depois.`)
        const busy = ctx.manager.list().find((a) => a.squad === squad.code && a.cwd === cwd && a.status !== 'idle')
        if (busy) throw new Error(`${busy.name} ainda está rodando o squad ${squad.code}; espere ele parar.`)
        const queue = ctx.creation.queue(squad.code)
        if (queue?.active || queue?.cycle)
          throw new Error(`O squad ${squad.code} tem ticket em andamento ou atribuído; espere o ciclo terminar.`)
        removeSquad(cwd, squad.code)
        ctx.squadStatus.set(cwd, squad.code, null)
        ctx.broadcast({ type: 'squads', squads: ctx.rereadSquads() })
        return `Squad ${squad.name} excluído: a pasta squads/${squad.code} foi apagada.`
      },
      createAgent: async (name, task) => {
        const project = floor()
        // Always the default mode, never the floor's: a hire without a card must not inherit a permissive mode.
        const agent = await ctx.manager.hire({
          name,
          cwd: project.cwd,
          task,
          ...defaultBrain(),
          permissionMode: 'default',
          permissionLevel: 3,
          createdByAgent: true,
        })
        return `Agente ${agent.name} contratado no andar ${project.name}.`
      },
      // Only idle agents of this floor; names that match more than one agent are refused.
      deleteAgent: (ref) => {
        const cwd = floor().cwd
        const here = ctx.manager.list().filter((a) => a.cwd === cwd)
        const byId = here.find((a) => a.id === ref)
        const byName = here.filter((a) => a.name === ref)
        if (!byId && byName.length > 1) throw new Error(`Há ${byName.length} agentes chamados ${ref}; use o id.`)
        const agent = byId ?? byName[0]
        if (!agent) throw new Error(`Não achei o agente ${ref} neste andar. Use o nome ou o id mostrado no escritório.`)
        if (agent.status !== 'idle') throw new Error(`${agent.name} está ${agent.status}; espere ele parar antes de dispensar.`)
        ctx.manager.fire(agent.id)
        return `Agente ${agent.name} dispensado.`
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
    const kind = parse(projectWorkflowDraftKindSchema, kindRaw, 'Etapa inválida.')
    const workflow = ctx.projectWorkflows.get(project.id)
    if (kind === 'brainstorm' && !workflow.goal.trim()) throw new Error('Informe o objetivo antes de pedir o brainstorm à Emi.')
    if (kind === 'design' && !workflow.brainstormApprovedAt) throw new Error('Aprove o brainstorm antes de gerar o rascunho do design.')
    if ((kind === 'review' || kind === 'drift') && !workflow.designApprovedAt)
      throw new Error('Aprove o rascunho do design antes de continuar.')
    if ((kind === 'tickets' || kind === 'redistribution') && !workflow.reviewApprovedAt)
      throw new Error('Aprove a Revisão Goldfish antes de continuar.')
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
      cwd: project.cwd,
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
    if (kind === 'brainstorm') {
      const parsed = z.object({ brainstorm: z.string().trim().min(1).max(20_000) }).parse(result)
      return ctx.projectWorkflows.saveBrainstorm(project.id, workflow.goal, parsed.brainstorm)
    }
    if (kind === 'design') {
      const parsed = z
        .object({ design: z.string().trim().min(1).max(20_000), criteria: z.array(z.string().trim().min(1).max(500)).min(1).max(15) })
        .parse(result)
      return ctx.projectWorkflows.saveDesign(project.id, parsed.design, parsed.criteria, workflow.designPath)
    }
    if (kind === 'review') {
      const parsed = z.object({ review: z.string().trim().min(1).max(20_000) }).parse(result)
      return ctx.projectWorkflows.saveReview(project.id, parsed.review)
    }
    if (kind === 'drift') {
      const parsed = z.object({ drift: z.string().trim().min(1).max(20_000) }).parse(result)
      return ctx.projectWorkflows.saveDriftReport(project.id, parsed.drift)
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
  // AO-108: o mesmo estado que a Emi muda com squad_pause e squad_resume; o desativado só a Emi mexe.
  ipcMain.handle('office:setSquadPaused', async (_e, ...args: unknown[]) => {
    const [cwd, code, paused] = parse(setSquadPausedArgsSchema, args, 'Pedido de pausa inválido.')
    if (projectFor(store.settings.projects, cwd)?.cwd !== cwd) throw new Error('Esse andar não existe mais.')
    const squad = findSquad(cwd, code)
    if (!squad) throw new Error(`O squad ${code} não existe neste andar.`)
    const state = ctx.squadStatus.get(cwd, squad.code)
    if (state === 'disabled' && paused) throw new Error(`O squad ${squad.name} está desativado; peça à Emi para reativá-lo.`)
    ctx.squadStatus.set(cwd, squad.code, paused ? 'paused' : null)
    ctx.broadcast({ type: 'squads', squads: ctx.rereadSquads() })
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
