import { GameFloors } from './floors'

/** "$ 8,92" */
const money = (usd: number) => `$ ${usd.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** The Casa's spending board. Plan limits are not shown in the world: the limits card and the agent panel tell. */
export abstract class GameBoards extends GameFloors {
  /** The Casa's board adds up what was spent today in every folder. */
  protected syncBoards(): void {
    this.boardsIn = 5
    // Today's spend from the cost book: dismissing an agent keeps it, midnight zeroes it.
    const today = this.state.ledgerToday
    const costUnknown = Object.values(today.costUnknownByCwd ?? {}).some(Boolean)
    const total = Object.values(today.costByCwd).reduce((sum, usd) => sum + usd, 0)
    const top = Object.values(today.agents)
      .sort((a, b) => b.usd - a.usd)
      .slice(0, 8)
    this.moneyTag.setName(costUnknown ? (total > 0 ? `≥ ${money(total)} hoje` : 's/ preço hoje') : `${money(total)} hoje`)
    const spendersText = top
      .filter((a) => a.usd >= 0.005 || a.costUnknown)
      .map((a) => `${a.name}: ${a.costUnknown ? 'sem preço confiável' : money(a.usd)}`)
    if (costUnknown) spendersText.push('O provedor não informou preço confiável para parte do uso.')
    this.moneyTag.el.title = spendersText.join('\n') || 'Ninguém gastou nada hoje'
  }
}
