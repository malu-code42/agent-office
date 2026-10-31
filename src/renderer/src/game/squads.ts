import type { AgentSummary, SquadInfo, SquadMember } from '@shared/types'
import { helperActivity, lookFromSeed } from '@shared/describe'
import { Avatar } from '../world2d/avatar'
import * as L from '../world2d/plan'
import { Tag } from '../world2d/overlays'
import { GameSubagents } from './subagents'
import { memberPlace, deliverySpot, floorReservations, spotKey, type Spot } from './member-slots'
import { clip, MEMBER_EXIT_S, MEMBER_MIN_S, SQUAD_SPEED, type Member } from './types'

/** Squad members: up the elevator, a desk in the squad room, the delivery at the coordinator, out. */
export abstract class GameSquads extends GameSubagents {
  // ---------- squad members ----------

  protected squadOf(a: AgentSummary): SquadInfo | undefined {
    return this.state.squads.find((q) => q.code === a.squad && q.cwd === a.cwd) ?? this.state.squads.find((q) => q.code === a.squad)
  }

  protected syncMembers(): void {
    const live = new Set<string>()
    // Members of a squad with no room in this floor, with no place to stand: they stay
    // in the state, and the notice of the floor names them.
    const unplaced = new Map<string, string[]>()
    for (const a of this.state.agents.values()) {
      if (a.role !== 'orchestrator' || !this.upperOf(this.homeFloor(a))) continue
      const parent = this.actors.get(a.id)
      if (!parent || parent.down || parent.goal === 'leave') continue
      const squad = this.squadOf(a)
      const find = (id: string): SquadMember =>
        squad?.members.find((m) => m.id === id) ?? { id, name: id, icon: '•', title: '', execution: 'subagent', sector: L.DEFAULT_SECTOR }
      for (const sub of a.subagents ?? []) {
        if (!sub.member) continue
        live.add(sub.id)
        const already = this.members.get(sub.id)
        if (already) {
          already.sub = sub
          this.memberBubble(already)
          continue
        }
        const info = find(sub.member)
        const spot = this.memberSpot(a)
        if (!spot.desk && !spot.tile) {
          // No place in the scene: the member keeps its place in the state, and the
          // notice says who it is, so nobody thinks the data went missing.
          const code = a.squad ?? sub.member
          const names = unplaced.get(code) ?? []
          if (!names.includes(info.name)) names.push(info.name)
          unplaced.set(code, names)
          continue
        }
        const m = this.addMember(a, info, sub.id, false, spot)
        m.sub = sub
        this.memberBubble(m)
      }
      // Inline members have no subagent: the current step in state.json says who is on.
      const step = a.squadStep
      const busy = a.status === 'working' || a.status === 'starting' || a.status === 'waiting'
      const inline = step?.agent && step.status === 'running' && busy ? find(step.agent) : null
      if (inline && inline.execution === 'inline') {
        const id = `inline:${a.id}:${inline.id}`
        live.add(id)
        if (!this.members.has(id)) this.addMember(a, inline, id, true)
      }
    }
    for (const m of this.members.values()) {
      if (live.has(m.id) || m.endAt !== null) continue
      // Inline members just go; subagents show their delivery after a minimum stay.
      m.endAt = m.inline || !this.actors.has(m.parentId) ? this.time : Math.max(this.time, m.bornAt + MEMBER_MIN_S)
    }
    this.unplacedMembers = unplaced
    this.refreshIssues()
    this.syncStepTags()
  }

