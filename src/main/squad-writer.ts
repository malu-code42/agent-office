import {
  constants,
  copyFileSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  readdirSync,
  rmSync,
  rmdirSync,
  unlinkSync,
  writeSync,
  fsyncSync,
} from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { stringify } from 'yaml'
import { z } from 'zod'
import { SQUAD_ROLE_LABELS, type SquadProposalComposition, type SquadProposalMember, type SquadRole } from '@shared/types'
import { roomCode } from '@shared/squad-rooms'
import { writeFileAtomic } from './fs-safe'
import {
  RESERVATION_MARKER,
  clearReservation,
  isAbandonedReservation,
  reservationOf,
  reservationState,
  writeReservation,
} from './squad-reservation'

// The files of a squad (Opensquad format): squads/<code>/squad.yaml, the .agent.md of
// every member and pipeline/pipeline.yaml. They are written once, in a folder that is
// reserved before anything is written and filled at the end: a squad exists whole or
// does not exist at all, and an existing definition is never overwritten.

/** Codes, folders and member ids: letters, digits, _ and -. Nothing climbs out of a path. */
const SAFE_NAME = /^[\w-]{1,64}$/
/** The file that makes a folder a squad: until it is there, the office sees nothing. */
const MARKER = 'squad.yaml'
/** The icon of each role, on the plate of the member. */
const ROLE_ICONS: Record<SquadRole, string> = {
  implementer: '🛠️',
  reviewer: '🔍',
  analyst: '📊',
  tester: '🧪',
  writer: '✍️',
  researcher: '🔎',
}
/** The sector of the members: the room they work in. */
const SECTOR = 'Equipe'

export interface SquadFilePlan {
  /** Folder of the squad: squads/<code>. */
  code: string
  /** Transaction identity for startup recovery; persisted as a private ownership marker. */
  proposalId?: string
  name: string
  description: string
  members: SquadProposalMember[]
  /** One step per member, in the order of the desks, plus the two checkpoints. */
  steps: { id: string; name: string; type: 'agent' | 'checkpoint'; agent?: string }[]
}

/** The plan of the files of a squad, from the composition the player approved. */
export function squadFilePlan(composition: SquadProposalComposition, name: string, brief: string): SquadFilePlan {
  const members = composition.members
  const steps: SquadFilePlan['steps'] = [
    { id: 'criterios', name: 'Critérios de aceite', type: 'checkpoint' },
    ...members.map((m, i) => ({
      id: `passo-${i + 1}`,
      name: SQUAD_ROLE_LABELS[m.role],
      type: 'agent' as const,
      agent: m.id,
    })),
    { id: 'aprovacao', name: 'Sua aprovação', type: 'checkpoint' },
  ]
  return {
    code: '',
    name,
    description: `Equipe criada para: ${brief.replace(/\s+/g, ' ').trim().slice(0, 200)}`,
    members,
    steps,
  }
}

/** A code for the folder of the squad: the room names it, so it never changes. */
export function squadCodeFor(room: number, taken: (code: string) => boolean): string {
  const base = roomCode(room)
  if (!taken(base)) return base
  for (let n = 2; n < 100; n++) {
    const code = `${base}-${n}`
    if (!taken(code)) return code
  }
  throw new Error('Não achei um código livre para a pasta do squad.')
}

/** The content of squad.yaml. */
export function squadYaml(plan: SquadFilePlan): string {
  const squad = {
    code: plan.code,
    name: plan.name,
    icon: '🧩',
    description: plan.description,
    agents: plan.members.map((m) => ({
      id: m.id,
      name: m.name,
      icon: ROLE_ICONS[m.role],
      file: `agents/${m.id}.agent.md`,
      ...(m.role === 'implementer' || m.role === 'reviewer' ? { role: m.role } : {}),
      setor: SECTOR,
    })),
    pipeline: { entry: 'pipeline/pipeline.yaml' },
  }
  return stringify(squad, { lineWidth: 0 })
}

