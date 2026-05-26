import knex from 'knex'

import { getSQLDatabase } from '@/lib/database/sql'
import { seedDatabase } from '@/lib/stub/database'

import {
  createApplication,
  resetAppRegistrationGcStateForTests
} from './createApplication'
import { PostResponse, SuccessResponse } from './types'

// Create a knex instance we can use for both the database and for getKnex mock
const knexDatabase = knex({
  client: 'better-sqlite3',
  useNullAsDefault: true,
  connection: { filename: ':memory:' }
})

jest.mock('@/lib/database', () => ({
  getDatabase: jest.fn(),
  getKnex: () => knexDatabase
}))

describe('createApplication', () => {
  const database = getSQLDatabase(knexDatabase)

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    await createApplication(
      {
        client_name: 'existsClient',
        redirect_uris: 'https://exists.llun.dev/apps/redirect',
        scopes: 'read write',
        website: 'https://exists.llun.dev'
      },
      { registrationKey: 'setup-source' }
    )
  })

  beforeEach(() => {
    resetAppRegistrationGcStateForTests()
  })

  afterAll(async () => {
    await knexDatabase.destroy()
  })

  test('it generates secret and create application in database and returns application response', async () => {
    const response = (await createApplication(
      {
        redirect_uris: 'https://test.llun.dev/apps/redirect',
        client_name: 'client1',
        scopes: 'read write',
        website: 'https://test.llun.dev'
      },
      { registrationKey: 'generated-source' }
    )) as SuccessResponse
    expect(response).toEqual({
      type: 'success',
      id: expect.toBeString(),
      client_id: expect.toBeString(),
      client_secret: expect.toBeString(),
      name: 'client1',
      website: 'https://test.llun.dev',
      redirect_uri: 'https://test.llun.dev/apps/redirect'
    })
    expect(response.id).not.toEqual(response.client_id)
    expect(response.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    )
  })

  test('it always creates a new application even when one with the same name exists', async () => {
    const response = await createApplication(
      {
        client_name: 'existsClient',
        redirect_uris: 'https://test.llun.dev/apps/redirect',
        scopes: 'read write',
        website: 'https://test.llun.dev'
      },
      { registrationKey: 'same-name-source' }
    )
    expect(response).toEqual({
      type: 'success',
      id: expect.toBeString(),
      client_id: expect.toBeString(),
      client_secret: expect.toBeString(),
      name: 'existsClient',
      website: 'https://test.llun.dev',
      redirect_uri: 'https://test.llun.dev/apps/redirect'
    })
  })

  test('it errors with message validation failed when scope is not valid', async () => {
    const response = await createApplication(
      {
        client_name: 'newClient',
        redirect_uris: 'https://test.llun.dev/apps/redirect',
        scopes: 'read write something else',
        website: 'https://test.llun.dev'
      },
      { registrationKey: 'invalid-scope-source' }
    )
    expect(response).toEqual({
      type: 'error',
      error: 'Failed to validate request'
    })
  })

  test('it ignores extra whitespace between scopes', async () => {
    const response = (await createApplication({
      client_name: 'whitespaceScopesClient',
      redirect_uris: 'https://test.llun.dev/apps/redirect',
      scopes: '  read   write\nfollow\t',
      website: 'https://test.llun.dev'
    })) as SuccessResponse

    expect(response.type).toBe('success')

    const dbClient = await knexDatabase('oauthClient')
      .where({ id: response.id })
      .first()
    expect(JSON.parse(dbClient.scopes)).toEqual(['read', 'write', 'follow'])
  })

  test('it accepts Mastodon bookmark scopes', async () => {
    const response = (await createApplication({
      client_name: 'bookmarkScopesClient',
      redirect_uris: 'https://test.llun.dev/apps/redirect',
      scopes: 'read:bookmarks write:bookmarks',
      website: 'https://test.llun.dev'
    })) as SuccessResponse

    expect(response.type).toBe('success')

    const dbClient = await knexDatabase('oauthClient')
      .where({ id: response.id })
      .first()
    expect(JSON.parse(dbClient.scopes)).toEqual([
      'read:bookmarks',
      'write:bookmarks'
    ])
  })

  test('it accepts Mastodon account write scopes', async () => {
    const response = (await createApplication({
      client_name: 'accountWriteScopesClient',
      redirect_uris: 'https://test.llun.dev/apps/redirect',
      scopes: 'write:accounts',
      website: 'https://test.llun.dev'
    })) as SuccessResponse

    expect(response.type).toBe('success')

    const dbClient = await knexDatabase('oauthClient')
      .where({ id: response.id })
      .first()
    expect(JSON.parse(dbClient.scopes)).toEqual(['write:accounts'])
  })

  test('it accepts Mastodon push scopes', async () => {
    const response = (await createApplication({
      client_name: 'pushScopesClient',
      redirect_uris: 'https://test.llun.dev/apps/redirect',
      scopes: 'read write follow push',
      website: 'https://test.llun.dev'
    })) as SuccessResponse

    expect(response.type).toBe('success')

    const dbClient = await knexDatabase('oauthClient')
      .where({ id: response.id })
      .first()
    expect(JSON.parse(dbClient.scopes)).toEqual([
      'read',
      'write',
      'follow',
      'push'
    ])
  })

  test('it defaults omitted scopes to read', async () => {
    const response = (await createApplication({
      client_name: 'defaultScopesClient',
      redirect_uris: 'https://test.llun.dev/apps/redirect',
      website: 'https://test.llun.dev'
    })) as SuccessResponse

    expect(response.type).toBe('success')

    const dbClient = await knexDatabase('oauthClient')
      .where({ id: response.id })
      .first()
    expect(JSON.parse(dbClient.scopes)).toEqual(['read'])
  })

  test('it defaults whitespace-only scopes to read', async () => {
    const response = (await createApplication({
      client_name: 'blankScopesClient',
      redirect_uris: 'https://test.llun.dev/apps/redirect',
      scopes: '   \n\t  ',
      website: 'https://test.llun.dev'
    })) as SuccessResponse

    expect(response.type).toBe('success')

    const dbClient = await knexDatabase('oauthClient')
      .where({ id: response.id })
      .first()
    expect(JSON.parse(dbClient.scopes)).toEqual(['read'])
  })

  test('it errors when redirect_uris is empty or whitespace-only', async () => {
    const response = await createApplication(
      {
        client_name: 'noRedirectClient',
        redirect_uris: '   ',
        scopes: 'read write',
        website: 'https://test.llun.dev'
      },
      { registrationKey: 'empty-redirect-source' }
    )
    expect(response).toEqual({
      type: 'error',
      error: 'Failed to validate request'
    })
  })

  test('it supports newline-separated redirect URIs per Mastodon API spec', async () => {
    const response = (await createApplication(
      {
        redirect_uris:
          'https://test.llun.dev/callback\nhttps://test.llun.dev/alt-callback',
        client_name: 'multiRedirectClient',
        scopes: 'read',
        website: 'https://test.llun.dev'
      },
      { registrationKey: 'multi-redirect-source' }
    )) as SuccessResponse
    expect(response.type).toEqual('success')
    expect(response.redirect_uri).toEqual('https://test.llun.dev/callback')
  })

  test('it rate limits app registration floods from the same unauthenticated source', async () => {
    const registrationKey = 'flood-source'
    const now = new Date('2026-05-12T12:00:00.000Z')
    const responses: PostResponse[] = []

    for (let i = 0; i < 6; i++) {
      responses.push(
        await createApplication(
          {
            redirect_uris: `https://flood-${i}.llun.dev/callback`,
            client_name: `floodClient${i}`,
            scopes: 'read',
            website: `https://flood-${i}.llun.dev`
          },
          { registrationKey, now }
        )
      )
    }

    expect(
      responses.slice(0, 5).every((response) => response.type === 'success')
    ).toBe(true)
    expect(responses[5]).toEqual({
      type: 'error',
      error: 'Too many application registrations'
    })

    const rows = await knexDatabase('oauthClient')
      .where('referenceId', `app-registration:${registrationKey}`)
      .select()
    expect(rows).toHaveLength(5)
  })

  test('it stores unrated registrations without a shared rate-limit reference', async () => {
    const response = (await createApplication({
      redirect_uris: 'https://unrated.llun.dev/callback',
      client_name: 'unratedClient',
      scopes: 'read',
      website: 'https://unrated.llun.dev'
    })) as SuccessResponse

    expect(response.type).toBe('success')
    await expect(
      knexDatabase('oauthClient').where({ id: response.id }).first()
    ).resolves.toEqual(
      expect.objectContaining({
        referenceId: ''
      })
    )
  })

  test('it does not rate limit registrations when no source key is available', async () => {
    const now = new Date('2030-05-12T12:00:00.000Z')
    const responses: PostResponse[] = []

    for (let i = 0; i < 6; i++) {
      responses.push(
        await createApplication(
          {
            redirect_uris: `https://anonymous-flood-${i}.llun.dev/callback`,
            client_name: `anonymousFloodClient${i}`,
            scopes: 'read',
            website: `https://anonymous-flood-${i}.llun.dev`
          },
          { now }
        )
      )
    }

    expect(responses.every((response) => response.type === 'success')).toBe(
      true
    )

    const rows = await knexDatabase('oauthClient')
      .where('referenceId', '')
      .where('createdAt', '>=', new Date('2030-05-12T11:50:00.000Z'))
      .select()
    expect(rows).toHaveLength(6)
  })

  test('it checks the rate limit before garbage collecting stale app registrations', async () => {
    const registrationKey = 'rate-limited-gc-source'
    const now = new Date('2026-05-12T13:00:00.000Z')
    const staleCreatedAt = new Date('2026-05-10T00:00:00.000Z')

    for (let i = 0; i < 5; i++) {
      await createApplication(
        {
          redirect_uris: `https://rate-limited-${i}.llun.dev/callback`,
          client_name: `rateLimitedClient${i}`,
          scopes: 'read',
          website: `https://rate-limited-${i}.llun.dev`
        },
        { registrationKey, now }
      )
    }
    await knexDatabase('oauthClient').insert({
      id: 'rate-limited-stale-unused-client-id',
      clientId: 'rate-limited-stale-unused-client',
      clientSecret: 'hashed-secret',
      name: 'rate-limited-stale-unused',
      scopes: JSON.stringify(['read']),
      redirectUris: JSON.stringify([
        'https://rate-limited-stale-unused.llun.dev/callback'
      ]),
      requirePKCE: true,
      disabled: false,
      grantTypes: JSON.stringify(['authorization_code']),
      responseTypes: JSON.stringify(['code']),
      tokenEndpointAuthMethod: 'client_secret_post',
      referenceId: 'app-registration:rate-limited-stale-unused',
      createdAt: staleCreatedAt,
      updatedAt: staleCreatedAt
    })

    const response = await createApplication(
      {
        redirect_uris: 'https://blocked.llun.dev/callback',
        client_name: 'blockedClient',
        scopes: 'read',
        website: 'https://blocked.llun.dev'
      },
      { registrationKey, now }
    )

    expect(response).toEqual({
      type: 'error',
      error: 'Too many application registrations'
    })
    await expect(
      knexDatabase('oauthClient')
        .where('clientId', 'rate-limited-stale-unused-client')
        .first()
    ).resolves.toEqual(
      expect.objectContaining({
        clientId: 'rate-limited-stale-unused-client'
      })
    )
  })

  test('it garbage-collects stale unused app registrations without deleting token-backed clients', async () => {
    const staleCreatedAt = new Date('2026-05-10T00:00:00.000Z')
    const recentCreatedAt = new Date('2026-05-12T11:30:00.000Z')
    const now = new Date('2026-05-12T12:00:00.000Z')

    await knexDatabase('oauthClient').insert([
      {
        id: 'stale-unused-client-id',
        clientId: 'stale-unused-client',
        clientSecret: 'hashed-secret',
        name: 'stale-unused',
        scopes: JSON.stringify(['read']),
        redirectUris: JSON.stringify([
          'https://stale-unused.llun.dev/callback'
        ]),
        requirePKCE: true,
        disabled: false,
        grantTypes: JSON.stringify(['authorization_code']),
        responseTypes: JSON.stringify(['code']),
        tokenEndpointAuthMethod: 'client_secret_post',
        referenceId: 'app-registration:stale-unused',
        createdAt: staleCreatedAt,
        updatedAt: staleCreatedAt
      },
      {
        id: 'stale-active-client-id',
        clientId: 'stale-active-client',
        clientSecret: 'hashed-secret',
        name: 'stale-active',
        scopes: JSON.stringify(['read']),
        redirectUris: JSON.stringify([
          'https://stale-active.llun.dev/callback'
        ]),
        requirePKCE: true,
        disabled: false,
        grantTypes: JSON.stringify(['authorization_code']),
        responseTypes: JSON.stringify(['code']),
        tokenEndpointAuthMethod: 'client_secret_post',
        referenceId: 'app-registration:stale-active',
        createdAt: staleCreatedAt,
        updatedAt: staleCreatedAt
      },
      {
        id: 'stale-anonymous-client-id',
        clientId: 'stale-anonymous-client',
        clientSecret: 'hashed-secret',
        name: 'stale-anonymous',
        scopes: JSON.stringify(['read']),
        redirectUris: JSON.stringify([
          'https://stale-anonymous.llun.dev/callback'
        ]),
        requirePKCE: true,
        disabled: false,
        grantTypes: JSON.stringify(['authorization_code']),
        responseTypes: JSON.stringify(['code']),
        tokenEndpointAuthMethod: 'client_secret_post',
        referenceId: '',
        metadata: JSON.stringify({ registeredUnauthenticated: true }),
        createdAt: staleCreatedAt,
        updatedAt: staleCreatedAt
      },
      {
        id: 'recent-anonymous-client-id',
        clientId: 'recent-anonymous-client',
        clientSecret: 'hashed-secret',
        name: 'recent-anonymous',
        scopes: JSON.stringify(['read']),
        redirectUris: JSON.stringify([
          'https://recent-anonymous.llun.dev/callback'
        ]),
        requirePKCE: true,
        disabled: false,
        grantTypes: JSON.stringify(['authorization_code']),
        responseTypes: JSON.stringify(['code']),
        tokenEndpointAuthMethod: 'client_secret_post',
        referenceId: '',
        metadata: JSON.stringify({ registeredUnauthenticated: true }),
        createdAt: recentCreatedAt,
        updatedAt: recentCreatedAt
      }
    ])
    await knexDatabase('oauthAccessToken').insert({
      id: 'stale-active-token-id',
      token: 'stale-active-token',
      clientId: 'stale-active-client',
      referenceId: null,
      expiresAt: new Date('2026-05-13T00:00:00.000Z'),
      scopes: JSON.stringify(['read'])
    })

    await createApplication(
      {
        redirect_uris: 'https://gc.llun.dev/callback',
        client_name: 'gcClient',
        scopes: 'read',
        website: 'https://gc.llun.dev'
      },
      { registrationKey: 'gc-source', now }
    )

    await expect(
      knexDatabase('oauthClient')
        .where('clientId', 'stale-unused-client')
        .first()
    ).resolves.toBeUndefined()
    await expect(
      knexDatabase('oauthClient')
        .where('clientId', 'stale-active-client')
        .first()
    ).resolves.toEqual(
      expect.objectContaining({ clientId: 'stale-active-client' })
    )
    await expect(
      knexDatabase('oauthClient')
        .where('clientId', 'stale-anonymous-client')
        .first()
    ).resolves.toBeUndefined()
    await expect(
      knexDatabase('oauthClient')
        .where('clientId', 'recent-anonymous-client')
        .first()
    ).resolves.toEqual(
      expect.objectContaining({ clientId: 'recent-anonymous-client' })
    )
  })

  test('it orders stale app registration garbage collection before limiting', async () => {
    const queries: string[] = []
    const onQuery = (query: { sql: string }) => queries.push(query.sql)
    knexDatabase.on('query', onQuery)

    try {
      await createApplication(
        {
          redirect_uris: 'https://ordered-gc.llun.dev/callback',
          client_name: 'orderedGcClient',
          scopes: 'read',
          website: 'https://ordered-gc.llun.dev'
        },
        {
          registrationKey: 'ordered-gc-source',
          now: new Date('2026-05-12T14:00:00.000Z')
        }
      )
    } finally {
      knexDatabase.off('query', onQuery)
    }

    const staleClientQuery = queries.find(
      (sql) =>
        sql.includes('from `oauthClient`') &&
        sql.includes('left join `oauthAccessToken`') &&
        sql.includes('limit ?')
    )
    expect(staleClientQuery).toContain('order by `oauthClient`.`createdAt` asc')
  })
})
