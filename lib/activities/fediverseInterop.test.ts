import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { recordActorIfNeeded } from '@/lib/actions/utils'
import { getActorPerson } from '@/lib/activities/getActorPerson'
import { getActorPosts } from '@/lib/activities/getActorPosts'
import { getRemoteStatus } from '@/lib/activities/getRemoteStatus'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { fetchRemoteStatusJob } from '@/lib/jobs/fetchRemoteStatusJob'
import { FETCH_REMOTE_STATUS_JOB_NAME } from '@/lib/jobs/names'
import { seedDatabase } from '@/lib/stub/database'
import {
  FEDIVERSE_ACTORS,
  FEDIVERSE_OBJECTS,
  mockFediverseRequests
} from '@/lib/stub/fediverse'
import { StatusType } from '@/lib/types/domain/status'

enableFetchMocks()

describe('fediverse interop: remote fetch', () => {
  let database: Database

  beforeEach(async () => {
    database = getTestSQLDatabase()
    await database.migrate()
    await seedDatabase(database)
    fetchMock.resetMocks()
    mockFediverseRequests(fetchMock)
  })

  afterEach(async () => {
    await database.destroy()
  })

  describe('actors', () => {
    it.each(
      Object.entries(FEDIVERSE_ACTORS).map(([description, actor]) => ({
        description,
        actor
      }))
    )('$description actor is fetched and recorded', async ({ actor }) => {
      const person = await getActorPerson({ actorId: actor.id })
      expect(person).toMatchObject({
        id: actor.id,
        preferredUsername: actor.preferredUsername
      })

      const recorded = await recordActorIfNeeded({
        actorId: actor.id,
        database
      })
      expect(recorded).toMatchObject({
        id: actor.id,
        username: actor.preferredUsername,
        domain: new URL(actor.id).host
      })
    })
  })

  describe('objects', () => {
    it.each([
      {
        description: 'misskey Note',
        object: FEDIVERSE_OBJECTS.misskeyNote,
        text: 'Hello from Misskey'
      },
      {
        description: 'lemmy Page',
        object: FEDIVERSE_OBJECTS.lemmyPage,
        text: 'This is a post in the /c/tenforward community'
      },
      {
        description: 'lemmy comment Note',
        object: FEDIVERSE_OBJECTS.lemmyComment,
        text: 'first comment!'
      },
      {
        description: 'peertube Video',
        object: FEDIVERSE_OBJECTS.peertubeVideo,
        text: 'television'
      },
      {
        description: 'pixelfed Note',
        object: FEDIVERSE_OBJECTS.pixelfedNote,
        text: 'Sunset over the bay'
      },
      {
        description: 'pleroma Note',
        object: FEDIVERSE_OBJECTS.pleromaNote,
        text: 'Pleroma says hi'
      },
      {
        description: 'gotosocial Note',
        object: FEDIVERSE_OBJECTS.gotosocialNote,
        text: 'hello everyone!'
      }
    ])('$description is fetched as a status', async ({ object, text }) => {
      const status = await getRemoteStatus({ statusId: object.id })
      expect(status).not.toBeNull()
      expect(status?.id).toBe(object.id)
      expect(status?.text).toContain(text)
      expect(status?.actor).not.toBeNull()
    })
  })

  describe('outboxes', () => {
    it.each([
      {
        description: 'misskey paged outbox',
        actor: FEDIVERSE_ACTORS.misskey,
        statusId: FEDIVERSE_OBJECTS.misskeyNote.id
      },
      {
        description: 'lemmy community outbox of Announce(Create(Page))',
        actor: FEDIVERSE_ACTORS.lemmyGroup,
        statusId: FEDIVERSE_OBJECTS.lemmyPage.id
      },
      {
        description: 'peertube channel outbox of Announce(Video)',
        actor: FEDIVERSE_ACTORS.peertubeChannel,
        statusId: FEDIVERSE_OBJECTS.peertubeVideo.id
      },
      {
        description: 'pixelfed inline outbox',
        actor: FEDIVERSE_ACTORS.pixelfed,
        statusId: FEDIVERSE_OBJECTS.pixelfedNote.id
      },
      {
        description: 'gotosocial paged outbox with a bare orderedItems',
        actor: FEDIVERSE_ACTORS.gotosocial,
        statusId: FEDIVERSE_OBJECTS.gotosocialNote.id
      }
    ])('$description lists the post', async ({ actor, statusId }) => {
      const person = await getActorPerson({ actorId: actor.id })
      expect(person).not.toBeNull()
      if (!person) return

      const result = await getActorPosts({ database, person })
      // A community or channel outbox is all boosts, so read the boosted post.
      const postIds = result.statuses.map((status) =>
        status.type === StatusType.enum.Announce
          ? status.originalStatus.id
          : status.id
      )
      expect(postIds).toContain(statusId)
    })
  })

  describe('reply threads', () => {
    it.each([
      {
        description: 'gotosocial replies paged into a single-item page',
        object: FEDIVERSE_OBJECTS.gotosocialNote,
        replyId: FEDIVERSE_OBJECTS.gotosocialReply.id
      },
      {
        description: 'pleroma replies inlined in the first page',
        object: FEDIVERSE_OBJECTS.pleromaNote,
        replyId: FEDIVERSE_OBJECTS.pleromaReply.id
      }
    ])('$description are stored', async ({ object, replyId }) => {
      await fetchRemoteStatusJob(database, {
        id: `fetch-${object.id}`,
        name: FETCH_REMOTE_STATUS_JOB_NAME,
        data: { statusId: object.id }
      })

      const status = await database.getStatus({ statusId: object.id })
      expect(status?.type).toBe(StatusType.enum.Note)
      const reply = await database.getStatus({ statusId: replyId })
      expect(reply).toMatchObject({ id: replyId, reply: object.id })
    })
  })
})