/** The persona of a member: the body of its .agent.md, under the frontmatter. */
export function agentMarkdown(plan: SquadFilePlan, member: SquadProposalMember): string {
  const head = [
    '---',
    `name: ${JSON.stringify(member.name)}`,
    `icon: ${JSON.stringify(ROLE_ICONS[member.role])}`,
    `title: ${JSON.stringify(SQUAD_ROLE_LABELS[member.role])}`,
    'execution: subagent',
    ...(member.role === 'implementer' || member.role === 'reviewer' ? [`role: ${member.role}`] : []),
    `setor: ${SECTOR}`,
    '---',
    '',
  ].join('\n')
  const body = [
    `Você é ${member.name}, ${SQUAD_ROLE_LABELS[member.role].toLowerCase()} do squad ${plan.name}.`,
    member.focus ? `Sua parte aqui: ${member.focus}` : '',
    ...(member.competencyProfile
      ? [
          `Perfil local: ${member.competencyProfile.label}`,
          member.competencyProfile.identity,
          `Escopo: ${member.competencyProfile.scope}`,
          'Responsabilidades:',
          ...member.competencyProfile.responsibilities.map((item) => `- ${item}`),
          'Limites:',
          ...member.competencyProfile.boundaries.map((item) => `- ${item}`),
          'Formato da entrega:',
          ...member.competencyProfile.delivery.map((item) => `- ${item}`),
          'Critérios de qualidade:',
          ...member.competencyProfile.qualityCriteria.map((item) => `- ${item}`),
        ]
      : []),
    ...(member.role === 'reviewer'
      ? [
          'Você faz uma revisão independente do código concluído pelo implementador.',
          'Sua revisão é somente leitura: não edite, crie, remova ou grave arquivos, não execute correções e não faça commits.',
          'Apenas reporte os achados com evidência, severidade e localização; deixe qualquer correção para o implementador.',
        ]
      : []),
    '',
    'Você trabalha só no seu passo do pipeline e entrega o resultado no formato que ele pede.',
    'Não chame outros subagentes: o orquestrador é quem distribui o trabalho.',
    'Fale com quem coordena em português do Brasil.',
  ]
    .filter((line) => line !== undefined)
    .join('\n')
  return `${head}${body}\n`
}

/** The content of pipeline/pipeline.yaml. */
export function pipelineYaml(plan: SquadFilePlan): string {
  return stringify(
    {
      steps: plan.steps.map((s) => ({ id: s.id, name: s.name, type: s.type, ...(s.agent ? { agent: s.agent } : {}) })),
    },
    { lineWidth: 0 },
  )
}

/** The files of a squad, as name -> content. */
export function squadFiles(plan: SquadFilePlan): Record<string, string> {
  const files: Record<string, string> = {
    'squad.yaml': squadYaml(plan),
    'pipeline/pipeline.yaml': pipelineYaml(plan),
  }
  for (const m of plan.members) files[`agents/${m.id}.agent.md`] = agentMarkdown(plan, m)
  if (plan.proposalId) files['.agent-office-proposal'] = `${plan.proposalId}\n`
  return files
}

/** Hooks of a write; the tests use them to watch the write from the outside. */
export interface WriteSquadHooks {
  /**
   * Runs right after the folder was reserved and before anything was written, with
   * the folder that was reserved. The squad is not published yet: the office still
   * sees nothing.
   */
  afterReserve?: (target: string) => void
  /** Fault-injection seam immediately after mkdir and before the in-folder marker. */
  afterTargetMkdirBeforeMarker?: (target: string) => void
  /**
   * Runs after the files are written and before they are published, with the folder
   * that was reserved. The squad is not published yet: the office still sees nothing.
   */
  beforePublish?: (target: string) => void
}

/**
 * Writes the squad in squads/<code>/, all or nothing.
 *
 * The folder of the squad is reserved in one step (an exclusive mkdir): an existing
 * definition, or an empty folder left by somebody else, is never overwritten. The
 * folder is marked as "being created" while the files are written, so the office
 * never shows a half-made squad. The files are written in a hidden folder and moved
 * in at the end, the marker last. If anything fails, the rollback takes away only
 * what this attempt put there.
 */
