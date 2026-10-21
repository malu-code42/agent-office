import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ResultChanges, WorktreeInfo } from '../src/shared/types'
import { gitRemoteHost, gitRemoteRepository, isPullRequestUrl } from '../src/shared/pull-request-url'
import { publishSquadTicket, publishThenStartNext, publishableChanges, SquadPublicationGate } from '../src/main/squad-ticket-lifecycle'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ao-squad-pr-'))
  mkdirSync(join(root, 'src'), { recursive: true })
  mkdirSync(join(root, 'squads', 'build'), { recursive: true })
  mkdirSync(join(root, '_opensquad', 'core'), { recursive: true })
  writeFileSync(join(root, 'src', 'app.ts'), 'new')
  writeFileSync(join(root, 'squads', 'build', 'squad.yaml'), 'canonical')
  writeFileSync(join(root, '_opensquad', 'core', 'runner.pipeline.md'), 'runner')
  const worktree: WorktreeInfo = { path: root, root, repo: root, branch: 'agent/squad-build-ticket-1', base: 'a'.repeat(40) }
  const changes: ResultChanges = {
    git: true,
    root,
    files: [
      { path: 'src/app.ts', status: 'added' },
      { path: 'squads/build/squad.yaml', status: 'added' },
      { path: '_opensquad/core/runner.pipeline.md', status: 'added' },
    ],
  }
  return { root, worktree, changes, ticket: { id: 'ticket-1', key: 'AO-1', title: 'Implementar' } }
}

