import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { SEND_UNBLOCK_JOB_NAME } from '@/lib/jobs/names'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'
import { urlToId } from '@/lib/utils/urlToId'

import { POST } from './route'

const database = getTestSQLDatabase()
const mockPublish = vi.fn()

vi.mock('@/lib/services/guards/OAuthGuard', () => ({
  OAuthGuardAnyScope:
    (
      _scopes: unknown[],
      handle: (
        req: NextRequest,
        context: {
          database: Database
          currentActor: unknown
          params: Promise<{ id: string }>
        }
      ) => Promise<Response> | Response
    ) =>
    async (req: NextRequest, context: { params: Promise<{ id: string }> }) =>
      handle(req, {
        database,
        currentActor: await database.getActorFromId({ id: ACTOR1_ID }),
        params: context.params
      })
}))

vi.mock('@/lib/services/queue', () => ({
  getQueue: () => ({ publish: mockPublish })
}))

const REMOTE_ID = 'https://remote.test/users/blocked'
const UNKNOWN_ID = 'https://remote.test/users/never-seen'
const OTHER_ID = 'https://remote.test/users/other-blocked'

const post = (id: string) =>
  POST(
    new NextRequest(`https://llun.test/api/v1/accounts/${id}/unblock`, {
      method: 'POST'
    }),
    { params: Promise.resolve({ id }) }
  )

describe('POST /api/v1/accounts/:id/unblock', () => {
  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    await database.createActor({
      actorId: REMOTE_ID,
      username: 'blocked',
      domain: 'remote.test',
      followersUrl: `${REMOTE_ID}/followers`,
      inboxUrl: `${REMOTE_ID}/inbox`,
      sharedInboxUrl: 'https://remote.test/inbox',
      publicKey: 'public-key',
      createdAt: Date.now()
    })
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(async () => {
    mockPublish.mockReset()
    mockPublish.mockResolvedValue(undefined)
    vi.restoreAllMocks()
    await database.deleteBlock({ actorId: ACTOR1_ID, targetActorId: REMOTE_ID })
    await database.deleteBlock({ actorId: ACTOR1_ID, targetActorId: OTHER_ID })
    await database.deleteBlock({ actorId: ACTOR1_ID, targetActorId: ACTOR1_ID })
  })

  const isBlocking = () =>
    database.isBlocking({ actorId: ACTOR1_ID, targetActorId: REMOTE_ID })

  it('removes the block, queues the Undo for federation and returns the new relationship', async () => {
    const created = await database.createBlock({
      actorId: ACTOR1_ID,
      targetActorId: REMOTE_ID,
      uri: `${ACTOR1_ID}#blocks/to-undo`
    })
    expect(await isBlocking()).toBe(true)

    const response = await post(urlToId(REMOTE_ID))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      id: expect.any(String),
      blocking: false
    })
    expect(await isBlocking()).toBe(false)
    expect(mockPublish).toHaveBeenCalledTimes(1)
    expect(mockPublish).toHaveBeenCalledWith({
      id: getHashFromString(`${created.uri}/undo`),
      name: SEND_UNBLOCK_JOB_NAME,
      data: { actorId: ACTOR1_ID, block: created }
    })
  })

  it('accepts the raw actor URI as the account id', async () => {
    await database.createBlock({
      actorId: ACTOR1_ID,
      targetActorId: REMOTE_ID,
      uri: `${ACTOR1_ID}#blocks/raw`
    })

    const response = await post(REMOTE_ID)

    expect(response.status).toBe(200)
    expect(await isBlocking()).toBe(false)
  })

  it('still unblocks and answers 200 when queuing the federation job fails', async () => {
    await database.createBlock({
      actorId: ACTOR1_ID,
      targetActorId: REMOTE_ID,
      uri: `${ACTOR1_ID}#blocks/queue-fails`
    })
    mockPublish.mockRejectedValue(new Error('queue down'))
    const warnSpy = vi.spyOn(logger, 'warn')

    const response = await post(urlToId(REMOTE_ID))

    expect(response.status).toBe(200)
    expect(await isBlocking()).toBe(false)
    await vi.waitFor(() =>
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Failed to queue unblock federation',
          actorId: ACTOR1_ID,
          targetActorId: REMOTE_ID
        })
      )
    )
  })

  it('is a no-op that returns the relationship when the known account is not blocked', async () => {
    const response = await post(urlToId(REMOTE_ID))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ blocking: false })
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('returns 404 for an unknown account that is not blocked', async () => {
    const response = await post(urlToId(UNKNOWN_ID))

    expect(response.status).toBe(404)
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('leaves blocks on other accounts untouched', async () => {
    await database.createBlock({
      actorId: ACTOR1_ID,
      targetActorId: OTHER_ID,
      uri: `${ACTOR1_ID}#blocks/other`
    })
    await database.createBlock({
      actorId: ACTOR1_ID,
      targetActorId: REMOTE_ID,
      uri: `${ACTOR1_ID}#blocks/target`
    })

    await post(urlToId(REMOTE_ID))

    expect(
      await database.isBlocking({ actorId: ACTOR1_ID, targetActorId: OTHER_ID })
    ).toBe(true)
  })

  it('does nothing and returns the relationship when the target is the current actor', async () => {
    await database.createBlock({
      actorId: ACTOR1_ID,
      targetActorId: ACTOR1_ID,
      uri: `${ACTOR1_ID}#blocks/self`
    })

    const response = await post(urlToId(ACTOR1_ID))

    expect(response.status).toBe(200)
    expect(
      await database.isBlocking({
        actorId: ACTOR1_ID,
        targetActorId: ACTOR1_ID
      })
    ).toBe(true)
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('returns 400 when the account id is empty', async () => {
    const response = await post('')

    expect(response.status).toBe(400)
    expect(mockPublish).not.toHaveBeenCalled()
  })
})
