/** $0,42 (pt-BR); '' for nothing spent. */
export function formatCost(usd: number): string {
  if (!usd) return ''
  return usd < 0.01 ? '<$0,01' : `$${usd.toFixed(2).replace('.', ',')}`
}

/** 45s, 3min 4s; '' without a duration. */
export function formatDuration(ms: number): string {
  if (!ms) return ''
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}min ${s % 60}s`
}
