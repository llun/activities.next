import { randomUUID } from 'node:crypto'

import {
  SELF_CHAIN_DEPTH_CAP,
  getRepliesTabStatusIds
} from '@/lib/database/domains/status/repliesTab'
import type { ActorVisibleStatusAudience } from '@/lib/database/kysely/visibility/actorVisible'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { getHashFromString } from '@/lib/utils/getHashFromString'

// The profile's Posts/Replies split for self-threads: the first post of the
// author's self-reply chain decides. Every test seeds its own actors (a fresh
// prefix). Runs on PostgreSQL in CI.

const testDb = createTestDatabase()
const db = testDb.db

beforeAll(async () => {
  await testDb.prepare()
  await testDb.database.migrate()
})

afterAll(async () => {
  await testDb.destroy()
})

let prefixCount = 0
const nextPrefix = () => `rt${++prefixCount}`
const DOMAIN = 'replies-tab.test'
const BASE = Date.UTC(2026, 1, 1)
const MINUTE = 60_000
const OWNER: ActorVisibleStatusAudience = {}

const seedActor = async (id: string) => {
  await db
    .insertInto('actors')
    .values({
      id,
      username: id.split('/').pop() ?? id,
      domain: DOMAIN,
      publicKey: 'public-key',
      settings: JSON.stringify({
        followersUrl: `${id}/followers`,
        inboxUrl: `${id}/inbox`,
        sharedInboxUrl: `https://${DOMAIN}/inbox`
      }),
      createdAt: new Date(BASE),
      updatedAt: new Date(BASE)
    })
    .execute()
  return id
}

let statusCount = 0
const seedStatus = async ({
  id,
  actorId,
  reply = '',
  url = id,
  to = [ACTIVITY_STREAM_PUBLIC],
  type = StatusType.enum.Note
}: {
  id: string
  actorId: string
  reply?: string
  url?: string
  to?: string[]
  type?: StatusType
}) => {
  statusCount += 1
  await db
    .insertInto('statuses')
    .values({
      id,
      url,
      urlHash: getHashFromString(url),
      actorId,
      type,
      reply,
      replyHash: reply ? getHashFromString(reply) : null,
      content:
        type === StatusType.enum.Announce
          ? null
          : JSON.stringify({ text: `<p>${id}</p>` }),
      createdAt: new Date(BASE + statusCount * MINUTE),
      updatedAt: new Date(BASE + statusCount * MINUTE)
    })
    .execute()
  await db
    .insertInto('recipients')
    .values(
      to.map((actorId) => ({
        id: randomUUID(),
        statusId: id,
        actorId,
        type: 'to',
        createdAt: new Date(BASE),
        updatedAt: new Date(BASE)
      }))
    )
    .execute()
  return id
}

const seedActors = async () => {
  const prefix = nextPrefix()
  const author = await seedActor(`https://${DOMAIN}/users/${prefix}-author`)
  const other = await seedActor(`https://${DOMAIN}/users/${prefix}-other`)
  return {
    author,
    other,
    status: (name: string) => `${author}/statuses/${name}`
  }
}

