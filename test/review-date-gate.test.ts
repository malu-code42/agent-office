import { describe, expect, it } from 'vitest'
import { reviewMayShow, todayKey } from '../src/shared/review'

describe('reviewMayShow: a oferta/reabertura da revisão só aparece quando deve', () => {
  const today = '2026-10-17'

  it('mostra a oferta quando está devida, mesmo sem rascunho', () => {
    expect(reviewMayShow(true, false, null, today)).toBe(true)
    expect(reviewMayShow(true, false, '2026-10-17', today)).toBe(true)
  })

  it('a data de retorno futura prevalece sobre a oferta devida (#102)', () => {
    expect(reviewMayShow(true, true, '2026-10-18', today)).toBe(false) // rascunho adiado
    expect(reviewMayShow(true, false, '2026-10-20', today)).toBe(false) // concorda com o IPC, que recusaria abrir
    expect(reviewMayShow(true, true, '2026-10-17', today)).toBe(true) // data de retorno é hoje
    expect(reviewMayShow(true, true, '2026-10-16', today)).toBe(true) // data já passou
  })

  it('não mostra quando não há oferta nem rascunho', () => {
    expect(reviewMayShow(false, false, null, today)).toBe(false)
    expect(reviewMayShow(false, false, '2026-10-20', today)).toBe(false)
  })

  it('mostra o rascunho apenas quando a data de retorno já chegou', () => {
    expect(reviewMayShow(false, true, null, today)).toBe(true) // nunca adiado
    expect(reviewMayShow(false, true, '2026-10-17', today)).toBe(true) // já chegou
    expect(reviewMayShow(false, true, '2026-10-18', today)).toBe(false) // ainda não chegou
  })

  it('usa a data local para comparar a data de retorno', () => {
    expect(reviewMayShow(false, true, '2026-10-16', '2026-10-17')).toBe(true) // já passou
    expect(reviewMayShow(false, true, '2026-10-17', '2026-10-17')).toBe(true) // chegou hoje
  })
})

describe('todayKey: data local AAAA-MM-DD', () => {
  it('monta a data no fuso local, sem deslocar por fuso horário', () => {
    // 2026-10-17 00:30 local -> 2026-10-17 (não 2026-10-16 como um parse UTC poderia sugerir)
    expect(todayKey(new Date(2026, 9, 17, 0, 30))).toBe('2026-10-17')
    // fim de dia local -> ainda o mesmo dia
    expect(todayKey(new Date(2026, 9, 17, 23, 59))).toBe('2026-10-17')
    // mudança de mês
    expect(todayKey(new Date(2026, 9, 31))).toBe('2026-10-31')
    expect(todayKey(new Date(2026, 10, 1))).toBe('2026-11-01')
  })
})
