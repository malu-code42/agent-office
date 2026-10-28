import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { findSquad, inspectSquads, loadSquads, validateSquad } from '../src/main/squads'
import { cleanStaleReservations, removeSquad, squadCodeFor, squadFilePlan, writeSquad } from '../src/main/squad-writer'
import { RESERVATION_MARKER, RESERVATION_STALE_MS, writeReservation } from '../src/main/squad-reservation'
import type { SquadProposalComposition } from '@shared/types'

// The squad folder is written all or nothing, and an existing definition is never
// overwritten.

let cwd: string

const composition = (): SquadProposalComposition => ({
  name: 'Squad da Sala 1',
  members: [
    { id: 'maya', name: 'Maya', role: 'implementer', engine: 'claude', model: 'opus', account: 'pessoal', focus: 'Escreve o código' },
    { id: 'caio', name: 'Caio', role: 'reviewer', engine: 'claude', model: '', account: '', focus: 'Revisa' },
  ],
})

const plan = (code = 'sala-1') => {
  const p = squadFilePlan(composition(), 'Squad da Sala 1', 'Refazer a busca da loja')
  p.code = code
  return p
}

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'ao-squad-writer-'))
})

describe('writeSquad', () => {
  it('cria a pasta do squad com a definição, os membros e o pipeline', () => {
    writeSquad(cwd, plan())
    const dir = join(cwd, 'squads', 'sala-1')
    expect(existsSync(join(dir, 'squad.yaml'))).toBe(true)
    expect(existsSync(join(dir, 'agents', 'maya.agent.md'))).toBe(true)
    expect(existsSync(join(dir, 'agents', 'caio.agent.md'))).toBe(true)
    expect(existsSync(join(dir, 'pipeline', 'pipeline.yaml'))).toBe(true)
    const yaml = readFileSync(join(dir, 'squad.yaml'), 'utf8')
    expect(yaml).toContain('code: sala-1')
    expect(yaml).toContain('name: Squad da Sala 1')
    expect(yaml).toContain('role: implementer')
    const pipeline = readFileSync(join(dir, 'pipeline', 'pipeline.yaml'), 'utf8')
    expect(pipeline).toContain('agent: maya')
    expect(pipeline).toContain('agent: caio')
  })

  it('a squad criada passa na validação do office', () => {
    writeSquad(cwd, plan())
    const squad = findSquad(cwd, 'sala-1')
    expect(squad).toBeDefined()
    expect(() => validateSquad(squad!)).not.toThrow()
    expect(squad!.members.map((m) => m.id)).toEqual(['maya', 'caio'])
    expect(squad!.members.find((m) => m.role === 'reviewer')?.id).toBe('caio')
  })

  it('orienta o revisor a avaliar de forma independente e somente reportar achados', () => {
    writeSquad(cwd, plan())
    const reviewer = readFileSync(join(cwd, 'squads', 'sala-1', 'agents', 'caio.agent.md'), 'utf8')
    expect(reviewer).toContain('revisor independente')
    expect(reviewer).toContain('Sua revisão é somente leitura')
    expect(reviewer).toContain('não edite, crie, remova ou grave arquivos')
    expect(reviewer).toContain('deixe qualquer correção para o implementador')
    expect(reviewer).toContain('reporte os achados')
  })

  it('materializa o snapshot local de especialidade nas instruções independentes do membro', () => {
    const specialized = composition()
    specialized.members[0]!.competencyProfileId = 'backend-engineer'
    specialized.members[0]!.competencyProfile = {
      id: 'backend-engineer',
      label: 'Engenharia de backend',
      identity: 'Especialista em serviços e dados de backend.',
      scope: 'Implementação de APIs e persistência para o escopo aprovado.',
      responsibilities: ['Definir contratos e validar entradas.'],
      boundaries: ['Não ampliar o objetivo aprovado.'],
      delivery: ['Entregar alteração e evidência de testes.'],
      qualityCriteria: ['Cobrir erros e regressões com testes.'],
    }
    const p = squadFilePlan(specialized, 'Squad da Sala 1', 'Refazer a busca da loja')
    p.code = 'sala-2'
    const path = writeSquad(cwd, p)
    const agent = readFileSync(join(path, 'agents', 'maya.agent.md'), 'utf8')

    expect(agent).toContain('Perfil local: Engenharia de backend')
    expect(agent).toContain('Especialista em serviços e dados de backend.')
    expect(agent).toContain('Não ampliar o objetivo aprovado.')
    expect(agent).toContain('Entregar alteração e evidência de testes.')
    expect(agent).toContain('Cobrir erros e regressões com testes.')
  })

  it('nunca sobrescreve uma definição que já existe', () => {
    writeSquad(cwd, plan())
    const before = readFileSync(join(cwd, 'squads', 'sala-1', 'squad.yaml'), 'utf8')
    expect(() => writeSquad(cwd, plan())).toThrow(/Já existe/)
    expect(readFileSync(join(cwd, 'squads', 'sala-1', 'squad.yaml'), 'utf8')).toBe(before)
  })

  it('não deixa pasta pela metade quando algo falha', () => {
    // A member id with a slash would escape the folder: the write is refused.
    const bad = plan('sala-2')
    bad.members[0]!.id = '../fora'
    expect(() => writeSquad(cwd, bad)).toThrow(/inválido/)
    const left = existsSync(join(cwd, 'squads')) ? readdirSync(join(cwd, 'squads')) : []
    expect(left.filter((n) => n.startsWith('.creating-'))).toEqual([])
    expect(existsSync(join(cwd, 'squads', 'sala-2'))).toBe(false)
  })

  it('a pasta temporária não parece um squad para o office', () => {
    writeSquad(cwd, plan())
    // Nothing named .creating-* stays behind, and the code names are plain.
    const names = readdirSync(join(cwd, 'squads'))
    expect(names).toEqual(['sala-1'])
  })

  it('o squad pronto não fica com o marcador da reserva', () => {
    writeSquad(cwd, plan())
    expect(existsSync(join(cwd, 'squads', 'sala-1', RESERVATION_MARKER))).toBe(false)
  })

  it('retries the exact crash window after target mkdir and before the reservation marker', () => {
    const p = plan()
    p.proposalId = 'proposal-durable-1'
    const root = join(cwd, 'squads')
    mkdirSync(root, { recursive: true })
    const target = join(root, p.code)
    const sibling = join(root, `.reservation-${p.code}`)
    // Fault-injected on-disk state: atomic sibling is durable; target mkdir succeeded;
    // the process died before writing target/.reserva.
    writeFileSync(sibling, JSON.stringify({ proposalId: p.proposalId, attempt: '01234567-89ab-4cde-8fab-0123456789ab' }))
    mkdirSync(target)

    writeSquad(cwd, p)

    expect(findSquad(cwd, 'sala-1')).toBeDefined()
    expect(existsSync(join(root, 'sala-1-2'))).toBe(false)
    expect(existsSync(sibling)).toBe(false)
    expect(existsSync(join(target, RESERVATION_MARKER))).toBe(false)
  })

  it('preserves a non-empty target even when a matching sibling reservation exists', () => {
    const p = plan()
    p.proposalId = 'proposal-durable-2'
    const root = join(cwd, 'squads')
    const target = join(root, p.code)
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'notes.txt'), 'owned by someone else')
    writeFileSync(
      join(root, `.reservation-${p.code}`),
      JSON.stringify({
        proposalId: p.proposalId,
        attempt: '01234567-89ab-4cde-8fab-0123456789ab',
      }),
    )

    expect(() => writeSquad(cwd, p)).toThrow(/contém dados/)
    expect(readFileSync(join(target, 'notes.txt'), 'utf8')).toBe('owned by someone else')
    expect(existsSync(join(root, `.reservation-${p.code}`))).toBe(true)
  })
})

