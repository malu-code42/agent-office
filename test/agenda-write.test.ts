import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAgendaWriter, planMoveCommitment } from '../src/main/agenda-write'

/**
 * agenda.md (AO-10): a commitment moves to another time or day heading, and only its line changes. The
 * lines that are not commitments (a task reference, a note, a blank) stay byte for byte. One copy of the
 * file per session, and a write refused when the file has changed since it was read.
 */

const AGENDA = [
  '# Agenda',
  '',
  '## 2026-10-16',
  '- 09:00 Reunião de pauta',
  '- 10:30 ↦ ^tabc123',
  'Uma nota solta',
  '',
  '## 2026-10-17',
  '- 14:00 Dentista',
  '',
].join('\n')

const REUNIAO = { day: '2026-10-16', time: '09:00', title: 'Reunião de pauta' }
const DAY = new Date(2026, 9, 17, 10, 30)

let vault: string

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), 'ao-agenda-'))
})

afterEach(() => {
  rmSync(vault, { recursive: true, force: true })
})

describe('planMoveCommitment', () => {
  it('changes only the time of a commitment on the same day', () => {
    const out = planMoveCommitment(AGENDA, { from: REUNIAO, to: { day: REUNIAO.day, time: '11:15' } })
    expect(out.split('\n')).toEqual(AGENDA.split('\n').map((l) => (l === '- 09:00 Reunião de pauta' ? '- 11:15 Reunião de pauta' : l)))
  })

  it('moves it to another day heading, after the last filled line of that day, and leaves the rest where it was', () => {
    const out = planMoveCommitment(AGENDA, { from: REUNIAO, to: { day: '2026-10-17', time: '11:00' } })
    expect(out.split('\n')).toEqual([
      '# Agenda',
      '',
      '## 2026-10-16',
      '- 10:30 ↦ ^tabc123',
      'Uma nota solta',
      '',
      '## 2026-10-17',
      '- 14:00 Dentista',
      '- 11:00 Reunião de pauta',
      '',
    ])
  })

  it('keeps CRLF line endings and the spacing of the line; only the time changes', () => {
    const crlf = '## 2026-10-16\r\n- 09:00  Reunião de pauta\r\nFim\r\n'
    expect(planMoveCommitment(crlf, { from: REUNIAO, to: { day: REUNIAO.day, time: '11:15' } })).toBe(
      '## 2026-10-16\r\n- 11:15  Reunião de pauta\r\nFim\r\n',
    )
  })

  it('refuses a commitment that is not there, one that is there twice, a day with no heading, and the same date and time', () => {
    expect(() => planMoveCommitment(AGENDA, { from: { ...REUNIAO, title: 'Outra' }, to: { day: REUNIAO.day, time: '11:15' } })).toThrow(
      'Não encontrei o compromisso “Outra”',
    )
    const twice = AGENDA.replace('- 10:30 ↦ ^tabc123', '- 09:00 Reunião de pauta')
    expect(() => planMoveCommitment(twice, { from: REUNIAO, to: { day: '2026-10-17', time: '11:00' } })).toThrow(
      'Há mais de um compromisso',
    )
    expect(() => planMoveCommitment(AGENDA, { from: REUNIAO, to: { day: '2026-12-01', time: '11:00' } })).toThrow(
      'Não encontrei o dia 01.12.2026',
    )
    expect(() => planMoveCommitment(AGENDA, { from: REUNIAO, to: { day: REUNIAO.day, time: '09:00' } })).toThrow(
      'já está nessa data e hora',
    )
  })

  it('a task reference is not a commitment: it can never be the line moved', () => {
    expect(() =>
      planMoveCommitment(AGENDA, {
        from: { day: '2026-10-16', time: '10:30', title: '↦ ^tabc123' },
        to: { day: '2026-10-16', time: '11:00' },
      }),
    ).toThrow('Não encontrei o compromisso')
  })
})

describe('createAgendaWriter', () => {
  const writeAgenda = (text: string) => writeFileSync(join(vault, 'agenda.md'), text)
  const readAgenda = () => readFileSync(join(vault, 'agenda.md'), 'utf8')
  const backups = () => {
    try {
      return readdirSync(join(vault, 'backups', 'agenda'))
    } catch {
      return []
    }
  }

  it('refuses to write a file that was never read, and one that is missing', () => {
    writeAgenda(AGENDA)
    const w = createAgendaWriter({ now: () => DAY })
    expect(() => w.current(vault)).toThrow('Abra a proposta de novo antes de confirmar')

    rmSync(join(vault, 'agenda.md'))
    expect(() => w.read(vault)).not.toThrow()
    expect(() => w.current(vault)).toThrow('Não encontrei o agenda.md')
  })

  it('refuses a file that changed on disk since it was read, and writes nothing', () => {
    writeAgenda(AGENDA)
    const w = createAgendaWriter({ now: () => DAY })
    w.read(vault)
    writeAgenda(AGENDA + '- 18:00 Outro compromisso\n')

    expect(() => w.current(vault)).toThrow('O agenda.md mudou desde que você abriu a proposta')
    expect(readAgenda()).toBe(AGENDA + '- 18:00 Outro compromisso\n')
  })

  it('refuses a write when the file changed between the check and the write', () => {
    writeAgenda(AGENDA)
    const w = createAgendaWriter({ now: () => DAY })
    w.read(vault)
    const before = w.current(vault)
    writeAgenda(AGENDA + 'nota de última hora\n')

    expect(() => w.write(vault, before, planMoveCommitment(before, { from: REUNIAO, to: { day: REUNIAO.day, time: '11:15' } }))).toThrow(
      'O agenda.md mudou',
    )
    expect(readAgenda()).toBe(AGENDA + 'nota de última hora\n')
  })

  it('takes one copy of the file per session, from before the first write, and writes the new text', () => {
    writeAgenda(AGENDA)
    const w = createAgendaWriter({ now: () => DAY })
    w.read(vault)

    let before = w.current(vault)
    w.write(vault, before, planMoveCommitment(before, { from: REUNIAO, to: { day: REUNIAO.day, time: '11:15' } }))
    before = w.current(vault)
    w.write(vault, before, planMoveCommitment(before, { from: { ...REUNIAO, time: '11:15' }, to: { day: REUNIAO.day, time: '12:00' } }))

    expect(backups()).toHaveLength(1)
    expect(readFileSync(join(vault, 'backups', 'agenda', backups()[0]!), 'utf8')).toBe(AGENDA)
    expect(readAgenda()).toContain('- 12:00 Reunião de pauta')
  })
})