describe('publicação de ticket de squad', () => {
  it('valida URL de PR contra o host e repositório do remoto HTTPS/SSH', () => {
    expect(isPullRequestUrl('https://github.example.com/org/repo/pull/1', 'github.example.com', 'org/repo')).toBe(true)
    expect(isPullRequestUrl('https://github.example.com/other/repo/pull/1', 'github.example.com', 'org/repo')).toBe(false)
    expect(isPullRequestUrl('https://attacker.example/org/repo/pull/1', 'github.example.com', 'org/repo')).toBe(false)
    expect(isPullRequestUrl('https://github.example.com/org/repo/pull/1', null, 'org/repo')).toBe(false)
    expect(gitRemoteHost('https://github.example.com/org/repo.git')).toBe('github.example.com')
    expect(gitRemoteHost('https://github.example.com:8443/org/repo.git')).toBe('github.example.com:8443')
    expect(gitRemoteHost('git@github.example.com:org/repo.git')).toBe('github.example.com')
    expect(gitRemoteHost('ssh://git@github.example.com/org/repo.git')).toBe('github.example.com')
    expect(gitRemoteRepository('https://github.example.com/org/repo.git')).toBe('org/repo')
    expect(gitRemoteRepository('git@github.example.com:org/repo.git')).toBe('org/repo')
    expect(gitRemoteRepository('ssh://git@github.example.com/org/repo.git')).toBe('org/repo')
    expect(isPullRequestUrl('https://github.example.com:8443/org/repo/pull/1', 'github.example.com:8443', 'org/repo')).toBe(true)
    expect(isPullRequestUrl('https://github.example.com/org/repo/pull/1', 'github.example.com:8443', 'org/repo')).toBe(false)
  })
  it('recusa tentativas simultâneas duplicadas para o mesmo ticket', () => {
    const gate = new SquadPublicationGate()
    expect(gate.enter('build:t1')).toBe(true)
    expect(gate.enter('build:t1')).toBe(false)
    gate.leave('build:t1')
    expect(gate.enter('build:t1')).toBe(true)
  })
  it('filtra definições copiadas sem incluir outros arquivos do projeto', () => {
    const f = fixture()
    expect(publishableChanges(f.changes, f.worktree, 'build').files.map((x) => x.path)).toEqual(['src/app.ts'])
  })

  it('commita mudanças rastreadas com o caminho seguro e só registra após receber URL', async () => {
    const f = fixture()
    const commit = vi.fn().mockResolvedValue('abc123')
    const openPR = vi.fn().mockResolvedValue('https://github.com/org/repo/pull/1')
    const record = vi.fn()
    const result = await publishSquadTicket(
      { ...f, squad: 'build', result: 'Pronto', now: 10 },
      {
        state: async () => ({ exists: true, dirty: 1, ignored: 2, ahead: 0, fingerprint: 'x' }),
        remoteIdentity: async () => ({ host: 'github.com', repository: 'org/repo' }),
        existingPR: async () => null,
        commit,
        openPR,
        record,
      },
    )
    expect(result).toBe('https://github.com/org/repo/pull/1')
    expect(commit).toHaveBeenCalledWith(expect.objectContaining({ files: [{ path: 'src/app.ts', status: 'added' }] }), 'AO-1: Implementar')
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ ticketId: 'ticket-1', branch: f.worktree.branch, createdAt: 10 }))
  })

  it('recupera PR existente sem repetir commit nem criação', async () => {
    const f = fixture()
    const commit = vi.fn()
    const openPR = vi.fn()
    const record = vi.fn()
    await publishSquadTicket(
      { ...f, squad: 'build', result: 'Pronto' },
      {
        state: vi.fn(),
        remoteIdentity: async () => ({ host: 'github.com', repository: 'org/repo' }),
        existingPR: async () => 'https://github.com/org/repo/pull/8',
        commit,
        openPR,
        record,
      },
    )
    expect(commit).not.toHaveBeenCalled()
    expect(openPR).not.toHaveBeenCalled()
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://github.com/org/repo/pull/8' }))
  })

  it('não registra nem libera a fila se o PR existente pertence a outro host', async () => {
    const f = fixture()
    const record = vi.fn()
    await expect(publishSquadTicket(
      { ...f, squad: 'build', result: 'Pronto' },
      {
        state: vi.fn(), remoteIdentity: async () => ({ host: 'github.example.com', repository: 'org/repo' }),
        existingPR: async () => 'https://attacker.example/org/repo/pull/8',
        commit: vi.fn(), openPR: vi.fn(), record,
      },
    )).rejects.toThrow('repositório remoto')
    expect(record).not.toHaveBeenCalled()
  })

  it('não registra nem libera a fila se o PR pertence a outro repositório no mesmo host', async () => {
    const f = fixture()
    const record = vi.fn()
    await expect(publishSquadTicket(
      { ...f, squad: 'build', result: 'Pronto' },
      {
        state: vi.fn(), remoteIdentity: async () => ({ host: 'github.com', repository: 'org/repo' }),
        existingPR: async () => 'https://github.com/attacker/repo/pull/8',
        commit: vi.fn(), openPR: vi.fn(), record,
      },
    )).rejects.toThrow('repositório remoto')
    expect(record).not.toHaveBeenCalled()
  })

  it('não registra nem libera a fila se a nova URL de PR pertence a outro host', async () => {
    const f = fixture()
    const record = vi.fn()
    await expect(publishSquadTicket(
      { ...f, squad: 'build', result: 'Pronto' },
      {
        state: async () => ({ exists: true, dirty: 0, ignored: 0, ahead: 1, fingerprint: '' }),
        remoteIdentity: async () => ({ host: 'github.example.com', repository: 'org/repo' }), existingPR: async () => null,
        commit: vi.fn(), openPR: async () => 'https://attacker.example/org/repo/pull/8', record,
      },
    )).rejects.toThrow('repositório remoto')
    expect(record).not.toHaveBeenCalled()
  })

  it('reconstrói o diff salvo quando o crash ocorreu antes de anexar result.changes', async () => {
    const f = fixture()
    const reconstruct = vi.fn().mockResolvedValue(f.changes)
    const commit = vi.fn().mockResolvedValue('sha')
    const releaseTicketForReview = vi.fn()
    const saveChanges = vi.fn()
    await publishSquadTicket(
      { ...f, changes: undefined, squad: 'build', result: 'Pronto' },
      {
        reconstruct,
        state: async () => ({ exists: true, dirty: 1, ignored: 0, ahead: 0, fingerprint: '' }),
        remoteIdentity: async () => ({ host: 'github.com', repository: 'org/repo' }),
        existingPR: async () => null,
        commit,
        changes: saveChanges,
        committed: (changes, sha) => saveChanges({ ...changes, committed: sha }),
        openPR: async () => 'https://github.com/org/repo/pull/30',
        record: (pr) => releaseTicketForReview(pr),
      },
    )
    expect(reconstruct).toHaveBeenCalledWith(f.worktree)
    expect(commit).toHaveBeenCalledWith(expect.objectContaining({ files: [{ path: 'src/app.ts', status: 'added' }] }), 'AO-1: Implementar')
    expect(saveChanges).toHaveBeenNthCalledWith(1, f.changes)
    expect(saveChanges).toHaveBeenNthCalledWith(2, { ...f.changes, committed: 'sha' })
    expect(releaseTicketForReview).toHaveBeenCalledOnce()
    expect(releaseTicketForReview).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://github.com/org/repo/pull/30' }))
  })

  it('falha na reconstrução de forma retryable sem reexecutar agente; retry reconstrói e libera a fila após PR', async () => {
    const f = fixture()
    const reconstruct = vi.fn().mockRejectedValueOnce(new Error('base ausente')).mockResolvedValueOnce(f.changes)
    const runAgent = vi.fn()
    const commit = vi.fn().mockResolvedValue('sha')
    const released = vi.fn()
    let publicationError: string | undefined
    const publish = async () => {
      try {
        await publishSquadTicket(
          { ...f, changes: undefined, squad: 'build', result: 'Pronto' },
          {
            reconstruct,
            state: async () => ({ exists: true, dirty: 1, ignored: 0, ahead: 0, fingerprint: '' }),
            remoteIdentity: async () => ({ host: 'github.com', repository: 'org/repo' }),
            existingPR: async () => null,
            commit,
            openPR: async () => 'https://github.com/org/repo/pull/31',
            record: released,
          },
        )
        publicationError = undefined
      } catch (error) {
        publicationError = error instanceof Error ? error.message : String(error)
      }
    }

    await publish()
    expect(publicationError).toBe('base ausente')
    expect(runAgent).not.toHaveBeenCalled()
    expect(released).not.toHaveBeenCalled()

    await publish()
    expect(publicationError).toBeUndefined()
    expect(runAgent).not.toHaveBeenCalled()
    expect(reconstruct).toHaveBeenCalledTimes(2)
    expect(commit).toHaveBeenCalledOnce()
    expect(released).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://github.com/org/repo/pull/31' }))
  })

  it('mantém o ticket bloqueado sem commit genérico se não puder reconstruir o diff', async () => {
    const f = fixture()
    const commit = vi.fn()
    await expect(publishSquadTicket(
      { ...f, changes: undefined, squad: 'build', result: 'Pronto' },
      { reconstruct: async () => { throw new Error('base ausente') }, state: vi.fn(), remoteIdentity: async () => ({ host: 'github.com', repository: 'org/repo' }), existingPR: vi.fn(), commit, openPR: vi.fn(), record: vi.fn() },
    )).rejects.toThrow('base ausente')
    expect(commit).not.toHaveBeenCalled()
  })

  it('após commit e push sem gh pr create, retry reaproveita o commit do branch', async () => {
    const f = fixture()
    const commit = vi.fn()
    const openPR = vi.fn().mockResolvedValue('https://github.com/org/repo/pull/9')
    const record = vi.fn()
    await publishSquadTicket(
      { ...f, squad: 'build', result: 'Pronto' },
      {
        state: async () => ({ exists: true, dirty: 0, ignored: 2, ahead: 1, fingerprint: '' }),
        remoteIdentity: async () => ({ host: 'github.com', repository: 'org/repo' }),
        existingPR: async () => null,
        commit,
        openPR,
        record,
      },
    )
    expect(commit).not.toHaveBeenCalled()
    expect(openPR).toHaveBeenCalledOnce()
    expect(record).toHaveBeenCalledOnce()
  })

  it('publica dois tickets em branches independentes e registra dois PRs separados', async () => {
    const first = fixture()
    const second = fixture()
    second.ticket.id = 'ticket-2'
    second.ticket.key = 'AO-2'
    second.worktree.branch = 'agent/squad-build-ticket-2'
    const records: unknown[] = []
    let prNumber = 20
    const deps = {
      state: async () => ({ exists: true, dirty: 1, ignored: 0, ahead: 0, fingerprint: '' }),
      remoteIdentity: async () => ({ host: 'github.com', repository: 'org/repo' }),
      existingPR: async () => null,
      commit: async () => 'sha',
      openPR: async () => `https://github.com/org/repo/pull/${prNumber++}`,
      record: (pr: unknown) => records.push(pr),
    }
    await publishSquadTicket({ ...first, squad: 'build', result: 'Primeira entrega' }, deps)
    await publishSquadTicket({ ...second, squad: 'build', result: 'Segunda entrega' }, deps)
    expect(first.worktree.branch).not.toBe(second.worktree.branch)
    expect(records).toEqual([
      expect.objectContaining({ ticketId: 'ticket-1', url: 'https://github.com/org/repo/pull/20' }),
      expect.objectContaining({ ticketId: 'ticket-2', url: 'https://github.com/org/repo/pull/21' }),
    ])
  })

  it('não grava nem libera a fila se push/gh falhar antes da URL confirmada', async () => {
    const f = fixture()
    const record = vi.fn()
    await expect(
      publishSquadTicket(
        { ...f, squad: 'build', result: 'Pronto' },
        {
          state: async () => ({ exists: true, dirty: 0, ignored: 0, ahead: 1, fingerprint: '' }),
          remoteIdentity: async () => ({ host: 'github.com', repository: 'org/repo' }),
          existingPR: async () => null,
          commit: vi.fn(),
          openPR: async () => {
            throw new Error('gh falhou')
          },
          record,
        },
      ),
    ).rejects.toThrow('gh falhou')
    expect(record).not.toHaveBeenCalled()
  })

  it('mantém falha ao iniciar próximo ciclo fora do resultado publicado e não repete gravação/avanço', async () => {
    const record = vi.fn()
    const publicationFailed = vi.fn()
    const nextStartFailed = vi.fn()
    let active: string | null = 'ticket-1'
    const advanceQueue = vi.fn(() => { active = 'ticket-2' })
    let startupError: { ticketId: string; message: string } | undefined
    const publish = vi.fn(async () => {
      record({ ticketId: 'ticket-1', url: 'https://github.com/org/repo/pull/1' })
      advanceQueue()
    })
    const startNext = vi.fn(async () => { throw new Error('worktree indisponível') })

    const confirmed = await publishThenStartNext({
      publish,
      startNext,
      publicationFailed,
      nextStartFailed: (error) => {
        nextStartFailed(error)
        startupError = { ticketId: active!, message: error instanceof Error ? error.message : String(error) }
      },
    })

    expect(confirmed).toBe(true)
    expect(record).toHaveBeenCalledOnce()
    expect(advanceQueue).toHaveBeenCalledOnce()
    expect(active).toBe('ticket-2')
    expect(publicationFailed).not.toHaveBeenCalled()
    expect(nextStartFailed).toHaveBeenCalledOnce()
    expect(nextStartFailed).toHaveBeenCalledWith(expect.objectContaining({ message: 'worktree indisponível' }))
    expect(startupError).toEqual({ ticketId: 'ticket-2', message: 'worktree indisponível' })
    // A retry targets publication only; the post-release startup error cannot invoke it.
    expect(publish).toHaveBeenCalledOnce()
  })
})