  protected addMember(
    a: AgentSummary,
    info: SquadMember,
    id: string,
    inline: boolean,
    spot?: { desk: L.DeskSlot | null; tile: Spot | null },
  ): Member {
    // The same person every cycle: the look comes from the squad and the member id.
    const avatar = new Avatar(lookFromSeed(L.memberKey(a.squad ?? '', info.id)), `member:${id}`)
    avatar.floor = this.homeFloor(a)
    this.dress(avatar, a)
    avatar.speed = SQUAD_SPEED
    const spawn = this.elevatorOf(avatar.floor).point
    avatar.placeAt(spawn.x, spawn.z)
    avatar.face(0)
    const tag = this.overlays.add(new Tag(avatar.anchor, `${info.icon} ${info.name}`, false, () => this.memberClick(id)))
    tag.setDot('starting')
    const m: Member = {
      id,
      parentId: a.id,
      info,
      avatar,
      tag,
      inline,
      desk: null,
      tile: null,
      phase: 'arriving',
      bornAt: this.time,
      endAt: null,
      failed: null,
      sub: null,
      infoUntil: 0,
    }
    this.members.set(id, m)
    this.ding(avatar.floor)
    const arrive = () => {
      if (m.phase !== 'arriving') return
      m.phase = 'working'
      m.tag.setDot('working')
      this.memberPose(m)
      if (m.desk) this.floorOf(avatar.floor).deskScreens[m.desk.index]?.setMode('working')
    }
    if (inline) {
      const desk = this.coordinatorDesk(a)
      if (desk) this.route(avatar, desk.sideApproach, desk.side, arrive)
      else arrive()
      return m
    }
    const place = spot ?? this.memberSpot(a)
    m.desk = place.desk
    m.tile = place.tile
    if (place.desk) this.route(avatar, place.desk.approach, place.desk.seat, arrive)
    else if (place.tile) this.route(avatar, place.tile, null, arrive)
    else arrive()
    return m
  }

  /**
   * Where a member works: a free desk of its squad room, or a free tile to stand on.
   * A squad with no room on this floor waits in the aisle of the agents' room, each
   * one on a tile of its own: nobody stands on top of anybody else. When there is no
   * free tile, there is no place: the member is not drawn.
   */
  protected memberSpot(a: AgentSummary): { desk: L.DeskSlot | null; tile: Spot | null } {
    const floor = this.homeFloor(a)
    const plan = this.upperOf(floor)!.scene.plan
    // The squad has one room: the one with its code. Without a room the members wait
    // in the aisle, where the individual agents also stand when every desk is taken.
    const room = plan.rooms.find((r) => r.squad === a.squad)
    // Only the members of this floor hold a place here: every project floor numbers
    // its desks the same way, so the other floors must not compete for them.
    const { desks: taken, tiles } = floorReservations(
      [...this.members.values()].map((o) => ({
        floor: o.avatar.floor,
        desk: o.desk,
        tile: o.tile,
        leaving: o.phase === 'leaving',
      })),
      floor,
    )
    for (const other of this.state.agents.values()) {
      if (other.role === 'orchestrator' || this.homeFloor(other) !== floor) continue
      if (other.desk < plan.agentDesks.length) continue
      // The individual agents without a desk of their own stand in the same aisle.
      const t = plan.agentStand[(other.desk - plan.agentDesks.length) % plan.agentStand.length]
      if (t) tiles.add(spotKey(t[0], t[1]))
    }
    const grid = this.floorOf(floor).grid
    return memberPlace(room ? room.desks : [], room ? room.stand : plan.agentStand, taken, tiles, (x, z) => grid.walkable(x, z))
  }

  protected memberPose(m: Member): void {
    const av = m.avatar
    if (av.isWalking || m.phase !== 'working') return
    if (m.inline) {
      const parent = this.actors.get(m.parentId)
      const a = this.state.agents.get(m.parentId)
      const desk = a && this.coordinatorDesk(a)
      if (parent?.avatar.floor === av.floor) av.faceTowards(parent.avatar.position.x, parent.avatar.position.z)
      else if (desk) av.faceTowards(desk.seat.x, desk.seat.z)
      av.pose = 'sit'
    } else if (m.desk) {
      av.face(m.desk.face ?? Math.PI)
      av.pose = 'type'
    } else {
      av.face(Math.PI)
      av.pose = 'stand'
    }
  }

  protected memberBubble(m: Member): void {
    if (m.failed) return m.tag.setBubble(`✗ ${clip(m.failed, 70)}`, 'error')
    if (this.time < m.infoUntil && m.sub) {
      const tokens = m.sub.tokens ? `${Math.round(m.sub.tokens / 1000)}k tokens` : ''
      return m.tag.setBubble([clip(m.sub.description, 50), tokens, m.sub.lastTool ?? ''].filter(Boolean).join(' · '), 'talk')
    }
    if (m.phase === 'delivering') return m.tag.setBubble('✓ Entregando', 'done')
    if (m.phase === 'leaving') return m.tag.setBubble(null)
    m.tag.setBubble(
      m.inline ? 'Neste passo com o coordenador' : m.sub ? clip(m.sub.activity ? helperActivity(m.sub) : m.sub.description, 40) : null,
      'work',
    )
  }

