import { describe, expect, it } from 'vitest'
import type { LogEntry } from '../src/shared/types'
import { commandsFor, filterCommands, parseSlash, PANEL_COMMANDS, SLASH_COMMANDS } from '../src/renderer/src/ui/luna-commands'
import { isDupOfResult } from '../src/shared/feed-dedupe'

const e = (kind: LogEntry['kind'], text: string, extra: Partial<LogEntry> = {}): LogEntry => ({
  id: text + kind,
  t: 0,
  kind,
  text,
  ...extra,
})

describe('resposta final sem duplicar', () => {
  it('esconde o balão do assistente igual ao resultado que vem logo depois', () => {
    expect(isDupOfResult(e('assistant', 'Pronto.'), e('result', ' Pronto.\n'))).toBe(true)
  })

  it('mantém mensagens intermediárias, textos diferentes e resultados com erro', () => {
    expect(isDupOfResult(e('assistant', 'Vou olhar.'), e('result', 'Pronto.'))).toBe(false)
    expect(isDupOfResult(e('assistant', 'Falhou'), e('result', 'Falhou', { isError: true }))).toBe(false)
    expect(isDupOfResult(e('user', 'Pronto.'), e('result', 'Pronto.'))).toBe(false)
    expect(isDupOfResult(e('assistant', 'Pronto.'), e('assistant', 'Pronto.'))).toBe(false)
    expect(isDupOfResult(undefined, e('result', 'Pronto.'))).toBe(false)
  })
})

describe('comandos por agente', () => {
  it('agentes comuns só têm /clear e /compact', () => {
    expect(commandsFor(undefined).map((c) => c.name)).toEqual(['clear', 'compact'])
    expect(commandsFor('emi').map((c) => c.name)).toEqual(['clear', 'compact'])
  })

  it('a Luna tem os dela mais /clear e /compact', () => {
    const names = commandsFor('luna').map((c) => c.name)
    expect(names).toEqual([...SLASH_COMMANDS.map((c) => c.name), 'clear', 'compact'])
  })

  it('filtra e lê só dentro da lista do agente', () => {
    expect(filterCommands('cl', PANEL_COMMANDS).map((c) => c.name)).toEqual(['clear'])
    expect(filterCommands('tarefa', PANEL_COMMANDS)).toEqual([])
    expect(parseSlash('/clear', PANEL_COMMANDS)?.cmd.kind).toBe('panel')
    expect(parseSlash('/tarefa x', PANEL_COMMANDS)).toBeNull()
    expect(parseSlash('/clear')).toBeNull()
  })
})
