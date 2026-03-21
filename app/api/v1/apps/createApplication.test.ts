import knex from 'knex'

import { getSQLDatabase } from '@/lib/database/sql'
import { seedDatabase } from '@/lib/stub/database'

import { createApplication } from './createApplication'
import { SuccessResponse } from './types'

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
    await createApplication({
      client_name: 'existsClient',
      redirect_uris: 'https://exists.llun.dev/apps/redirect',
      scopes: 'read write',
      website: 'https://exists.llun.dev'
    })
  })

  afterAll(async () => {
    await knexDatabase.destroy()
  })

  test('it generates secret and create application in database and returns application response', async () => {
    const response = (await createApplication({
      redirect_uris: 'https://test.llun.dev/apps/redirect',
      client_name: 'client1',
      scopes: 'read write',
      website: 'https://test.llun.dev'
    })) as SuccessResponse
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
    const response = await createApplication({
      client_name: 'existsClient',
      redirect_uris: 'https://test.llun.dev/apps/redirect',
      scopes: 'read write',
      website: 'https://test.llun.dev'
    })
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
    const response = await createApplication({
      client_name: 'newClient',
      redirect_uris: 'https://test.llun.dev/apps/redirect',
      scopes: 'read write something else',
      website: 'https://test.llun.dev'
    })
    expect(response).toEqual({
      type: 'error',
      error: 'Failed to validate request'
    })
  })

  test('it errors when redirect_uris is empty or whitespace-only', async () => {
    const response = await createApplication({
      client_name: 'noRedirectClient',
      redirect_uris: '   ',
      scopes: 'read write',
      website: 'https://test.llun.dev'
    })
    expect(response).toEqual({
      type: 'error',
      error: 'Failed to validate request'
    })
  })

  test('it supports newline-separated redirect URIs per Mastodon API spec', async () => {
    const response = (await createApplication({
      redirect_uris:
        'https://test.llun.dev/callback\nhttps://test.llun.dev/alt-callback',
      client_name: 'multiRedirectClient',
      scopes: 'read',
      website: 'https://test.llun.dev'
    })) as SuccessResponse
    expect(response.type).toEqual('success')
    expect(response.redirect_uri).toEqual('https://test.llun.dev/callback')
  })
})
