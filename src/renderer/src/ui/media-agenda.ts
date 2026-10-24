import type { MediaAgendaLink } from '@shared/media'

/** Load read-only commitment links from the current agenda view. */
export async function readMediaAgendaLinks(): Promise<MediaAgendaLink[]> {
  const view = await window.office.readAgenda()
  const links = new Map<string, MediaAgendaLink>()
  for (const day of [...view.week, view.today])
    for (const entry of day.entries) {
      const title = entry.kind === 'commitment' ? entry.title : entry.kind === 'task' ? entry.text : null
      if (!title || !('time' in entry)) continue
      const link = { day: day.date, time: entry.time, title }
      links.set(JSON.stringify(link), link)
    }
  return [...links.values()]
}

export function sameMediaAgendaLink(a: MediaAgendaLink | undefined, b: MediaAgendaLink | undefined): boolean {
  return !!a && !!b && a.day === b.day && a.time === b.time && a.title === b.title
}
