import { ScopeRepository } from './scopeRepository'

describe('ScopeRepository', () => {
  const scopeRepository = new ScopeRepository()

  describe('getAllByIdentifiers', () => {
    it('returns scopes for valid scope names', async () => {
      const scopes = await scopeRepository.getAllByIdentifiers([
        'read',
        'write'
      ])

      expect(scopes).toHaveLength(2)
      expect(scopes[0]).toEqual({ name: 'read' })
      expect(scopes[1]).toEqual({ name: 'write' })
    })

    it('returns single scope', async () => {
      const scopes = await scopeRepository.getAllByIdentifiers(['read'])

      expect(scopes).toHaveLength(1)
      expect(scopes[0]).toEqual({ name: 'read' })
    })

    it('returns empty array for empty input', async () => {
      const scopes = await scopeRepository.getAllByIdentifiers([])

      expect(scopes).toHaveLength(0)
    })

    it('throws for invalid scope names', async () => {
      await expect(
        scopeRepository.getAllByIdentifiers(['invalid'])
      ).rejects.toThrow()
    })
  })

  describe('finalize', () => {
    it('returns scopes unchanged', async () => {
      const inputScopes = [{ name: 'read' }, { name: 'write' }]
      const finalizedScopes = await scopeRepository.finalize(inputScopes)

      expect(finalizedScopes).toEqual(inputScopes)
    })

    it('returns empty array unchanged', async () => {
      const finalizedScopes = await scopeRepository.finalize([])

      expect(finalizedScopes).toEqual([])
    })
  })
})
