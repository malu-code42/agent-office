import { mediaAgendaLinks, type MediaAgendaLink } from '@shared/media'

/** Load read-only commitment links from the current agenda view. */
export async function readMediaAgendaLinks(): Promise<MediaAgendaLink[]> {
  const view = await window.office.readAgenda()
  return mediaAgendaLinks(view)
}

export function sameMediaAgendaLink(a: MediaAgendaLink | undefined, b: MediaAgendaLink | undefined): boolean {
  return !!a && !!b && a.day === b.day && a.time === b.time && a.title === b.title
}
