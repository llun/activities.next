import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { getSenderPublicKey } from '@/lib/services/guards/getSenderPublicKey'
import { mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'

enableFetchMocks()

describe('getSenderPublicKey', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
  })

  afterAll(async () => {
    if (!database) return
    await database.destroy()
  })

  beforeEach(() => {
    fetchMock.resetMocks()
    mockRequests(fetchMock)
  })

  it('returns public key for local actor', async () => {
    const actor = await database.getActorFromUsername({
      username: seedActor1.username,
      domain: seedActor1.domain
    })
    if (!actor) fail('Actor is required')

    const publicKey = await getSenderPublicKey(database, actor.id)
    expect(publicKey).toBe(actor.publicKey)
  })

  it('returns public key from remote actor', async () => {
    const actorId = 'https://remote.test/users/test1'
    const publicKey = await getSenderPublicKey(database, actorId)

    expect(publicKey).toBeTruthy()
  })

  it('signs remote public key fetches with a local actor', async () => {
    const actorId = 'https://remote.test/users/signed-key'
    const publicKey = await getSenderPublicKey(database, actorId)

    expect(publicKey).toBeTruthy()

    const call = fetchMock.mock.calls.find(([url]) => url === actorId)
    expect(call).toBeDefined()
    const request = call?.[1]
    expect(request?.headers).toMatchObject({
      host: 'remote.test',
      signature: expect.stringContaining('headers="(request-target) host date"')
    })
  })

  it('returns empty string when remote actor not found', async () => {
    fetchMock.mockResponseOnce('', { status: 404 })
    const actorId = 'https://unknown.test/users/nonexistent'
    const publicKey = await getSenderPublicKey(database, actorId)
    expect(publicKey).toBe('')
  })
})
