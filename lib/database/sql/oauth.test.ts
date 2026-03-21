import crypto from 'crypto'
import knex from 'knex'

import { getSQLDatabase } from '@/lib/database/sql'
import { Scope } from '@/lib/types/database/operations'

describe('OAuthDatabase', () => {
  const knexDatabase = knex({
    client: 'better-sqlite3',
    useNullAsDefault: true,
    connection: { filename: ':memory:' }
  })
  const database = getSQLDatabase(knexDatabase)

  beforeAll(async () => {
    await database.migrate()

    // Insert test clients directly into the oauthClient table
    const now = new Date()
    await knexDatabase('oauthClient').insert({
      id: crypto.randomUUID(),
      clientId: 'test-client-1',
      clientSecret: 'hashed-secret-1',
      name: 'oauth-app1',
      scopes: JSON.stringify([Scope.enum.read]),
      redirectUris: JSON.stringify([
        'https://oauth-app1.llun.dev/oauth/redirect'
      ]),
      requirePKCE: false,
      disabled: false,
      grantTypes: JSON.stringify([
        'authorization_code',
        'client_credentials',
        'refresh_token'
      ]),
      responseTypes: JSON.stringify(['code']),
      tokenEndpointAuthMethod: 'client_secret_post',
      createdAt: now,
      updatedAt: now
    })

    await knexDatabase('oauthClient').insert({
      id: crypto.randomUUID(),
      clientId: 'test-client-2',
      clientSecret: 'hashed-secret-2',
      name: 'oauth-app2',
      scopes: JSON.stringify([Scope.enum.read, Scope.enum.write]),
      redirectUris: JSON.stringify([
        'https://oauth-app2.llun.dev/oauth/redirect'
      ]),
      requirePKCE: false,
      disabled: false,
      createdAt: now,
      updatedAt: now
    })
  })

  afterAll(async () => {
    await knexDatabase.destroy()
  })

  describe('clients', () => {
    it('returns existing client by name', async () => {
      const client = await database.getClientFromName({
        name: 'oauth-app1'
      })
      expect(client).toBeDefined()
      expect(client?.name).toBe('oauth-app1')
      expect(client?.clientId).toBe('test-client-1')
      expect(client?.scopes).toEqual([Scope.enum.read])
      expect(client?.redirectUris).toEqual([
        'https://oauth-app1.llun.dev/oauth/redirect'
      ])
    })

    it('returns existing client by clientId', async () => {
      const client = await database.getClientFromId({
        clientId: 'test-client-1'
      })
      expect(client).toBeDefined()
      expect(client?.name).toBe('oauth-app1')
      expect(client?.clientId).toBe('test-client-1')
    })

    it('returns null for non-existent client name', async () => {
      const client = await database.getClientFromName({
        name: 'nonexistent'
      })
      expect(client).toBeNull()
    })

    it('returns null for non-existent client id', async () => {
      const client = await database.getClientFromId({
        clientId: 'nonexistent'
      })
      expect(client).toBeNull()
    })

    it('returns client with correct timestamps', async () => {
      const client = await database.getClientFromName({
        name: 'oauth-app2'
      })
      expect(client?.createdAt).toBeNumber()
      expect(client?.updatedAt).toBeNumber()
    })
  })
})