export function writeSquad(cwd: string, plan: SquadFilePlan, hooks: WriteSquadHooks = {}): string {
  if (!SAFE_NAME.test(plan.code)) throw new Error(`Código de squad inválido: ${plan.code}`)
  for (const m of plan.members) if (!SAFE_NAME.test(m.id)) throw new Error(`Identificador de membro inválido: ${m.id}`)
  const root = join(cwd, 'squads')
  const target = join(root, plan.code)
  mkdirSync(root, { recursive: true })
  const attempt = randomUUID()
  const sibling = join(root, `.reservation-${plan.code}`)
  recoverOrReserveSibling(sibling, target, plan.proposalId, attempt)
  // The durable sibling proves ownership even if the process dies in this mkdir/marker gap.
  // Everything from here on is inside the try: a failure at any point (even before
  // the temporary folder exists) has to give the reservation back.
  const published: string[] = []
  let tmp = ''
  let targetOwned = false
  try {
    reserveFolder(target)
    targetOwned = true
    // The folder says it is being written: the office does not show it as a squad.
    hooks.afterTargetMkdirBeforeMarker?.(target)
    writeReservation(target, attempt)
    hooks.afterReserve?.(target)
    // The name has a dot: no squad code accepts one, so the office never lists it.
    tmp = join(root, `.creating-${plan.code}-${attempt.slice(0, 8)}`)
    mkdirSync(tmp, { recursive: true })
    const files = squadFiles(plan)
    for (const [name, content] of Object.entries(files)) {
      const file = join(tmp, ...name.split('/'))
      mkdirSync(join(file, '..'), { recursive: true })
      writeFileAtomic(file, content)
    }
    hooks.beforePublish?.(target)
    publish(tmp, target, files, published)
    // The squad is whole: the folder stops being a creation in progress.
    clearReservation(target, attempt)
    rmSync(tmp, { recursive: true, force: true })
    removeSiblingReservation(sibling, plan.proposalId, attempt)
    return target
  } catch (err) {
    // The rollback touches only what this attempt created: the hidden folder and the
    // files it published. A folder that was already there is never ours to remove.
    if (tmp) rmSync(tmp, { recursive: true, force: true })
    if (targetOwned) rollback(target, published, attempt)
    removeSiblingReservation(sibling, plan.proposalId, attempt)
    throw err
  }
}

const SiblingReservation = z.object({ proposalId: z.string().min(1), attempt: z.string().uuid() }).strict()

/** Durable ownership is established before target mkdir; only matching proposals may recover it. */
function recoverOrReserveSibling(sibling: string, target: string, proposalId: string | undefined, attempt: string): void {
  if (existsSync(sibling)) {
    let prior: z.infer<typeof SiblingReservation>
    try {
      prior = SiblingReservation.parse(JSON.parse(readFileSync(sibling, 'utf8')))
    } catch (err) {
      throw new Error('A reserva irmã existe, mas não pode ser verificada; dados preservados.', { cause: err })
    }
    if (!proposalId || prior.proposalId !== proposalId) throw new Error('A pasta está reservada por outra transação; dados preservados.')
    if (existsSync(target)) {
      let entries: string[]
      try {
        entries = readdirSync(target)
      } catch {
        throw new Error('A reserva do squad não pôde ser inspecionada; dados preservados.')
      }
      if (entries.length !== 0) throw new Error('A pasta reservada contém dados; recuperação interrompida sem alterações.')
      rmdirSync(target)
    }
    unlinkSync(sibling)
  }
  if (!proposalId) return
  const fd = openSync(sibling, 'wx')
  try {
    writeSync(fd, JSON.stringify({ proposalId, attempt }))
    fsyncSync(fd)
  } catch (err) {
    closeSync(fd)
    rmSync(sibling, { force: true })
    throw err
  }
  closeSync(fd)
}

function removeSiblingReservation(sibling: string, proposalId: string | undefined, attempt: string): void {
  if (!proposalId) return
  try {
    const current = SiblingReservation.parse(JSON.parse(readFileSync(sibling, 'utf8')))
    if (current.proposalId === proposalId && current.attempt === attempt) unlinkSync(sibling)
  } catch {
    /* leave an unverifiable reservation for safe manual recovery */
  }
}

/**
 * Reserves the folder of a squad: it is created in one step and only when it does not
 * exist yet. On POSIX a rename over an empty folder would replace it, so the folder is
 * taken with mkdir (which fails when the name is taken) instead of being renamed
 * into: an existing definition, or an empty folder left by somebody else, is never
 * overwritten.
 */
function reserveFolder(target: string): void {
  try {
    mkdirSync(target)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`Já existe um squad em ${target}. Nada foi sobrescrito.`, { cause: err })
    }
    throw err
  }
}

/**
 * Moves the files into the reserved folder. The marker (squad.yaml) goes last: until
 * it is there, the office does not see the squad at all, never half of it.
 *
 * A file is never replaced: on POSIX a rename over an existing file replaces it in
 * silence, so the move is made with a link (or an exclusive copy), which fails when
 * the destination is already there.
 */