describe('getRepliesTabStatusIds', () => {
  it.each([
    { description: 'a top-level post', name: 'top', tab: 'posts' },
    { description: 'a self-reply to a post', name: 'self-1', tab: 'posts' },
    { description: 'a self-reply chain by url', name: 'self-2', tab: 'posts' },
    {
      description: 'a reply to someone else',
      name: 'to-other',
      tab: 'replies'
    },
    {
      description: 'a self-reply under a reply',
      name: 'under-other-1',
      tab: 'replies'
    },
    {
      description: 'a chain under a reply by url',
      name: 'under-other-2',
      tab: 'replies'
    },
    {
      description: 'a reply to a missing parent',
      name: 'gone',
      tab: 'replies'
    },
    {
      description: 'a self-reply under a missing one',
      name: 'under-gone',
      tab: 'replies'
    },
    { description: 'a boost', name: 'boost', tab: 'posts' }
  ])('puts $description on $tab', async ({ name, tab }) => {
    const { author, other, status } = await seedActors()
    const othersPost = await seedStatus({
      id: `${other}/statuses/post`,
      actorId: other
    })
    await seedStatus({ id: status('top'), actorId: author })
    await seedStatus({
      id: status('self-1'),
      url: `${status('self-1')}/permalink`,
      actorId: author,
      reply: status('top')
    })
    // Names its parent by url, which differs from the parent's id.
    await seedStatus({
      id: status('self-2'),
      actorId: author,
      reply: `${status('self-1')}/permalink`
    })
    await seedStatus({
      id: status('to-other'),
      url: `${status('to-other')}/permalink`,
      actorId: author,
      reply: othersPost
    })
    await seedStatus({
      id: status('under-other-1'),
      actorId: author,
      reply: status('to-other')
    })
    await seedStatus({
      id: status('under-other-2'),
      actorId: author,
      reply: `${status('to-other')}/permalink`
    })
    await seedStatus({
      id: status('gone'),
      actorId: author,
      reply: 'https://elsewhere.test/statuses/gone'
    })
    await seedStatus({
      id: status('under-gone'),
      actorId: author,
      reply: status('gone')
    })
    await seedStatus({
      id: status('boost'),
      actorId: author,
      type: StatusType.enum.Announce
    })

    const repliesTab = await getRepliesTabStatusIds(db, {
      actorId: author,
      statusIds: [status(name)],
      audience: OWNER
    })

    expect(repliesTab).toEqual(tab === 'replies' ? [status(name)] : [])
  })

  it('classifies a whole page in one statement, in the order asked', async () => {
    const { author, other, status } = await seedActors()
    const othersPost = await seedStatus({
      id: `${other}/statuses/post`,
      actorId: other
    })
    const othersReply = await seedStatus({
      id: `${other}/statuses/reply`,
      actorId: other,
      reply: othersPost
    })
    await seedStatus({ id: status('top'), actorId: author })
    await seedStatus({
      id: status('self'),
      actorId: author,
      reply: status('top')
    })
    await seedStatus({
      id: status('to-other'),
      actorId: author,
      reply: othersPost
    })
    await seedStatus({
      id: status('under-other'),
      actorId: author,
      reply: status('to-other')
    })

    let repliesTab: string[] = []
    const statements = await testDb.captureQueries(async () => {
      repliesTab = await getRepliesTabStatusIds(db, {
        actorId: author,
        statusIds: [
          status('under-other'),
          status('self'),
          status('to-other'),
          status('top'),
          // Another actor's reply is not this profile's to classify.
          othersReply
        ],
        audience: OWNER
      })
    })

    expect(repliesTab).toEqual([status('under-other'), status('to-other')])
    expect(statements).toHaveLength(1)
  })

  it('sends no statement for an empty page', async () => {
    const { author } = await seedActors()
    const statements = await testDb.captureQueries(async () => {
      await expect(
        getRepliesTabStatusIds(db, {
          actorId: author,
          statusIds: [],
          audience: OWNER
        })
      ).resolves.toEqual([])
    })
    expect(statements).toEqual([])
  })

  it('falls back to Posts once the walk reaches the depth cap', async () => {
    const { author, other, status } = await seedActors()
    const othersPost = await seedStatus({
      id: `${other}/statuses/post`,
      actorId: other
    })
    // part-0 replies to someone else; part-k is k self-replies below it.
    await seedStatus({
      id: status('part-0'),
      actorId: author,
      reply: othersPost
    })
    for (let index = 1; index <= SELF_CHAIN_DEPTH_CAP; index++) {
      await seedStatus({
        id: status(`part-${index}`),
        actorId: author,
        reply: status(`part-${index - 1}`)
      })
    }

    const repliesTab = await getRepliesTabStatusIds(db, {
      actorId: author,
      statusIds: [
        status(`part-${SELF_CHAIN_DEPTH_CAP - 1}`),
        status(`part-${SELF_CHAIN_DEPTH_CAP}`)
      ],
      audience: OWNER
    })

    // The walk from the last part stops one step short of part-0's own
    // parent, so it counts as Mastodon counts a self-reply: on Posts.
    expect(repliesTab).toEqual([status(`part-${SELF_CHAIN_DEPTH_CAP - 1}`)])
  })

  it('ends a chain that loops back on itself at the cap', async () => {
    const { author, status } = await seedActors()
    await seedStatus({ id: status('a'), actorId: author, reply: status('b') })
    await seedStatus({ id: status('b'), actorId: author, reply: status('a') })

    await expect(
      getRepliesTabStatusIds(db, {
        actorId: author,
        statusIds: [status('a')],
        audience: OWNER
      })
    ).resolves.toEqual([])
  })

  it.each([
    { description: 'the owner', audience: 'owner', tab: 'replies' },
    { description: 'a follower', audience: 'follower', tab: 'replies' },
    { description: 'a signed-in stranger', audience: 'viewer', tab: 'posts' },
    { description: 'a logged-out visitor', audience: 'public', tab: 'posts' }
  ])(
    'walks only through ancestors $description may read',
    async ({ audience, tab }) => {
      const { author, other, status } = await seedActors()
      const othersPost = await seedStatus({
        id: `${other}/statuses/post`,
        actorId: other
      })
      // A public reply to someone else, a followers-only self-reply under it,
      // and a public self-reply under that.
      await seedStatus({
        id: status('to-other'),
        actorId: author,
        reply: othersPost
      })
      await seedStatus({
        id: status('followers-only'),
        actorId: author,
        reply: status('to-other'),
        to: [`${author}/followers`]
      })
      await seedStatus({
        id: status('public'),
        actorId: author,
        reply: status('followers-only')
      })

      const audiences: Record<string, ActorVisibleStatusAudience> = {
        owner: OWNER,
        follower: {
          visibleToActorId: other,
          includeFollowersOnly: true,
          followersAudience: `${author}/followers`
        },
        viewer: { visibleToActorId: other },
        public: { publicOnly: true }
      }
      const repliesTab = await getRepliesTabStatusIds(db, {
        actorId: author,
        statusIds: [status('public')],
        audience: audiences[audience]
      })

      // A viewer who cannot open the followers-only part learns only what
      // `exclude_replies` already says: the public part answers the author's
      // own post, so it sits on Posts.
      expect(repliesTab).toEqual(tab === 'replies' ? [status('public')] : [])
    }
  )
})