describe('a corrida pela pasta do squad', () => {
  it('nunca sobrescreve uma pasta que já existe, nem uma vazia', () => {
    // A pasta vazia de outro programa é o caso perigoso: no POSIX um rename por
    // cima dela a substitui em silêncio.
    const dir = join(cwd, 'squads', 'sala-1')
    mkdirSync(dir, { recursive: true })
    expect(() => writeSquad(cwd, plan())).toThrow(/Já existe/)
    // A pasta continua vazia: nada foi publicado dentro dela.
    expect(readdirSync(dir)).toEqual([])
    expect(loadSquads(cwd)).toEqual([])
  })

  it('a pasta reservada não vira squad antes de o squad estar pronto', () => {
    let seen: string[] = []
    writeSquad(cwd, plan(), {
      beforePublish: () => {
        seen = loadSquads(cwd).map((s) => s.code)
      },
    })
    // Durante a escrita o office não vê squad nenhum.
    expect(seen).toEqual([])
    expect(loadSquads(cwd).map((s) => s.code)).toEqual(['sala-1'])
  })

  it('a pasta que está sendo escrita não aparece como squad indisponível', () => {
    // Uma pasta reservada não é um squad quebrado: o office a esconde, em vez de
    // mostrá-la como indisponível e oferecer uma recuperação que não existe.
    let seen: ReturnType<typeof inspectSquads> = []
    writeSquad(cwd, plan(), {
      afterReserve: () => {
        seen = inspectSquads(cwd)
      },
    })
    expect(seen).toEqual([])
  })

  it('quem chega depois não entra e não apaga o squad que está nascendo', () => {
    let rival = ''
    writeSquad(cwd, plan(), {
      beforePublish: () => {
        // Outro escritor chega no meio da escrita e tenta a mesma pasta.
        try {
          writeSquad(cwd, plan())
        } catch (err) {
          rival = err instanceof Error ? err.message : String(err)
        }
      },
    })
    expect(rival).toMatch(/Já existe/)
    // O squad que estava nascendo continua inteiro e passa na validação.
    const squad = findSquad(cwd, 'sala-1')
    expect(squad).toBeDefined()
    expect(squad!.members.map((m) => m.id)).toEqual(['maya', 'caio'])
    expect(() => validateSquad(squad!)).not.toThrow()
  })

  it('a pasta é reservada: outro escritor não consegue tomá-la', () => {
    // A corrida da pasta vazia: no POSIX, um rename por cima de uma pasta vazia a
    // substitui. Com a reserva, o rival nunca chega a ter essa pasta.
    let rival = ''
    writeSquad(cwd, plan(), {
      beforePublish: (target) => {
        try {
          mkdirSync(target)
        } catch (err) {
          rival = (err as NodeJS.ErrnoException).code ?? ''
        }
      },
    })
    expect(rival).toBe('EEXIST')
    expect(loadSquads(cwd).map((s) => s.code)).toEqual(['sala-1'])
  })

  it('a falha publica nada e apaga só o que esta tentativa criou', () => {
    expect(() =>
      writeSquad(cwd, plan(), {
        beforePublish: () => {
          throw new Error('falhou no meio da escrita')
        },
      }),
    ).toThrow(/falhou no meio/)
    // Nada foi publicado e a pasta temporária não sobrou.
    expect(existsSync(join(cwd, 'squads', 'sala-1'))).toBe(false)
    const left = existsSync(join(cwd, 'squads')) ? readdirSync(join(cwd, 'squads')) : []
    expect(left.filter((n) => n.startsWith('.creating-'))).toEqual([])
    expect(loadSquads(cwd)).toEqual([])
  })

  it('a falha logo depois de reservar devolve a pasta', () => {
    // A reserva é limpa em qualquer ponto: nem a pasta nem o marcador sobram.
    expect(() =>
      writeSquad(cwd, plan(), {
        afterReserve: () => {
          throw new Error('falhou antes de escrever')
        },
      }),
    ).toThrow(/falhou antes/)
    expect(existsSync(join(cwd, 'squads', 'sala-1'))).toBe(false)
    expect(inspectSquads(cwd)).toEqual([])
  })

  it('a falha de um não apaga a pasta que já estava lá', () => {
    const dir = join(cwd, 'squads', 'sala-1')
    mkdirSync(dir, { recursive: true })
    expect(() => writeSquad(cwd, plan())).toThrow(/Já existe/)
    // A pasta de outro continua lá, vazia como estava.
    expect(existsSync(dir)).toBe(true)
    expect(readdirSync(dir)).toEqual([])
  })

  it('nunca sobrescreve um arquivo que apareceu no meio da escrita', () => {
    // Um arquivo de outro programa aparece na pasta reservada enquanto a escrita
    // acontece. No POSIX um rename por cima dele o substituiria em silêncio.
    const dir = join(cwd, 'squads', 'sala-1')
    expect(() =>
      writeSquad(cwd, plan(), {
        beforePublish: (target) => {
          writeFileSync(join(target, 'squad.yaml'), 'de outro programa: não é meu')
        },
      }),
    ).toThrow(/Já existe um arquivo/)
    // O arquivo de outro continua como estava.
    expect(readFileSync(join(dir, 'squad.yaml'), 'utf8')).toBe('de outro programa: não é meu')
    // E o que esta tentativa tinha publicado foi retirado.
    expect(existsSync(join(dir, 'agents', 'maya.agent.md'))).toBe(false)
    expect(existsSync(join(dir, 'pipeline', 'pipeline.yaml'))).toBe(false)
    // A pasta de outro continua lá: nada que não é dele foi apagado.
    expect(existsSync(dir)).toBe(true)
    expect(readdirSync(dir)).toContain('squad.yaml')
  })
})

