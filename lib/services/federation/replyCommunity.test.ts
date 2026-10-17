import { Database } from '@/lib/database/types'
import { Actor } from '@/lib/types/domain/actor'
import { Status } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

import {
  findCommunityActorId,
  getReplyCommunityActorId,
  getStatusCommunityActorId
} from './replyCommunity'

const COMMUNITY = 'https://lemmy.test/c/tenforward'
const PICARD = 'https://lemmy.test/u/picard'
const ME = 'https://local.test/users/me'

const databaseWith = (actors: Pick<Actor, 'id' | 'type'>[]) => {
  const getActorsFromIds = vi.fn(async ({ ids }: { ids: string[] }) =>
    actors.filter((actor) => ids.includes(actor.id))
  )
  return {
    database: { getActorsFromIds } as unknown as Database,
    getActorsFromIds
  }
}

const OTHER_GROUP = 'https://other.test/c/mentioned'

describe('findCommunityActorId', () => {
  const groups = [
    { id: COMMUNITY, type: 'Group' },
    { id: OTHER_GROUP, type: 'Group' },
    { id: PICARD, type: 'Person' }
  ] as const

  it('returns the Group among the addressed actors', async () => {
    const { database, getActorsFromIds } = databaseWith([...groups])
    await expect(
      findCommunityActorId({
        database,
        authorId: PICARD,
        recipientIds: [
          ACTIVITY_STREAM_PUBLIC,
          `${PICARD}/followers`,
          PICARD,
          COMMUNITY
        ]
      })
    ).resolves.toBe(COMMUNITY)
    // Public and followers collections are never looked up
    expect(getActorsFromIds).toHaveBeenCalledWith({
      ids: [PICARD, COMMUNITY]
    })
  })

  it('returns null without a Group', async () => {
    const { database } = databaseWith([...groups])
    await expect(
      findCommunityActorId({
        database,
        authorId: PICARD,
        recipientIds: [ACTIVITY_STREAM_PUBLIC, PICARD]
      })
    ).resolves.toBeNull()
  })

  it('prefers a Group author over any recipient, in any order', async () => {
    const { database } = databaseWith([...groups])
    for (const recipientIds of [
      [COMMUNITY, OTHER_GROUP],
      [OTHER_GROUP, COMMUNITY]
    ]) {
      await expect(
        findCommunityActorId({
          database,
          authorId: COMMUNITY,
          recipientIds
        })
      ).resolves.toBe(COMMUNITY)
    }
  })

  it('prefers a Group that is not mentioned, in any order', async () => {
    const { database } = databaseWith([...groups])
    for (const recipientIds of [
      [OTHER_GROUP, COMMUNITY],
      [COMMUNITY, OTHER_GROUP]
    ]) {
      await expect(
        findCommunityActorId({
          database,
          authorId: PICARD,
          recipientIds,
          mentionedIds: [OTHER_GROUP]
        })
      ).resolves.toBe(COMMUNITY)
    }
  })

  it('uses a single mentioned Group (group-by-mention software)', async () => {
    const { database } = databaseWith([...groups])
    await expect(
      findCommunityActorId({
        database,
        authorId: PICARD,
        recipientIds: [ACTIVITY_STREAM_PUBLIC, OTHER_GROUP],
        mentionedIds: [OTHER_GROUP]
      })
    ).resolves.toBe(OTHER_GROUP)
  })

  it('returns null when several candidates are ambiguous', async () => {
    const { database } = databaseWith([...groups])
    // Two mentioned Groups, none unmentioned
    await expect(
      findCommunityActorId({
        database,
        authorId: PICARD,
        recipientIds: [OTHER_GROUP, COMMUNITY],
        mentionedIds: [OTHER_GROUP, COMMUNITY]
      })
    ).resolves.toBeNull()
    // Two unmentioned Groups
    await expect(
      findCommunityActorId({
        database,
        authorId: PICARD,
        recipientIds: [OTHER_GROUP, COMMUNITY]
      })
    ).resolves.toBeNull()
  })
})

