import { dialog, ipcMain, shell } from 'electron'
import { existsSync } from 'node:fs'
import { commitChanges, discardChanges, fileDiff, insideRoot, openInEditor, openPullRequest, pendingLoss, pullRequestRemoteIdentity, removeWorktree, worktreeState } from '../git'
import { changedPathSchema, commitMessageSchema, prTitleSchema, uuidSchema, parse } from '../validate'
import { isSquadTicketResultAgent } from '@shared/squad-ticket-result'
import { id, type IpcContext } from './context'
import { isPullRequestUrl } from '@shared/pull-request-url'

/** Worktrees (AO-33) and the result card's changed files (AO-34). */
export function registerWorktreesIpc(ctx: IpcContext): void {
  const { win, manager, nameOf } = ctx
  // ---------- worktrees (AO-33) ----------
  // What the player chose in the native dialog of prepareFire. Only that dialog can
  // authorize removing a worktree: the renderer never sends "remove".
  const fireChoices = new Map<string, { remove: boolean; dirty: number; ignored: number; fingerprint: string }>()
  const agentId = (raw: unknown) => parse(uuidSchema, raw, 'Esse agente não está mais no escritório.')
  const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`
  ipcMain.handle('office:prepareFire', async (_e, raw: unknown) => {
    const a = manager.agent(agentId(raw))
    const wt = a?.worktree
    if (!a || !wt) return 'plain'
    const st = await worktreeState(wt).catch(() => null)
    if (!st?.exists) {
      fireChoices.set(a.id, { remove: false, dirty: 0, ignored: 0, fingerprint: '' })
      return 'plain'
    }
    const kept = st.ahead ? ` O branch tem ${st.ahead} commit${st.ahead > 1 ? 's' : ''} e fica no repositório mesmo se você remover a cópia.` : ''
    // git worktree remove also deletes ignored files (.env, node_modules): say so.
    const ignoredLine = st.ignored
      ? `\n\nTem também ${plural(st.ignored, 'arquivo ou pasta ignorado', 'arquivos ou pastas ignorados')} pelo git (como .env ou node_modules), que somem junto com a cópia.`
      : ''
    const { response } = await dialog.showMessageBox(win()!, {
      type: 'question',
      buttons: ['Manter a cópia', 'Remover a cópia', 'Cancelar'],
      defaultId: 0,
      cancelId: 2,
      message: `Dispensar ${a.name}?`,
      detail:
        `A sessão para e o agente vai embora. Ele trabalhava numa cópia isolada (branch ${wt.branch}) em ${wt.root}.\n\n` +
        (st.dirty ? `A cópia tem ${st.dirty} arquivo${st.dirty > 1 ? 's' : ''} com mudanças não commitadas.` : 'A cópia não tem mudanças não commitadas.') +
        kept +
        ignoredLine,
    })
    if (response === 2) return 'cancelled'
    if (response === 1 && pendingLoss(st)) {
      const what = [
        st.dirty ? plural(st.dirty, 'mudança não commitada', 'mudanças não commitadas') : '',
        st.ignored ? plural(st.ignored, 'arquivo ignorado pelo git', 'arquivos ignorados pelo git') : '',
      ].filter(Boolean)
      const sure = await dialog.showMessageBox(win()!, {
        type: 'warning',
        buttons: ['Apagar e dispensar', 'Cancelar'],
        defaultId: 1,
        cancelId: 1,
        message: `Apagar ${what.join(' e ')}?`,
        detail:
          'Não dá para desfazer. Para guardar o trabalho, cancele e use "Commitar" no cartão de resultado' +
          (st.ignored ? '; copie antes os arquivos ignorados que quiser manter (.env, configs locais).' : '.'),
      })
      if (sure.response !== 0) return 'cancelled'
    }
    fireChoices.set(a.id, { remove: response === 1, dirty: st.dirty, ignored: st.ignored, fingerprint: st.fingerprint })
    return 'confirmed'
  })
  ipcMain.handle('office:fire', async (_e, raw: unknown) => {
    const aid = id(raw)
    const wt = manager.agent(aid)?.worktree
    const choice = fireChoices.get(aid)
    fireChoices.delete(aid)
    manager.fire(aid)
    if (!wt) return
    if (!choice?.remove) return `A cópia isolada ficou em ${wt.root} (branch ${wt.branch}).`
    // Forced only when the player confirmed losing exactly these files; any change since keeps the copy.
    const now = await worktreeState(wt).catch(() => null)
    const force = pendingLoss(choice) > 0 && !!now && now.fingerprint === choice.fingerprint
    return removeWorktree(wt, force).catch((err) => `Não consegui remover a cópia: ${err instanceof Error ? err.message : String(err)}`)
  })

  // ---------- result card: changed files (AO-34) ----------
  const changesFor = (raw: unknown) => {
    const r = manager.result(parse(uuidSchema, raw, 'Esse resultado já foi recebido.'))
    if (!r) throw new Error('Esse resultado já foi recebido.')
    if (!r.changes) throw new Error('Ainda não sei o que esse agente mudou.')
    return { r, c: r.changes }
  }
  const assertManualPublishAllowed = (agentId: string) => {
    if (isSquadTicketResultAgent(manager.agent(agentId)))
      throw new Error('Resultados de tickets da squad são publicados pela fila de PR; use a revisão da squad ou da inbox.')
  }
  ipcMain.handle('office:resultDiff', (_e, raw: unknown, path: unknown) => {
    const { c } = changesFor(raw)
    return fileDiff(c, parse(changedPathSchema, path, 'Caminho inválido.'))
  })
  ipcMain.handle('office:openResultInEditor', async (_e, raw: unknown, path: unknown) => {
    const { c } = changesFor(raw)
    const p = changedPathSchema.optional().safeParse(path)
    const file = p.success && p.data && c.files.some((f) => f.path === p.data) ? p.data : undefined
    if (await openInEditor(c.root, file)) return true
    // No Cursor or VS Code: show it in Finder. Never shell.openPath: the agent may have
    // written a .command or .app, and the default app would run it.
    const target = file ? insideRoot(c.root, file) : c.root
    if (target && existsSync(target)) shell.showItemInFolder(target)
    return false
  })
  ipcMain.handle('office:discardResult', async (_e, raw: unknown) => {
    const { r, c } = changesFor(raw)
    assertManualPublishAllowed(r.agentId)
    if (!c.git || c.committed || c.discarded) throw new Error('Não há mudanças para descartar aqui.')
    const n = c.files.filter((f) => f.restorable).length
    const { response } = await dialog.showMessageBox(win()!, {
      type: 'warning',
      buttons: ['Descartar mudanças', 'Cancelar'],
      defaultId: 1,
      cancelId: 1,
      message: `Descartar as mudanças de ${n} arquivo${n === 1 ? '' : 's'}?`,
      detail:
        `Os arquivos voltam a ser como eram quando ${nameOf(r.agentId)} começou a tarefa, em ${c.root}. Arquivos criados pela tarefa são apagados. ` +
        'Mudanças que você já tinha antes da tarefa ficam. Não dá para desfazer.',
    })
    if (response !== 0) return null
    const done = await discardChanges(c)
    const next = { ...c, discarded: true }
    manager.setChanges(r.id, next)
    if (done.skipped.length) dialog.showErrorBox('Alguns arquivos ficaram como estão', `Não deu para restaurar:\n${done.skipped.slice(0, 20).join('\n')}`)
    return next
  })
  ipcMain.handle('office:commitResult', async (_e, raw: unknown, message: unknown) => {
    const { r, c } = changesFor(raw)
    assertManualPublishAllowed(r.agentId)
    const msg = parse(commitMessageSchema, message, 'Escreva uma mensagem de commit (até 2000 caracteres).')
    if (!c.git || c.committed || c.discarded) throw new Error('Não há mudanças para commitar aqui.')
    const sha = await commitChanges(c, msg)
    const next = { ...c, committed: sha }
    manager.setChanges(r.id, next)
    return next
  })
  ipcMain.handle('office:openResultPR', async (_e, raw: unknown, title: unknown) => {
    const { r } = changesFor(raw)
    assertManualPublishAllowed(r.agentId)
    const wt = manager.agent(r.agentId)?.worktree
    if (!wt) throw new Error('Só dá para abrir PR de um agente que trabalha numa cópia isolada (worktree).')
    const t = parse(prTitleSchema, title, 'Escreva um título para o PR.')
    const { response } = await dialog.showMessageBox(win()!, {
      type: 'question',
      buttons: ['Enviar e abrir PR', 'Cancelar'],
      defaultId: 0,
      cancelId: 1,
      message: `Abrir um pull request do branch ${wt.branch}?`,
      detail: `Vamos rodar git push do branch para o remoto do repositório e gh pr create com o título "${t}" e o relatório do agente como descrição.`,
    })
    if (response !== 0) return null
    const body = `${r.text.slice(0, 6000)}\n\n---\nAberto pelo Agent Office (${nameOf(r.agentId)}, branch \`${wt.branch}\`).`
    const remote = await pullRequestRemoteIdentity(wt)
    const url = await openPullRequest(wt, t, body)
    if (!isPullRequestUrl(url, remote.host, remote.repository)) throw new Error('A URL do PR não corresponde ao repositório remoto; nenhum bloqueio foi liberado.')
    const candidates = ctx.board.list().filter((item) => item.assignee?.id === r.agentId && item.status === 'review' && !item.pullRequestUrl)
    const ticket = r.ticketId ? ctx.board.get(r.ticketId) : candidates.length === 1 ? candidates[0] : undefined
    if (ticket && ticket.assignee?.id === r.agentId && ticket.status === 'review' && !ticket.pullRequestUrl) {
      ctx.board.recordPullRequest(ticket.id, url, { kind: 'agent', name: nameOf(r.agentId), id: r.agentId })
      ctx.board.flush()
      const started = ctx.creation.reconcileBlockedQueues()
      for (const code of started) {
        try {
          await ctx.startActiveSquadTicket(code)
        } catch (err) {
          const active = ctx.creation.queue(code)?.active
          if (active) ctx.creation.setStartupError(code, active, err instanceof Error ? err.message : String(err))
        }
      }
    }
    return url
  })
}
