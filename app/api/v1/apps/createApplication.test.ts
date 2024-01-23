import { SqlStorage } from '@/lib/storage/sql'
import { seedStorage } from '@/lib/stub/storage'

import { createApplication } from './createApplication'
import { SuccessResponse } from './types'

describe('createApplication', () => {
  const storage = new SqlStorage({
    client: 'better-sqlite3',
    useNullAsDefault: true,
    connection: {
      filename: ':memory:'
    }
  })

  beforeAll(async () => {
    await storage.migrate()
    await seedStorage(storage)
    await createApplication(storage, {
      client_name: 'existsClient',
      redirect_uris: 'https://exists.llun.dev/apps/redirect',
      scopes: 'read write',
      website: 'https://exists.llun.dev'
    })
  })

  afterAll(async () => {
    if (!storage) return
    await storage.destroy()
  })

  test('it generates secret and create application in storage and returns application response', async () => {
    const response = (await createApplication(storage, {
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
    expect(response.id).toEqual(response.client_id)
  })

  test('it returns applications already exists error', async () => {
    const response = await createApplication(storage, {
      client_name: 'existsClient',
      redirect_uris: 'https://test.llun.dev/apps/redirect',
      scopes: 'read write',
      website: 'https://test.llun.dev'
    })
    expect(response).toEqual({
      type: 'error',
      error: 'Application existsClient is already exists'
    })
  })
})
