import type { ProjectFloor } from '@shared/types'
import { accountPool } from '@shared/accounts'
import { projectFor } from '@shared/projects'
import type { Tag } from '../world2d/overlays'
import { GameFloors } from './floors'

/** "$ 8,92" */
const money = (usd: number) => `$ ${usd.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Spending boards and limit alarms of every floor. */
export abstract class GameBoards extends GameFloors {
  // ---------- spending boards and limit alarms ----------

  /** Accounts at a plan limit, with when they come back (if known). */
  protected limitedAccounts(): Map<string, number | undefined> {
    const now = Date.now()
    const out = new Map<string, number | undefined>()
    for (const st of this.state.accounts) if (st.limitedUntil && st.limitedUntil > now) out.set(st.id, st.limitedUntil)
    for (const u of this.state.usage) {
      const full = u.windows.find((w) => w.percent >= 100 && (!w.resetsAt || w.resetsAt > now))
      if (full && !out.has(u.accountId)) out.set(u.accountId, full.resetsAt)
    }
    return out
  }

  /**
   * Each floor's board adds up what was spent today in its folder (the ground floor: every folder);
   * its alarm goes off while an account it runs on is at its limit (the ground floor: any).
   */
  protected syncBoards(): void {
    this.boardsIn = 5
    const limited = this.limitedAccounts()
    // only the Casa shows the day's spending on the floor; project floors keep just the limit alarm
    const floors: [(on: boolean) => void, Tag, Tag | null, ProjectFloor | null][] = [
      [(on) => (this.alarm = on), this.alarmTag, this.moneyTag, null],
      ...this.uppers.map((u): [(on: boolean) => void, Tag, null, ProjectFloor] => [(on) => (u.alarm = on), u.alarmTag, null, u.project]),
    ]
    // Today's spend from the cost book: dismissing an agent keeps it, midnight zeroes it.
    const today = this.state.ledgerToday
    const floorOfCwd = (cwd: string) => {
      const id = projectFor(this.state.settings.projects, cwd)?.id
      return id ? this.uppers.findIndex((u) => u.project.id === id) + 1 : 0
    }
    const costUnknownOnFloor = (n: number) =>
      Object.entries(today.costUnknownByCwd ?? {}).some(([cwd, unknown]) => unknown && (n === 0 || floorOfCwd(cwd) === n))
    const spenders = Object.values(today.agents)
    floors.forEach(([setAlarm, tag, moneyTag, project], n) => {
      if (moneyTag) {
        const total = Object.entries(today.costByCwd).reduce((sum, [cwd, usd]) => (n === 0 || floorOfCwd(cwd) === n ? sum + usd : sum), 0)
        const costUnknown = costUnknownOnFloor(n)
        const top = spenders
          .filter((a) => n === 0 || floorOfCwd(a.cwd) === n)
          .sort((a, b) => b.usd - a.usd)
          .slice(0, 8)
        moneyTag.setName(costUnknown ? (total > 0 ? `≥ ${money(total)} hoje` : 's/ preço hoje') : `${money(total)} hoje`)
        const spendersText = top
          .filter((a) => a.usd >= 0.005 || a.costUnknown)
          .map((a) => `${a.name}: ${a.costUnknown ? 'sem preço confiável' : money(a.usd)}`)
        if (costUnknown) spendersText.push('O provedor não informou preço confiável para parte do uso.')
        moneyTag.el.title = spendersText.join('\n') || 'Ninguém gastou nada hoje'
      }
      const pool = project ? accountPool(this.state.settings, project.cwd) : [...limited.keys()]
      const hit = pool.filter((id) => limited.has(id))
      setAlarm(hit.length > 0)
      if (!hit.length) return
      const names = hit.map((id) => this.state.account(id)?.name ?? id).join(', ')
      const back = hit
        .map((id) => limited.get(id))
        .filter((t): t is number => !!t)
        .sort((a, b) => a - b)[0]
      const clock = back ? ` · volta ${new Date(back).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : ''
      tag.setName(`${hit.length > 1 ? 'Contas' : 'Conta'} ${names} no limite${clock}`)
    })
  }
}
