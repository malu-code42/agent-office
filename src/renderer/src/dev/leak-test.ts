import type { AgentSummary, ProjectFloor } from '@shared/types'
import { lookFromSeed } from '@shared/describe'
import type { Game } from '../game'
import type { State } from '../state'

/**
 * Dev only (AO-28): adds and removes a floor 20 times, hires and dismisses 30 agents,
 * uses the skull 10 times and dresses the player 30 times, reading what the 2D renderer
 * keeps (canvases and their pixels, painted character sheets, HTML tags) and the JS heap
 * after each round. Agents
 * are fake summaries pushed through the same agent:upsert / agent:removed events the
 * main process sends, so nothing reaches Claude or the store.
 *
 * Run it from the console (`await __leakTest()`) or headless:
 *   AGENT_OFFICE_DATA_DIR=$(mktemp -d) AGENT_OFFICE_SHOTS=out/leak:150000 \
 *   AGENT_OFFICE_EVAL='__leakTest().then(r => JSON.stringify(r))' npx electron .
 */

interface Snapshot {
  step: string
  /** Canvases the renderer keeps (screen, frame, cache, plates, painted characters). */
  canvases: number
  /** Their pixels, in KB. */
  canvasKB: number
  /** Painted character sheets (one per variant and Look on screen, at most 96). */
  skins: number
  /** HTML tags following the world. */
  tags: number
  heapMB: number | null
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const FLOOR_ID = 'leak-test-floor'
/** Uniform colors for the dressing round. */
const SHIRTS = ['#2f8f83', '#6c5ce7', '#e17055', '#0984e3', '#fdcb6e']

function heapMB(): number | null {
  const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
  return mem ? Math.round((mem.usedJSHeapSize / 1048576) * 10) / 10 : null
}

function fakeAgent(i: number, project?: string): AgentSummary {
  const id = `leak-${i}`
  return {
    id,
    name: `Teste ${i}`,
    source: 'terminal',
    cwd: `/tmp/leak/${i}`,
    permissionMode: 'default',
    status: 'working',
    activity: 'Testando vazamento',
    desk: i % 10,
    look: lookFromSeed(id),
    costUsd: 0,
    createdAt: Date.now(),
    project,
    // two helpers on every third agent, so subagents come and go too
    subagents:
      i % 3 ? [] : [0, 1].map((k) => ({ id: `${id}-sub-${k}`, description: 'Contar linhas', startedAt: Date.now(), background: true })),
  }
}

export async function leakTest(game: Game, state: State): Promise<{ snapshots: Snapshot[]; summary: Record<string, unknown> }> {
  const snapshots: Snapshot[] = []
  const snap = async (step: string) => {
    // a few frames so whatever is on screen gets uploaded (or released) first
    await sleep(400)
    const m = game.flat2d.memory
    const s: Snapshot = {
      step,
      canvases: m.canvases,
      canvasKB: Math.round(m.bytes / 1024),
      skins: m.skins,
      tags: game.overlays.count,
      heapMB: heapMB(),
    }
    snapshots.push(s)
    console.log(`[leak] ${step}: canvases ${s.canvases} (${s.canvasKB} KB), skins ${s.skins}, tags ${s.tags}, heap ${s.heapMB} MB`)
    return s
  }
  const original = state.settings
  const setFloors = (projects: ProjectFloor[]) => state.apply({ type: 'settings', settings: { ...state.settings, projects } })
  // With AGENT_OFFICE_DEMO=1 the demo's own agents stay: wait until only they are left.
  const base = game.population.actors
  const empty = async (timeoutMs = 40000) => {
    const end = Date.now() + timeoutMs
    while (Date.now() < end) {
      if (game.population.actors <= base) {
        // the test agents' helpers wave goodbye for a moment after their parent leaves
        await sleep(2000)
        return true
      }
      await sleep(250)
    }
    return false
  }

  game.goFloor(0)
  const start = await snap('início')

  // ---------- 1. a floor added and removed 20 times ----------
  for (let i = 0; i < 20; i++) {
    setFloors([...original.projects, { id: FLOOR_ID, name: `Teste ${i}`, cwd: '/tmp/leak-floor', brandColor: '#2f8f83', uniform: true }])
    game.goFloor(original.projects.length + 1)
    await sleep(300)
    game.goFloor(0)
    setFloors(original.projects)
    await snap(`andar ${i + 1}/20`)
  }
  const afterFloors = snapshots.at(-1)!

  // ---------- 2. 30 agents hired and dismissed, half of them on a uniformed floor ----------
  const floorWith = (i: number) => [
    ...original.projects,
    { id: FLOOR_ID, name: 'Uniforme', cwd: '/tmp/leak-floor', brandColor: SHIRTS[i % SHIRTS.length], uniform: true },
  ]
  let id = 0
  for (let round = 0; round < 3; round++) {
    setFloors(floorWith(round))
    const upstairs = original.projects.length + 1
    for (const [floor, project] of [
      [0, undefined],
      [upstairs, FLOOR_ID],
    ] as const) {
      game.goFloor(floor)
      const batch = Array.from({ length: 5 }, () => fakeAgent(id++, project))
      for (const a of batch) state.apply({ type: 'agent:upsert', agent: a })
      await sleep(2500)
      for (const a of batch) state.apply({ type: 'agent:removed', agentId: a.id })
      await empty()
    }
    game.goFloor(0)
    setFloors(original.projects)
    await snap(`agentes ${id}/30`)
  }
  const afterAgents = snapshots.at(-1)!

  // ---------- 3. the skull, 10 times ----------
  for (let i = 0; i < 10; i++) {
    const a = fakeAgent(1000 + i)
    a.subagents = []
    state.apply({ type: 'agent:upsert', agent: a })
    await sleep(1500)
    await new Promise<void>((done) => {
      game.dismiss(a.id, () => {
        state.apply({ type: 'agent:removed', agentId: a.id })
        done()
      })
    })
    await empty()
    // the puff and the ghost fade in under two seconds
    await sleep(2000)
    game.goFloor(0)
    await snap(`caveira ${i + 1}/10`)
  }
  const afterSkull = snapshots.at(-1)!

  // ---------- 4. the player dressed 30 times: uniform, own clothes, new look ----------
  // Each look paints a character sheet; the cache keeps at most 96 of them.
  const ownLook = game.player.look
  for (let i = 0; i < 30; i++) {
    game.player.setUniform(i % 2 ? null : { color: SHIRTS[i % SHIRTS.length] })
    game.player.setLook(lookFromSeed(`leak-look-${i}`))
    // one frame at least, so each look is painted before the next replaces it
    await sleep(120)
    if ((i + 1) % 10 === 0) await snap(`roupa ${i + 1}/30`)
  }
  game.player.setUniform(null)
  game.player.setLook(ownLook)
  const end = await snap('roupa original')

  const delta = (a: Snapshot, b: Snapshot) => ({
    canvases: b.canvases - a.canvases,
    canvasKB: b.canvasKB - a.canvasKB,
    tags: b.tags - a.tags,
    heapMB: a.heapMB === null || b.heapMB === null ? null : Math.round((b.heapMB - a.heapMB) * 10) / 10,
  })
  const at = (s: Snapshot) => ({ canvases: s.canvases, canvasKB: s.canvasKB, skins: s.skins, tags: s.tags, heapMB: s.heapMB })
  return {
    snapshots,
    summary: {
      início: at(start),
      andares: delta(start, afterFloors),
      agentes: delta(afterFloors, afterAgents),
      caveira: delta(afterAgents, afterSkull),
      roupa: delta(afterSkull, end),
      fim: at(end),
    },
  }
}
