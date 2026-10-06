import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'
import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { JOBS } from '@/lib/jobs'
import {
  CREATE_ANNOUNCE_JOB_NAME,
  CREATE_NOTE_JOB_NAME,
  EMOJI_REACTION_JOB_NAME
} from '@/lib/jobs/names'
import type { JobMessage } from '@/lib/services/queue/type'
import { seedDatabase } from '@/lib/stub/database'
import {
  FEDIVERSE_ACTIVITIES,
  FEDIVERSE_OBJECTS,
  mockFediverseRequests
} from '@/lib/stub/fediverse'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { StatusType } from '@/lib/types/domain/status'

import { POST } from './route'

enableFetchMocks()

const LOCAL_POST_ID = `${ACTOR1_ID}/statuses/post-1`

const { mockPublish, testDatabase } = vi.hoisted(() => ({
  mockPublish: vi.fn(),
  testDatabase: { current: null as Database | null }
}))

vi.mock('@/lib/services/queue', () => ({
  getQueue: () => ({ publish: mockPublish })
}))

// Signature verification is covered by the guard's own tests. Here the sender
// is taken to be the activity's actor, as it is for a direct delivery, so the
// route, the job matcher and the job all see what a real delivery produces.
vi.mock('@/lib/services/guards/ActivityPubVerifyGuard', () => ({
  ActivityPubVerifySenderGuard:
    (
      handle: (
        req: NextRequest,
        context: {
          activityBody: unknown
          database: Database
          forwarded: boolean
          params: Promise<{}>
          verifiedSenderActorId: string
        }
      ) => Promise<Response>
    ) =>
    async (req: NextRequest, context: { params: Promise<{}> }) => {
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
  mockPublish.mockClear()
  const response = await POST(
    new NextRequest('https://llun.test/api/inbox', {
      method: 'POST',
      headers: { 'content-type': 'application/activity+json' },
      body: JSON.stringify(activity)
    }),
    { params: Promise.resolve({}) }
  )
  expect(response.status).toBe(202)
  const messages = mockPublish.mock.calls.map(([message]) => message)
  expect(messages.length).toBeLessThanOrEqual(1)
  return messages[0] as JobMessage | undefined
}

const deliverAndRun = async (database: Database, activity: object) => {
  const message = await deliver(activity)
  if (message) await JOBS[message.name](database, message)
  return message
}

describe('fediverse interop: shared inbox', () => {
  let database: Database

  beforeEach(async () => {
    database = getTestSQLDatabase()
    await database.migrate()
    await seedDatabase(database)
    testDatabase.current = database
    mockPublish.mockReset()
    fetchMock.resetMocks()
    mockFediverseRequests(fetchMock)
  })

  afterEach(async () => {
    testDatabase.current = null
    await database.destroy()
  })

  describe('posts', () => {
    it.each([
      {
        description: 'misskey Create(Note)',
        activity: FEDIVERSE_ACTIVITIES.misskeyCreateNote,
        text: 'Hello from Misskey',
        attachments: 1
      },
      {
        description: 'lemmy Create(Page)',
        activity: FEDIVERSE_ACTIVITIES.lemmyCreatePage,
        text: 'This is a post in the /c/tenforward community',
        attachments: 0
      },
      {
        description: 'peertube Create(Video) attributed to account and channel',
        activity: FEDIVERSE_ACTIVITIES.peertubeCreateVideo,
        text: 'television',
        attachments: 1
      },
      {
        description: 'peertube Create(Note) comment',
        activity: FEDIVERSE_ACTIVITIES.peertubeCreateComment,
        text: 'Great episode',
        attachments: 0
      },
      {
        description: 'pixelfed Create(Note) with an Image attachment',
        activity: FEDIVERSE_ACTIVITIES.pixelfedCreateNote,
        text: 'Sunset over the bay',
        attachments: 1
      },
      {
        description: 'pleroma Create(Note)',
        activity: FEDIVERSE_ACTIVITIES.pleromaCreateNote,
        text: 'Pleroma says hi',
        attachments: 0
      },
      {
        description: 'gotosocial Create(Note) with single-value to and cc',
        activity: FEDIVERSE_ACTIVITIES.gotosocialCreateNote,
        text: 'hello everyone!',
        attachments: 0
      }
    ])('$description is stored', async ({ activity, text, attachments }) => {
      const message = await deliverAndRun(database, activity)
      expect(message?.name).toBe(CREATE_NOTE_JOB_NAME)

      const status = await database.getStatus({ statusId: activity.object.id })
      expect(status).toMatchObject({
        id: activity.object.id,
        type: StatusType.enum.Note,
        actorId: activity.actor
      })
      if (status?.type !== StatusType.enum.Note) return
      expect(status.text).toContain(text)
      expect(status.attachments).toHaveLength(attachments)
      expect(status.to.length + status.cc.length).toBeGreaterThan(0)
    })
  })

  describe('boosts', () => {
    it.each([
      {
        description: 'misskey renote',
        activity: FEDIVERSE_ACTIVITIES.misskeyRenote,
        originalId: FEDIVERSE_OBJECTS.misskeyNote.id
      },
      {
        description: 'lemmy community Announce(Create(Page))',
        activity: FEDIVERSE_ACTIVITIES.lemmyAnnounceCreatePage,
        originalId: FEDIVERSE_OBJECTS.lemmyPage.id
      },
      {
        description: 'peertube channel Announce(Video)',
        activity: FEDIVERSE_ACTIVITIES.peertubeAnnounceVideo,
        originalId: FEDIVERSE_OBJECTS.peertubeVideo.id
      },
      {
        description: 'pixelfed Announce',
        activity: FEDIVERSE_ACTIVITIES.pixelfedAnnounce,
        originalId: FEDIVERSE_OBJECTS.pixelfedNote.id
      },
      {
        description: 'pleroma Announce',
        activity: FEDIVERSE_ACTIVITIES.pleromaAnnounce,
        originalId: FEDIVERSE_OBJECTS.pleromaNote.id
      }
    ])(
      '$description stores the boost and its original',
      async ({ activity, originalId }) => {
        const message = await deliverAndRun(database, activity)
        expect(message?.name).toBe(CREATE_ANNOUNCE_JOB_NAME)

        const boost = await database.getStatus({ statusId: activity.id })
        expect(boost).toMatchObject({
          type: StatusType.enum.Announce,
          actorId: activity.actor
        })
        if (boost?.type !== StatusType.enum.Announce) return
        expect(boost.originalStatus.id).toBe(originalId)
      }
    )
  })

  describe('emoji reactions', () => {
    it.each([
      {
        description: 'misskey Like with a unicode reaction',
        activity: FEDIVERSE_ACTIVITIES.misskeyReaction,
        name: '👍'
      },
      {
        description: 'misskey Like with a custom emoji reaction',
        activity: FEDIVERSE_ACTIVITIES.misskeyReactionCustomEmoji,
        name: 'blobcat@misskey.test'
      },
      {
        description: 'pleroma EmojiReact',
        activity: FEDIVERSE_ACTIVITIES.pleromaEmojiReact,
        name: '🔥'
      },
      {
        description: 'pleroma EmojiReact with a custom emoji',
        activity: FEDIVERSE_ACTIVITIES.pleromaEmojiReactCustom,
        name: 'blobfox@pleroma.test'
      }
    ])('$description is recorded', async ({ activity, name }) => {
      const message = await deliverAndRun(database, activity)
      expect(message?.name).toBe(EMOJI_REACTION_JOB_NAME)

      const reactions = await database.getStatusReactionActors({
        statusId: LOCAL_POST_ID
      })
      expect(reactions).toContainEqual(
        expect.objectContaining({ actorId: activity.actor, name })
      )
    })

    it('pleroma Undo(EmojiReact) removes the reaction', async () => {
      await deliverAndRun(database, FEDIVERSE_ACTIVITIES.pleromaEmojiReact)
      const message = await deliverAndRun(
        database,
        FEDIVERSE_ACTIVITIES.pleromaUndoEmojiReact
      )
      expect(message?.name).toBe(EMOJI_REACTION_JOB_NAME)

      const reactions = await database.getStatusReactionActors({
        statusId: LOCAL_POST_ID
      })
      expect(reactions).not.toContainEqual(
        expect.objectContaining({
          actorId: FEDIVERSE_ACTIVITIES.pleromaUndoEmojiReact.actor
        })
      )
    })
  })

  describe('activities the shared inbox acknowledges without a job', () => {
    it.each([
      {
        description: 'lemmy vote Like',
        activity: FEDIVERSE_ACTIVITIES.lemmyLike
      },
      {
        description: 'pixelfed Like',
        activity: FEDIVERSE_ACTIVITIES.pixelfedLike
      },
      {
        description: 'gotosocial Like',
        activity: FEDIVERSE_ACTIVITIES.gotosocialLike
      },
      {
        description: 'pleroma ChatMessage',
        activity: FEDIVERSE_ACTIVITIES.pleromaCreateChatMessage
      }
    ])('$description', async ({ activity }) => {
      expect(await deliver(activity)).toBeUndefined()
    })
  })
})
