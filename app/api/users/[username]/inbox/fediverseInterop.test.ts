import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'
import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { seedDatabase } from '@/lib/stub/database'
import {
  FEDIVERSE_ACTIVITIES,
  FEDIVERSE_FOLLOWS,
  mockFediverseRequests
} from '@/lib/stub/fediverse'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'

import { POST } from './route'

enableFetchMocks()

const LOCAL_POST_ID = `${ACTOR1_ID}/statuses/post-1`

const { testDatabase } = vi.hoisted(() => ({
  testDatabase: { current: null as Database | null }
}))

vi.mock('@/lib/database', () => ({
  getDatabase: () => testDatabase.current
}))

// The seeded local actors live on `llun.test`, not the configured test host.
vi.mock('@/lib/services/guards/headerHost', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/lib/services/guards/headerHost')
  >()),
  headerHost: () => 'llun.test'
}))

vi.mock('@/lib/services/queue', () => ({
  getQueue: () => ({ publish: vi.fn() })
}))

// Signature verification is covered by the guard's own tests. Here the sender
// is taken to be the activity's actor, as it is for a direct delivery; the
// local-user guard is the real one, resolving `test1` from the test database.
vi.mock('@/lib/services/guards/ActivityPubVerifyGuard', () => ({
  ActivityPubVerifySenderGuard:
    (
      handle: (
        req: NextRequest,
        context: {
          activityBody: unknown
          database: Database
          forwarded: boolean
          params: Promise<{ username: string }>
          verifiedSenderActorId: string
        }
      ) => Promise<Response>
    ) =>
    async (
      req: NextRequest,
      context: { params: Promise<{ username: string }> }
    ) => {
      const activityBody = await req.clone().json()
      if (!testDatabase.current) throw new Error('database is not ready')
      return handle(req, {
        activityBody,
        database: testDatabase.current,
        forwarded: false,
        params: context.params,
        verifiedSenderActorId: activityBody.actor
      })
    }
}))

const deliver = async (activity: object) => {
  const response = await POST(
    new NextRequest(`https://${seedActor1.domain}/users/test1/inbox`, {
      method: 'POST',
      headers: { 'content-type': 'application/activity+json' },
      body: JSON.stringify(activity)
    }),
    { params: Promise.resolve({ username: seedActor1.username }) }
  )
  expect(response.status).toBeLessThan(300)
}

describe('fediverse interop: personal inbox', () => {
  let database: Database

  beforeEach(async () => {
    database = getTestSQLDatabase()
    await database.migrate()
    await seedDatabase(database)
    testDatabase.current = database
    fetchMock.resetMocks()
    mockFediverseRequests(fetchMock)
  })

  afterEach(async () => {
    testDatabase.current = null
    await database.destroy()
  })

  it.each(
    Object.entries(FEDIVERSE_FOLLOWS).map(([description, activity]) => ({
      description,
      activity
    }))
  )('$description creates a follower', async ({ activity }) => {
    await deliver(activity)

    const follow = await database.getAcceptedOrRequestedFollow({
      actorId: activity.actor,
      targetActorId: ACTOR1_ID
    })
    expect(follow).not.toBeNull()
  })

  it.each([
    { description: 'lemmy vote', activity: FEDIVERSE_ACTIVITIES.lemmyLike },
    {
      description: 'pixelfed Like',
      activity: FEDIVERSE_ACTIVITIES.pixelfedLike
    },
    {
      description: 'gotosocial Like',
      activity: FEDIVERSE_ACTIVITIES.gotosocialLike
    }
  ])('$description is recorded as a favourite', async ({ activity }) => {
    await deliver(activity)

    expect(
      await database.isActorLikedStatus({
        actorId: activity.actor,
        statusId: LOCAL_POST_ID
      })
    ).toBe(true)
  })

  it.each([
    {
      description: 'misskey Like with a reaction',
      activity: FEDIVERSE_ACTIVITIES.misskeyReaction,
      name: '👍'
    },
    {
      description: 'pleroma EmojiReact',
      activity: FEDIVERSE_ACTIVITIES.pleromaEmojiReact,
      name: '🔥'
    }
  ])('$description is recorded as a reaction', async ({ activity, name }) => {
    await deliver(activity)

    const reactions = await database.getStatusReactionActors({
      statusId: LOCAL_POST_ID
    })
    expect(reactions).toContainEqual(
      expect.objectContaining({ actorId: activity.actor, name })
    )
  })
})