describe('community lookup from statuses', () => {
  const parent = {
    id: 'https://lemmy.test/comment/1',
    actorId: PICARD,
    isLocalActor: false,
    tags: [],
    to: [ACTIVITY_STREAM_PUBLIC],
    cc: [COMMUNITY, PICARD]
  } as unknown as Status

  it('finds the community a Lemmy-style parent is addressed to', async () => {
    const { database } = databaseWith([{ id: COMMUNITY, type: 'Group' }])
    await expect(
      getReplyCommunityActorId({ database, replyStatus: parent })
    ).resolves.toBe(COMMUNITY)
  })

  it('treats a Group author (Mbin, Friendica) as the community', async () => {
    const { database } = databaseWith([{ id: COMMUNITY, type: 'Group' }])
    await expect(
      getReplyCommunityActorId({
        database,
        replyStatus: {
          ...parent,
          actorId: COMMUNITY,
          cc: []
        } as unknown as Status
      })
    ).resolves.toBe(COMMUNITY)
  })

  it('skips Groups that the remote parent only mentions', async () => {
    const { database } = databaseWith([
      { id: COMMUNITY, type: 'Group' },
      { id: OTHER_GROUP, type: 'Group' }
    ])
    await expect(
      getReplyCommunityActorId({
        database,
        replyStatus: {
          ...parent,
          cc: [OTHER_GROUP, COMMUNITY],
          tags: [{ type: 'mention', name: '@mentioned', value: OTHER_GROUP }]
        } as unknown as Status
      })
    ).resolves.toBe(COMMUNITY)
  })

  type Step = {
    id: string
    reply: string | null
    actorId: string
    isLocalActor: boolean
    to: string[]
    cc: string[]
  }
  const localStep = (
    n: number,
    reply: string | null,
    overrides: Partial<Step> = {}
  ): Step => ({
    id: `https://local.test/statuses/${n}`,
    reply,
    actorId: ME,
    isLocalActor: true,
    to: [ACTIVITY_STREAM_PUBLIC],
    cc: [],
    ...overrides
  })
  const localStatus = (step: Step) =>
    ({ ...step, reply: step.reply ?? '', tags: [] }) as unknown as Status
  const walkDatabase = (steps: Step[], remote: Status | null = parent) => {
    const { database } = databaseWith([
      { id: COMMUNITY, type: 'Group' },
      { id: OTHER_GROUP, type: 'Group' }
    ])
    const getStatusThreadStep = vi.fn(
      async ({ statusId }: { statusId: string }) =>
        steps.find((step) => step.id === statusId) ?? null
    )
    const getStatus = vi.fn(async () => remote)
    Object.assign(database, { getStatusThreadStep, getStatus })
    return { database, getStatusThreadStep, getStatus }
  }

  it('takes the community of a local parent from its own parent', async () => {
    const local = localStep(1, parent.id, { cc: [OTHER_GROUP, COMMUNITY] })
    const { database, getStatusThreadStep, getStatus } = walkDatabase([
      {
        id: parent.id,
        reply: null,
        actorId: PICARD,
        isLocalActor: false,
        to: parent.to,
        cc: parent.cc
      }
    ])

    await expect(
      getReplyCommunityActorId({
        database,
        replyStatus: localStatus(local)
      })
    ).resolves.toBe(COMMUNITY)
    expect(getStatusThreadStep).toHaveBeenCalledWith({ statusId: parent.id })
    expect(getStatus).toHaveBeenCalledTimes(1)
    expect(getStatus).toHaveBeenCalledWith({
      statusId: parent.id,
      withReplies: false
    })
  })

  it('walks a local to local to remote chain with light queries', async () => {
    const chain = [
      localStep(1, 'https://local.test/statuses/2'),
      localStep(2, 'https://local.test/statuses/3'),
      localStep(3, parent.id)
    ]
    const { database, getStatusThreadStep, getStatus } = walkDatabase([
      ...chain,
      {
        id: parent.id,
        reply: null,
        actorId: PICARD,
        isLocalActor: false,
        to: parent.to,
        cc: parent.cc
      }
    ])
    await expect(
      getReplyCommunityActorId({
        database,
        replyStatus: localStatus(chain[0])
      })
    ).resolves.toBe(COMMUNITY)
    expect(getStatusThreadStep).toHaveBeenCalledTimes(3)
    expect(getStatus).toHaveBeenCalledTimes(1)
  })

  it('stops at the depth limit', async () => {
    const depth = 40
    const chain = Array.from({ length: depth }, (_, i) =>
      localStep(i, `https://local.test/statuses/${i + 1}`)
    )
    const { database, getStatusThreadStep, getStatus } = walkDatabase(chain)
    await expect(
      getReplyCommunityActorId({
        database,
        replyStatus: localStatus(chain[0])
      })
    ).resolves.toBeNull()
    // 20 posts visited: the first is given, 19 are looked up
    expect(getStatusThreadStep).toHaveBeenCalledTimes(20 - 1)
    expect(getStatus).not.toHaveBeenCalled()
  })

  it('stops at a local ancestor that is not public or unlisted', async () => {
    const hidden = localStep(2, parent.id, {
      to: [`${ME}/followers`],
      cc: []
    })
    const { database, getStatus } = walkDatabase([
      hidden,
      {
        id: parent.id,
        reply: null,
        actorId: PICARD,
        isLocalActor: false,
        to: parent.to,
        cc: parent.cc
      }
    ])
    await expect(
      getReplyCommunityActorId({
        database,
        replyStatus: localStatus(localStep(1, hidden.id))
      })
    ).resolves.toBeNull()
    expect(getStatus).not.toHaveBeenCalled()
  })

  it('stops at a remote ancestor that is not public or unlisted', async () => {
    const { database } = walkDatabase([
      {
        id: parent.id,
        reply: null,
        actorId: COMMUNITY,
        isLocalActor: false,
        to: [`${COMMUNITY}/followers`],
        cc: []
      }
    ])
    await expect(
      getReplyCommunityActorId({
        database,
        replyStatus: localStatus(localStep(1, parent.id))
      })
    ).resolves.toBeNull()
  })

  it('returns null for a local thread that loops or has no community', async () => {
    const loop = localStep(1, 'https://local.test/statuses/1')
    const { database } = walkDatabase([loop])
    await expect(
      getReplyCommunityActorId({ database, replyStatus: localStatus(loop) })
    ).resolves.toBeNull()
    await expect(
      getReplyCommunityActorId({
        database,
        replyStatus: localStatus({ ...loop, reply: null })
      })
    ).resolves.toBeNull()
    await expect(
      getReplyCommunityActorId({
        database,
        replyStatus: localStatus(localStep(1, 'https://local.test/gone'))
      })
    ).resolves.toBeNull()
  })
})

