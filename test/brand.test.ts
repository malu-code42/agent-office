import { describe, expect, it } from 'vitest'
import { directorSign } from '../src/shared/projects'

describe('a placa da diretoria', () => {
  it('diz o projeto do andar', () => {
    expect(directorSign('Loja Aurora')).toBe('Diretoria · Loja Aurora')
    expect(directorSign('Apetit Studios')).toBe('Diretoria · Apetit Studios')
  })

  it('um andar sem nome lê "Projeto novo"', () => {
    expect(directorSign('')).toBe('Diretoria · Projeto novo')
    expect(directorSign('   ')).toBe('Diretoria · Projeto novo')
  })

  it('não repete o nome do projeto em volta', () => {
    const plate = directorSign('Loja Aurora')
    expect(plate.startsWith('Diretoria · ')).toBe(true)
    expect(plate.match(/Loja Aurora/g)).toHaveLength(1)
  })
})