function publish(tmp: string, target: string, files: Record<string, string>, published: string[]): void {
  const names = Object.keys(files)
  const order = [...names.filter((n) => n !== MARKER), ...names.filter((n) => n === MARKER)]
  for (const name of order) {
    const to = join(target, ...name.split('/'))
    mkdirSync(join(to, '..'), { recursive: true })
    moveNoClobber(join(tmp, ...name.split('/')), to)
    published.push(name)
  }
}

/** Moves a file without ever replacing another one. */
function moveNoClobber(from: string, to: string): void {
  try {
    linkSync(from, to)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'EEXIST') throw new Error(`Já existe um arquivo em ${to}. Nada foi sobrescrito.`, { cause: err })
    // Some file systems do not do hard links: the exclusive copy does the same.
    if (code !== 'EPERM' && code !== 'ENOSYS' && code !== 'EXDEV') throw err
    try {
      copyFileSync(from, to, constants.COPYFILE_EXCL)
    } catch (copyErr) {
      if ((copyErr as NodeJS.ErrnoException).code === 'EEXIST')
        throw new Error(`Já existe um arquivo em ${to}. Nada foi sobrescrito.`, { cause: copyErr })
      throw copyErr
    }
  }
  rmSync(from, { force: true })
}

/**
 * Undoes a failed write. Only the files this attempt published go away, and the
 * folder itself is removed only when nothing else is inside it: a file of somebody
 * else is never deleted, and a folder reserved by another attempt is left alone.
 */
function rollback(target: string, published: string[], attempt: string): void {
  for (const name of [...published].reverse()) rmSync(join(target, ...name.split('/')), { force: true })
  const owner = reservationOf(target)
  if (owner && owner.attempt && owner.attempt !== attempt) return
  clearReservation(target, attempt)
  // The empty folders this attempt made go away too: the reservation does not leave
  // a half-made squad behind.
  if (pruneEmptyDirs(target)) rmSync(target, { recursive: true, force: true })
}

/** Removes the empty folders inside a directory; true when the directory is empty. */
function pruneEmptyDirs(dir: string): boolean {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return true
  }
  for (const name of entries) {
    const child = join(dir, name)
    try {
      if (!lstatSync(child).isDirectory()) continue
    } catch {
      continue
    }
    if (pruneEmptyDirs(child)) rmSync(child, { recursive: true, force: true })
  }
  try {
    return readdirSync(dir).length === 0
  } catch {
    return true
  }
}

/**
 * Removes a squad the office has just created (the rollback of a failed approval).
 * A folder that another attempt reserved is not ours to delete.
 */
export function removeSquad(cwd: string, code: string): void {
  if (!SAFE_NAME.test(code)) return
  const dir = join(cwd, 'squads', code)
  if (!existsSync(dir)) return
  if (reservationOf(dir)) return
  rmSync(dir, { recursive: true, force: true })
}

/** True when the folder of a squad is being written right now. */
export function isBeingCreated(dir: string): boolean {
  return existsSync(join(dir, RESERVATION_MARKER))
}

/**
 * Cleans up the creations that were interrupted (the app was closed in the middle).
 * Only a folder that holds nothing but the marker of the office is removed: any
 * other file is the player's and stays there. The codes of the folders cleaned are
 * returned.
 */
export function cleanStaleReservations(cwd: string, now = Date.now()): string[] {
  const root = join(cwd, 'squads')
  let dirs: string[]
  try {
    dirs = readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && SAFE_NAME.test(d.name))
      .map((d) => d.name)
  } catch {
    return []
  }
  const cleaned: string[] = []
  for (const code of dirs) {
    const dir = join(root, code)
    if (reservationState(dir, now) !== 'stale') continue
    if (!isAbandonedReservation(dir)) continue
    const reservation = reservationOf(dir)
    rmSync(dir, { recursive: true, force: true })
    // A process crash can leave the private staging directory beside its reservation.
    // Its name is tied to the reservation token; remove only that exact attempt's
    // directory, never other hidden folders or a later writer's staging area.
    if (reservation?.attempt) {
      const staging = join(root, `.creating-${code}-${reservation.attempt.slice(0, 8)}`)
      try {
        if (lstatSync(staging).isDirectory()) rmSync(staging, { recursive: true, force: true })
      } catch {
        // No staging directory, or it cannot be inspected: leave it alone.
      }
    }
    cleaned.push(code)
  }
  return cleaned
}