describe('a reserva de uma criação interrompida', () => {
  const reserve = (code: string, ageMs: number) => {
    const dir = join(cwd, 'squads', code)
    mkdirSync(dir, { recursive: true })
    writeReservation(dir, 'tentativa-antiga', Date.now() - ageMs)
    return dir
  }

  it('uma criação em andamento não aparece no office', () => {
    reserve('sala-1', 1_000)
    expect(inspectSquads(cwd)).toEqual([])
    expect(loadSquads(cwd)).toEqual([])
  })

  it('uma criação interrompida é mostrada como indisponível, para o jogador limpar', () => {
    reserve('sala-1', RESERVATION_STALE_MS + 60_000)
    const shown = inspectSquads(cwd)
    expect(shown).toHaveLength(1)
    expect(shown[0]?.availability).toBe('unavailable')
    expect(shown[0]?.unavailableReason).toMatch(/interrompida/)
  })

  it('o office limpa a pasta abandonada que só tem o marcador', () => {
    const dir = reserve('sala-1', RESERVATION_STALE_MS + 60_000)
    expect(cleanStaleReservations(cwd)).toEqual(['sala-1'])
    expect(existsSync(dir)).toBe(false)
  })

  it('o office não limpa uma pasta com alguma coisa dentro', () => {
    const dir = reserve('sala-1', RESERVATION_STALE_MS + 60_000)
    writeFileSync(join(dir, 'nota.txt'), 'isto é do jogador')
    expect(cleanStaleReservations(cwd)).toEqual([])
    expect(existsSync(join(dir, 'nota.txt'))).toBe(true)
  })

  it('um squad pronto com o marcador perdido é recuperado', () => {
    // A publicação terminou e só a limpeza do marcador se perdeu: o squad é inteiro.
    writeSquad(cwd, plan())
    writeReservation(join(cwd, 'squads', 'sala-1'), 'tentativa-antiga', Date.now() - 60_000)
    const shown = inspectSquads(cwd)
    expect(shown).toHaveLength(1)
    expect(shown[0]?.availability).toBe('available')
    expect(existsSync(join(cwd, 'squads', 'sala-1', RESERVATION_MARKER))).toBe(false)
  })
})

