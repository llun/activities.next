import { GrantIdentifier } from '@jmondi/oauth2-server'

import { getTestSQLDatabase } from '../../database/testUtils'
import { Scope } from '../../database/types/oauth'
import { seedDatabase } from '../../stub/database'
import { ClientRepository } from './clientRepository'

describe('ClientRepository', () => {
  const database = getTestSQLDatabase()
  let clientRepository: ClientRepository

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    clientRepository = new ClientRepository(database)

    // Create test OAuth clients
    await database.createClient({
      name: 'Client Repo Test',
      secret: 'test-secret',
      scopes: [Scope.enum.read, Scope.enum.write],
      redirectUris: ['https://example.com/callback']
    })
  })

  afterAll(async () => {
    await database.destroy()
  })

  describe('getByIdentifier', () => {
    it('returns client by id', async () => {
      const createdClient = await database.getClientFromName({
        name: 'Client Repo Test'
      })
      const client = await clientRepository.getByIdentifier(createdClient!.id)

      expect(client.id).toBe(createdClient!.id)
      expect(client.name).toBe('Client Repo Test')
    })

    it('throws error when client not found', async () => {
      await expect(
        clientRepository.getByIdentifier('nonexistent-client-id')
      ).rejects.toThrow('Application is not exists')
    })
  })

  describe('isClientValid', () => {
    it('returns true for valid client with correct secret', async () => {
      const createdClient = await database.getClientFromName({
        name: 'Client Repo Test'
      })

      const isValid = await clientRepository.isClientValid(
        'authorization_code' as GrantIdentifier,
        createdClient!,
        'test-secret'
      )

      expect(isValid).toBe(true)
    })

    it('returns false for wrong secret', async () => {
      const createdClient = await database.getClientFromName({
        name: 'Client Repo Test'
      })

      const isValid = await clientRepository.isClientValid(
        'authorization_code' as GrantIdentifier,
        createdClient!,
        'wrong-secret'
      )

      expect(isValid).toBe(false)
    })

    it('returns false for missing secret', async () => {
      const createdClient = await database.getClientFromName({
        name: 'Client Repo Test'
      })

      const isValid = await clientRepository.isClientValid(
        'authorization_code' as GrantIdentifier,
        createdClient!,
        undefined
      )

      expect(isValid).toBe(false)
    })

    it('returns false for disallowed grant type', async () => {
      const createdClient = await database.getClientFromName({
        name: 'Client Repo Test'
      })

      // Use a grant type that's not in the default allowed grants
      const isValid = await clientRepository.isClientValid(
        'urn:ietf:params:oauth:grant-type:device_code' as GrantIdentifier,
        createdClient!,
        'test-secret'
      )

      expect(isValid).toBe(false)
    })
  })
})