  /** Click: what the member is doing (task, tokens, last tool) for a few seconds, and the orchestrator's panel. */
  protected memberClick(id: string): void {
    const m = this.members.get(id)
    if (!m) return
    m.infoUntil = this.time + 6
    this.memberBubble(m)
    this.hooks.onAgentClick(m.parentId, m.sub?.id)
  }

  /** The orchestrator reported a member failing: the bubble says why, then it leaves without delivering. */
  memberEnded(taskId: string, status: 'completed' | 'failed' | 'stopped', summary?: string): void {
    const m = this.members.get(taskId)
    if (!m || status === 'completed') return
    m.failed = status === 'failed' ? summary || 'Falhou.' : 'Interrompido.'
    m.tag.setDot('error')
    this.memberBubble(m)
    m.endAt = Math.min(m.endAt ?? Infinity, this.time + 4)
  }

  protected updateMembers(dt: number): void {
    for (const m of this.members.values()) {
      m.avatar.update(dt)
      if (m.infoUntil && this.time >= m.infoUntil) {
        m.infoUntil = 0
        this.memberBubble(m)
      }
      if (m.endAt === null || this.time < m.endAt) continue
      if (m.phase === 'arriving' || m.phase === 'working') this.memberDeliver(m)
      // safety net: nobody stays stuck on the floor
      else if (this.time > m.endAt + MEMBER_EXIT_S) this.memberGone(m)
    }
  }

  protected memberDeliver(m: Member): void {
    if (m.desk) this.floorOf(m.avatar.floor).deskScreens[m.desk.index]?.setMode(m.failed ? 'error' : 'done')
    m.avatar.pose = 'stand'
    const a = this.state.agents.get(m.parentId)
    const desk = a && this.coordinatorDesk(a)
    if (m.failed || m.inline || !desk) return this.memberLeave(m)
    // A free tile in front of the coordinator: the room has one per member, so a
    // full room delivers all at once, and nobody stands on top of anybody else.
    const taken = new Set(
      [...this.members.values()].filter((o) => o !== m && o.phase === 'delivering' && o.tile).map((o) => spotKey(o.tile![0], o.tile![1])),
    )
    const grid = this.floorOf(m.avatar.floor).grid
    const tile = deliverySpot(desk.deliver, taken, (x, z) => grid.walkable(x, z))
    // Every tile is taken: the member leaves instead of standing on another one.
    if (!tile) return this.memberLeave(m)
    m.phase = 'delivering'
    m.tag.setDot('done')
    m.avatar.setProp('paper')
    this.memberBubble(m)
    m.tile = tile
    this.route(m.avatar, tile, null, () => {
      m.avatar.faceTowards(desk.seat.x, desk.seat.z)
      m.avatar.pose = 'talk'
      setTimeout(() => {
        m.avatar.setProp('none')
        this.memberLeave(m)
      }, 1600)
    })
  }

  protected memberLeave(m: Member): void {
    if (m.phase === 'leaving') return
    m.phase = 'leaving'
    if (m.desk) {
      const screen = this.floorOf(m.avatar.floor).deskScreens[m.desk.index]
      setTimeout(() => screen?.setMode('off'), 2500)
    }
    m.desk = null
    m.tile = null
    if (!m.failed) this.memberBubble(m)
    const door = this.elevatorOf(m.avatar.floor)
    this.route(m.avatar, door.tile, door.point, () => {
      this.ding(m.avatar.floor)
      setTimeout(() => this.memberGone(m), 500)
    })
  }

  protected memberGone(m: Member): void {
    if (!this.members.has(m.id)) return
    this.members.delete(m.id)
    this.overlays.remove(m.tag)
  }

  /** "Passo 3/6 · Texto" over the desk of each coordinator, from squads/<code>/state.json. */
  protected syncStepTags(): void {
    this.uppers.forEach((u, i) => {
      const byRoom = this.orchestratorsOn(i + 1)
      u.stepTags.forEach((tag, room) => {
        const st = byRoom.get(room)?.squadStep
        const text =
          st?.status === 'completed'
            ? '✓ Ciclo concluído'
            : st?.current
              ? `${st.type === 'checkpoint' ? '⏸' : '▸'} Passo ${st.current}/${st.total} · ${clip(st.label, 32)}`
              : 'Aguardando o próximo ciclo'
        tag.setName(text)
        tag.setDot(
          st?.type === 'checkpoint' && st.status !== 'completed'
            ? 'waiting'
            : st?.current && st.status !== 'completed'
              ? 'working'
              : 'idle',
        )
      })
    })
  }
}