describe('removeSquad', () => {
  it('tira a pasta que o office acabou de criar', () => {
    writeSquad(cwd, plan())
    removeSquad(cwd, 'sala-1')
    expect(existsSync(join(cwd, 'squads', 'sala-1'))).toBe(false)
  })

  it('ignora um código que não é um nome de squad', () => {
    expect(() => removeSquad(cwd, '../etc')).not.toThrow()
  })

  it('não apaga uma pasta que outra tentativa reservou', () => {
    const dir = join(cwd, 'squads', 'sala-1')
    mkdirSync(dir, { recursive: true })
    writeReservation(dir, 'outra-tentativa')
    removeSquad(cwd, 'sala-1')
    expect(existsSync(dir)).toBe(true)
  })
})

describe('squadCodeFor', () => {
  it('nomeia a pasta pela sala e desempata quando ela já existe', () => {
    const taken = new Set(['sala-1'])
    expect(squadCodeFor(0, (c) => taken.has(c))).toBe('sala-1-2')
    expect(squadCodeFor(2, (c) => taken.has(c))).toBe('sala-3')
  })
})

describe('squadFilePlan', () => {
  it('um passo por membro, com os checkpoints no começo e no fim', () => {
    const p = squadFilePlan(composition(), 'Squad da Sala 1', 'Refazer a busca')
    expect(p.steps.map((s) => s.type)).toEqual(['checkpoint', 'agent', 'agent', 'checkpoint'])
    expect(p.steps[1]!.agent).toBe('maya')
    expect(p.steps[2]!.agent).toBe('caio')
  })

  it('a descrição guarda o brief', () => {
    const p = squadFilePlan(composition(), 'Squad da Sala 1', 'Refazer a busca da loja')
    expect(p.description).toContain('Refazer a busca da loja')
  })
})

describe('a squad escrita por outra pessoa', () => {
  it('uma definição quebrada no lugar não é tocada', () => {
    mkdirSync(join(cwd, 'squads', 'sala-1'), { recursive: true })
    writeFileSync(join(cwd, 'squads', 'sala-1', 'squad.yaml'), 'isso não é yaml: [')
    expect(() => writeSquad(cwd, plan())).toThrow(/Já existe/)
    expect(readFileSync(join(cwd, 'squads', 'sala-1', 'squad.yaml'), 'utf8')).toBe('isso não é yaml: [')
  })
})