describe('getStatusCommunityActorId', () => {
  const parent = {
    id: 'https://lemmy.test/post/1',
    actorId: PICARD,
    isLocalActor: false,
    tags: [],
    to: [ACTIVITY_STREAM_PUBLIC],
    cc: [COMMUNITY, PICARD]
  } as unknown as Status
  const reply = (to: string[], cc: string[]) =>
    ({
      id: 'https://local.test/statuses/1',
      type: 'Note',
      reply: parent.id,
      to,
      cc
    }) as unknown as Status
  const databaseFor = (parentStatus: Status | null) => {
    const { database } = databaseWith([
      { id: COMMUNITY, type: 'Group' },
      { id: OTHER_GROUP, type: 'Group' }
    ])
    ;(database as unknown as { getStatus: unknown }).getStatus = vi.fn(
      async () => parentStatus
    )
    return database
  }

  it("returns the parent's community when the reply names it", async () => {
    await expect(
      getStatusCommunityActorId({
        database: databaseFor(parent),
        status: reply([ACTIVITY_STREAM_PUBLIC], [PICARD, COMMUNITY])
      })
    ).resolves.toBe(COMMUNITY)
  })

  it('ignores a mentioned Group that is not the parent community', async () => {
    await expect(
      getStatusCommunityActorId({
        database: databaseFor(parent),
        status: reply(
          [ACTIVITY_STREAM_PUBLIC],
          [COMMUNITY, OTHER_GROUP, PICARD]
        )
      })
    ).resolves.toBe(COMMUNITY)
  })

  it('returns null for a followers-only reply that mentions the community', async () => {
    await expect(
      getStatusCommunityActorId({
        database: databaseFor(parent),
        status: reply([`${ME}/followers`], [COMMUNITY, PICARD])
      })
    ).resolves.toBeNull()
  })

  it("returns null for a followers-only reply to the Group's own post", async () => {
    const groupPost = {
      ...parent,
      actorId: COMMUNITY,
      cc: []
    } as unknown as Status
    await expect(
      getStatusCommunityActorId({
        database: databaseFor(groupPost),
        status: reply([`${ME}/followers`], [COMMUNITY])
      })
    ).resolves.toBeNull()
  })

  it('returns null when the parent is not public or unlisted', async () => {
    await expect(
      getStatusCommunityActorId({
        database: databaseFor({
          ...parent,
          to: [`${PICARD}/followers`],
          cc: [COMMUNITY]
        } as unknown as Status),
        status: reply([ACTIVITY_STREAM_PUBLIC], [COMMUNITY])
      })
    ).resolves.toBeNull()
  })

  it('returns null when the reply does not name the community', async () => {
    await expect(
      getStatusCommunityActorId({
        database: databaseFor(parent),
        status: reply([PICARD, OTHER_GROUP], [])
      })
    ).resolves.toBeNull()
  })

  it('returns null without a reply or when the parent is gone', async () => {
    await expect(
      getStatusCommunityActorId({
        database: databaseFor(parent),
        status: { ...reply([], [COMMUNITY]), reply: '' } as unknown as Status
      })
    ).resolves.toBeNull()
    await expect(
      getStatusCommunityActorId({
        database: databaseFor(null),
        status: reply([ACTIVITY_STREAM_PUBLIC], [COMMUNITY])
      })
    ).resolves.toBeNull()
  })
})
