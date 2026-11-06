import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { officeAgentPrompt } from '../src/main/agent-prompt'
import { BONNIE_PROMPT } from '../src/main/bonnie-prompt'
import { COMMIT_RULE, COMMIT_RULE_PT } from '../src/main/commit-rule'
import { emiPrompt } from '../src/main/emi-prompt'
import { IRIS_INSTRUCTIONS } from '../src/main/iris-claude'
import { LUNA_PROMPT } from '../src/main/luna-prompt'
import { squadFilePlan, writeSquad } from '../src/main/squad-writer'
import { loadSquads, memberAgents, orchestratorPrompt } from '../src/main/squads'
import type { SquadProposalComposition } from '@shared/types'

// AO-99: toda a regra de commit, PR e merge vem de commit-rule.ts; nenhum prompt a contradiz.

const wt = { root: '/w/ao', branch: 'agent/ao-1', repo: '/repo' }

/** Instruções que contradiziam a regra antes do AO-99: devem sumir de todos os prompts. */
const CONFLITOS: Array<[string, RegExp]> = [
  ['mandar esperar pedido para commitar', /(wait|waiting|until) (to be |you are |you're )?(asked|told)[^.]{0,40}commit|commit only (when|if) (asked|told)|only commit when|do not commit unless/i],
  ['commit só se pedirem (pt)', /(só|somente) (faça|fazer) commits? (se|quando) (pedi|solicit)|não (faça|fazer) commits?\b/i],
  ['permitir merge sem pedido', /\b(you may|you can|feel free to|go ahead and) merge\b|\bmerg(e|es|ing) follow the office permission cards?|pode fazer merge|faça merge dos? PRs?/i],
  ['PR aberto pelo escritório em vez do agente', /the pull request is opened from the office/i],
  ['push direto na main', /(may|can|should) push (straight |directly )?(to|on) main/i],
  ['commit direto na main', /(may|can|should) commit (straight |directly )?(to|on) main/i],
  ['push/PR em repo de terceiros', /(always|also) (push|open a (pull request|PR)) (even )?(for|on) (anyone else|third)/i],
]

function semConflito(texto: string) {
  for (const [nome, re] of CONFLITOS) expect(texto.match(re), `instrução conflitante: ${nome}`).toBeNull()
}

const composicao = (): SquadProposalComposition => ({
  name: 'Squad AO-99',
  members: [
    { id: 'maya', name: 'Maya', role: 'implementer', engine: 'claude', model: '', account: '', focus: 'Escreve o código' },
    { id: 'caio', name: 'Caio', role: 'reviewer', engine: 'claude', model: '', account: '', focus: 'Revisa' },
    { id: 'tina', name: 'Tina', role: 'tester', engine: 'claude', model: '', account: '', focus: 'Testa' },
    { id: 'ana', name: 'Ana', role: 'analyst', engine: 'claude', model: '', account: '', focus: 'Analisa' },
  ],
})

function squad() {
  const cwd = mkdtempSync(join(tmpdir(), 'ao99-squad-'))
  const plan = squadFilePlan(composicao(), 'Squad AO-99', 'Alinhar regras')
  plan.code = 'ao-99'
  writeSquad(cwd, plan)
  return loadSquads(cwd).find((s) => s.code === 'ao-99')!
}

describe('regra única de commit, PR e merge (AO-99)', () => {
  it('a fonte traz a regra completa nos dois idiomas', () => {
    for (const trecho of ['commit', 'branch', 'main', 'origin', 'push', 'pull request', 'link', 'Never merge', 'permission cards']) {
      expect(COMMIT_RULE.toLowerCase()).toContain(trecho.toLowerCase())
    }
    for (const trecho of ['commit', 'branch próprio', 'main', 'origin', 'push', 'pull request', 'terceiros', 'Nunca faça merge', 'cartões de permissão']) {
      expect(COMMIT_RULE_PT.toLowerCase()).toContain(trecho.toLowerCase())
    }
  })

  it('Luna', () => {
    expect(LUNA_PROMPT).toContain(COMMIT_RULE)
    semConflito(LUNA_PROMPT)
  })

  it('Emi', () => {
    const prompt = emiPrompt({ name: 'Andar', cwd: '/p' })
    expect(prompt).toContain(COMMIT_RULE)
    semConflito(prompt)
    // Merge só pelo pedido da usuária, que a regra já diz: nenhum "never merge" absoluto sobrando.
    expect(prompt).not.toMatch(/Never merge\.(?! unless)/)
    expect(prompt).not.toMatch(/no push to main, no merge/)
  })

  it('Bonnie e as disciplinas que ela prepara', () => {
    expect(BONNIE_PROMPT).toContain(COMMIT_RULE)
    semConflito(BONNIE_PROMPT)
  })

  it('Iris', () => {
    expect(IRIS_INSTRUCTIONS).toContain(COMMIT_RULE)
    semConflito(IRIS_INSTRUCTIONS)
  })

  it('agente avulso ou contratado, sem worktree', () => {
    const prompt = officeAgentPrompt('Rex')
    expect(prompt).toContain(COMMIT_RULE)
    semConflito(prompt)
  })

  it('agente avulso ou contratado, em worktree', () => {
    const prompt = officeAgentPrompt('Rex', wt)
    expect(prompt).toContain(COMMIT_RULE)
    expect(prompt).toContain(wt.branch)
    semConflito(prompt)
  })

  it('orquestrador do squad e ciclo de ticket (worktree)', () => {
    const s = squad()
    expect(orchestratorPrompt(s)).toContain(COMMIT_RULE)
    for (const prompt of [officeAgentPrompt('Orq', undefined, s), officeAgentPrompt('Orq', wt, s)]) {
      expect(prompt).toContain(COMMIT_RULE)
      // Uma vez só: o orquestrador não repete a regra.
      expect(prompt.split(COMMIT_RULE)).toHaveLength(2)
      semConflito(prompt)
    }
  })

  it.each([
    ['implementador', 'maya'],
    ['revisor', 'caio'],
    ['testador', 'tina'],
    ['analista', 'ana'],
  ])('membro do squad: %s', (_papel, id) => {
    const prompt = memberAgents(squad())[id]!.prompt
    expect(prompt).toContain(COMMIT_RULE_PT)
    semConflito(prompt)
  })

  it('os padrões de conflito pegam o que existia antes', () => {
    expect(() => semConflito('Commit on your branch when you finish; the pull request is opened from the office.')).toThrow()
    expect(() => semConflito('Commits, pushes and merges follow the office permission cards.')).toThrow()
    expect(() => semConflito('Sua revisão é somente leitura e não faça commits.')).toThrow()
  })
})
