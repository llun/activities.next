import { sql } from 'kysely'
import { randomUUID } from 'node:crypto'

import { getActor } from '@/lib/database/domains/actor/rows'
import {
  createFollow,
  getAcceptedFollowTargetActorIds,
  getAcceptedOrRequestedFollow,
  getAcceptedOrRequestedFollowsWithDomain,
  getFollowFromId,
  getFollowRequests,
  getFollowRequestsCount,
  getFollowers,
  getFollowersInbox,
  getFollowing,
  getLocalActorsFromFollowerUrl,
  getLocalFollowersForActorId,
  getLocalFollowsFromInboxUrl,
  updateFollowPreferences,
  updateFollowStatus
} from '@/lib/database/domains/follow/queries'
import { CounterKey } from '@/lib/database/sql/utils/counter'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { listTimelineKey } from '@/lib/services/timelines/types'
import { FollowStatus } from '@/lib/types/domain/follow'
import { StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { getHashFromString } from '@/lib/utils/getHashFromString'

// The real row mapper, spied on so a test can check what it is handed.
vi.mock('@/lib/database/domains/actor/rows', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/lib/database/domains/actor/rows')>()
  return { ...original, getActor: vi.fn(original.getActor) }
})

// Query-level tests for the follow domain. Every test uses its own actors (a
// fresh prefix) and puts neighbouring rows next to the ones under test —
// another actor's follows, another target's, other statuses — so a dropped
// predicate shows up as a wrong row. Ids that tie on createdAt differ only in
// a trailing digit, so they sort the same under any collation. Runs on
// PostgreSQL in CI.

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
const nextPrefix = () => `fq${++prefixCount}`
const BASE = Date.UTC(2026, 0, 1)

const actorIn = (domain: string, name: string) =>
  `https://${domain}/users/${name}`

const { Accepted, Requested, Undo, Rejected } = FollowStatus.enum

type SeedFollow = {
  id?: string
  actorId: string
  targetActorId: string
  status: FollowStatus
  createdAt?: number | null
  inbox?: string
  sharedInbox?: string | null
  reblogs?: boolean
  notify?: boolean
  languages?: string | null
}

const seedFollow = async ({
  id = randomUUID(),
  actorId,
  targetActorId,
  status,
  createdAt = BASE,
  inbox = `${actorId}/inbox`,
  sharedInbox = null,
  reblogs = true,
  notify = false,
  languages = null
}: SeedFollow) => {
  const at = createdAt === null ? null : new Date(createdAt)
  await db
    .insertInto('follows')
    .values({
      id,
      actorId,
      actorHost: new URL(actorId).host,
      targetActorId,
      targetActorHost: new URL(targetActorId).host,
      status,
      inbox,
      sharedInbox,
      reblogs,
      notify,
      languages,
      createdAt: at,
      updatedAt: at
    })
    .execute()
  return id
}

const followRow = (id: string) =>
  db
    .selectFrom('follows')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirstOrThrow()

const counterValue = async (id: string) => {
  const row = await db
    .selectFrom('counters')
    .select('value')
    .where('id', '=', id)
    .executeTakeFirst()
  return row ? Number(row.value) : undefined
}

const seedActor = async ({
  id,
  privateKey = null,
  followersUrl = `${id}/followers`,
  accountId = null
}: {
  id: string
  privateKey?: string | null
  followersUrl?: string
  accountId?: string | null
}) => {
  const url = new URL(id)
  const username = url.pathname.split('/').pop() as string
  const now = new Date(BASE)
  await db
    .insertInto('actors')
    .values({
      id,
      username,
      domain: url.host,
      accountId,
      publicKey: `public-${username}`,
      privateKey,
      settings: JSON.stringify({
        followersUrl,
        inboxUrl: `${id}/inbox`,
        sharedInboxUrl: `https://${url.host}/inbox`
      }),
      createdAt: now,
      updatedAt: now
    })
    .execute()
}

const seedStatus = async (id: string, actorId: string, createdAt: number) => {
  await db
    .insertInto('statuses')
    .values({
      id,
      url: id,
      urlHash: getHashFromString(id),
      actorId,
      type: StatusType.enum.Note,
      reply: '',
      createdAt: new Date(createdAt),
      updatedAt: new Date(createdAt)
    })
    .execute()
  await db
    .insertInto('recipients')
    .values({
      id: randomUUID(),
      statusId: id,
      actorId: ACTIVITY_STREAM_PUBLIC,
      type: 'to'
    })
    .execute()
}

const seedMembership = async (
  listId: string,
  ownerId: string,
  memberId: string
) => {
  await db
    .insertInto('list_accounts')
    .values({
      id: randomUUID(),
      listId,
      actorId: ownerId,
      targetActorId: memberId,
      createdAt: new Date(BASE)
    })
    .execute()
}

const seedTimelineRow = async (
  ownerId: string,
  timeline: string,
  statusId: string,
  statusActorId: string
) => {
  await db
    .insertInto('timelines')
    .values({
      actorId: ownerId,
      timeline,
      statusId,
      statusActorId,
      createdAt: new Date(BASE),
      updatedAt: new Date(BASE)
    })
    .execute()
}

const membershipsOf = async (ownerId: string) =>
  (
    await db
      .selectFrom('list_accounts')
      .select(['listId', 'targetActorId'])
      .where('actorId', '=', ownerId)
      .execute()
  )
    .map((row) => `${row.listId}>${row.targetActorId}`)
    .sort()

const timelineRowsOf = async (ownerId: string) =>
  (
    await db
      .selectFrom('timelines')
      .select(['timeline', 'statusId'])
      .where('actorId', '=', ownerId)
      .execute()
  )
    .map((row) => `${row.timeline}>${row.statusId}`)
    .sort()

describe('getFollowFromId', () => {
  it('reads the follow with that id', async () => {
    const prefix = nextPrefix()
    const actorId = actorIn('a.test', `${prefix}-a`)
    const targetActorId = actorIn('b.test', `${prefix}-b`)
    const id = await seedFollow({
      actorId,
      targetActorId,
      status: Accepted,
      sharedInbox: 'https://a.test/inbox',
      reblogs: false,
      notify: true,
      languages: JSON.stringify(['en', 'th'])
    })
    await seedFollow({ actorId, targetActorId: actorId, status: Requested })

    expect(await getFollowFromId(db, { followId: id })).toEqual({
      id,
      actorId,
      actorHost: 'a.test',
      targetActorId,
      targetActorHost: 'b.test',
      status: Accepted,
      inbox: `${actorId}/inbox`,
      sharedInbox: 'https://a.test/inbox',
      reblogs: false,
      notify: true,
      languages: ['en', 'th'],
      createdAt: BASE,
      updatedAt: BASE
    })
    expect(await getFollowFromId(db, { followId: `${id}-x` })).toBeNull()
  })

  it('reads a NULL timestamp as 0 and unreadable languages as null', async () => {
    const prefix = nextPrefix()
    const id = await seedFollow({
      actorId: actorIn('a.test', `${prefix}-a`),
      targetActorId: actorIn('b.test', `${prefix}-b`),
      status: Accepted,
      createdAt: null,
      languages: 'not json'
    })
    const follow = await getFollowFromId(db, { followId: id })
    expect(follow).toMatchObject({
      createdAt: 0,
      updatedAt: 0,
      languages: null
    })
  })
})

describe('getAcceptedOrRequestedFollow', () => {
  it('finds only a live follow between the two actors', async () => {
    const prefix = nextPrefix()
    const actorId = actorIn('a.test', `${prefix}-a`)
    const live = actorIn('b.test', `${prefix}-live`)
    const ended = actorIn('b.test', `${prefix}-ended`)
    const requestedId = await seedFollow({
      actorId,
      targetActorId: live,
      status: Requested
    })
    await seedFollow({ actorId, targetActorId: ended, status: Undo })
    await seedFollow({ actorId, targetActorId: ended, status: Rejected })
    // The reverse direction and another follower of the same target.
    await seedFollow({
      actorId: ended,
      targetActorId: actorId,
      status: Accepted
    })
    await seedFollow({
      actorId: actorIn('c.test', `${prefix}-c`),
      targetActorId: ended,
      status: Accepted
    })

    expect(
      (await getAcceptedOrRequestedFollow(db, { actorId, targetActorId: live }))
        ?.id
    ).toBe(requestedId)
    expect(
      await getAcceptedOrRequestedFollow(db, { actorId, targetActorId: ended })
    ).toBeNull()
  })
})

describe('createFollow', () => {
  it('stores the follow and counts an accepted one on both actors', async () => {
    const prefix = nextPrefix()
    const actorId = actorIn('a.test', `${prefix}-a`)
    const targetActorId = actorIn('b.test', `${prefix}-b`)
    const follow = await createFollow(db, {
      actorId,
      targetActorId,
      status: Accepted,
      inbox: `${actorId}/inbox`,
      sharedInbox: 'https://a.test/inbox',
      languages: ['en']
    })

    expect(follow).toMatchObject({
      actorId,
      actorHost: 'a.test',
      targetActorId,
      targetActorHost: 'b.test',
      status: Accepted,
      reblogs: true,
      notify: false,
      languages: ['en']
    })
    expect(await getFollowFromId(db, { followId: follow.id })).toEqual(follow)
    expect((await followRow(follow.id)).languages).toBe('["en"]')
    expect(await counterValue(CounterKey.totalFollowing(actorId))).toBe(1)
    expect(await counterValue(CounterKey.totalFollowers(targetActorId))).toBe(1)
    expect(
      await counterValue(CounterKey.totalFollowers(actorId))
    ).toBeUndefined()
  })

  it('counts nothing for a request and stores an empty language list as NULL', async () => {
    const prefix = nextPrefix()
    const actorId = actorIn('a.test', `${prefix}-a`)
    const targetActorId = actorIn('b.test', `${prefix}-b`)
    const follow = await createFollow(db, {
      actorId,
      targetActorId,
      status: Requested,
      inbox: `${actorId}/inbox`,
      sharedInbox: '',
      reblogs: false,
      notify: true,
      languages: []
    })
    expect(follow.languages).toEqual([])
    expect(await followRow(follow.id)).toMatchObject({
      status: Requested,
      reblogs: false,
      notify: true,
      languages: null
    })
    expect(
      await counterValue(CounterKey.totalFollowing(actorId))
    ).toBeUndefined()
    expect(
      await counterValue(CounterKey.totalFollowers(targetActorId))
    ).toBeUndefined()
  })

  it('returns the live follow instead of adding another, but not an ended one', async () => {
    const prefix = nextPrefix()
    const actorId = actorIn('a.test', `${prefix}-a`)
    const targetActorId = actorIn('b.test', `${prefix}-b`)
    const existingId = await seedFollow({
      actorId,
      targetActorId,
      status: Requested
    })
    const again = await createFollow(db, {
      actorId,
      targetActorId,
      status: Accepted,
      inbox: `${actorId}/inbox`,
      sharedInbox: ''
    })
    expect(again.id).toBe(existingId)
    expect(again.status).toBe(Requested)
    expect(
      await counterValue(CounterKey.totalFollowing(actorId))
    ).toBeUndefined()

    const other = actorIn('b.test', `${prefix}-other`)
    await seedFollow({ actorId, targetActorId: other, status: Undo })
    const fresh = await createFollow(db, {
      actorId,
      targetActorId: other,
      status: Accepted,
      inbox: `${actorId}/inbox`,
      sharedInbox: ''
    })
    const rows = await db
      .selectFrom('follows')
      .select('status')
      .where('actorId', '=', actorId)
      .where('targetActorId', '=', other)
      .execute()
    expect(rows.map((row) => row.status).sort()).toEqual([Accepted, Undo])
    expect(fresh.status).toBe(Accepted)
  })
})

describe('updateFollowPreferences', () => {
  it('updates only the given preferences of the live follow', async () => {
    const prefix = nextPrefix()
    const actorId = actorIn('a.test', `${prefix}-a`)
    const targetActorId = actorIn('b.test', `${prefix}-b`)
    const id = await seedFollow({
      actorId,
      targetActorId,
      status: Accepted,
      languages: JSON.stringify(['th'])
    })
    // The same actor's follow of someone else, and an ended follow of the
    // same target.
    const neighbourId = await seedFollow({
      actorId,
      targetActorId: actorIn('b.test', `${prefix}-c`),
      status: Accepted
    })
    const endedId = await seedFollow({ actorId, targetActorId, status: Undo })

    const updated = await updateFollowPreferences(db, {
      actorId,
      targetActorId,
      notify: true,
      languages: []
    })
    expect(updated).toMatchObject({
      id,
      reblogs: true,
      notify: true,
      languages: null
    })
    expect(updated?.updatedAt).toBeGreaterThan(BASE)
    expect(await followRow(id)).toMatchObject({
      reblogs: true,
      notify: true,
      languages: null
    })
    expect((await followRow(id)).updatedAt).toBe(updated?.updatedAt)
    expect(await followRow(neighbourId)).toMatchObject({
      notify: false,
      updatedAt: BASE
    })
    expect(await followRow(endedId)).toMatchObject({
      notify: false,
      updatedAt: BASE
    })

    await updateFollowPreferences(db, {
      actorId,
      targetActorId,
      reblogs: false,
      languages: ['en']
    })
    expect(await followRow(id)).toMatchObject({
      reblogs: false,
      notify: true,
      languages: '["en"]'
    })
  })

  it('writes nothing without a preference, and finds nothing without a live follow', async () => {
    const prefix = nextPrefix()
    const actorId = actorIn('a.test', `${prefix}-a`)
    const targetActorId = actorIn('b.test', `${prefix}-b`)
    const id = await seedFollow({ actorId, targetActorId, status: Requested })
    const unchanged = await updateFollowPreferences(db, {
      actorId,
      targetActorId
    })
    expect(unchanged?.updatedAt).toBe(BASE)
    expect((await followRow(id)).updatedAt).toBe(BASE)

    const endedTarget = actorIn('b.test', `${prefix}-ended`)
    const endedId = await seedFollow({
      actorId,
      targetActorId: endedTarget,
      status: Rejected
    })
    expect(
      await updateFollowPreferences(db, {
        actorId,
        targetActorId: endedTarget,
        notify: true
      })
    ).toBeNull()
    expect((await followRow(endedId)).notify).toBe(false)
  })
})

describe('getLocalFollowersForActorId', () => {
  it('returns every accepted follower of a remote actor, newest first', async () => {
    const prefix = nextPrefix()
    const target = actorIn('remote.test', `${prefix}-target`)
    await seedActor({ id: target })
    const older = await seedFollow({
      actorId: actorIn('x.test', `${prefix}-1`),
      targetActorId: target,
      status: Accepted,
      createdAt: BASE
    })
    const newer = await seedFollow({
      actorId: actorIn('y.test', `${prefix}-2`),
      targetActorId: target,
      status: Accepted,
      createdAt: BASE + 1000
    })
    await seedFollow({
      actorId: actorIn('x.test', `${prefix}-3`),
      targetActorId: target,
      status: Requested
    })
    await seedFollow({
      actorId: actorIn('x.test', `${prefix}-4`),
      targetActorId: actorIn('remote.test', `${prefix}-other`),
      status: Accepted
    })

    const follows = await getLocalFollowersForActorId(db, {
      targetActorId: target
    })
    expect(follows.map((follow) => follow.id)).toEqual([newer, older])
  })

  it('returns only followers on a local domain for a local actor', async () => {
    const prefix = nextPrefix()
    const localDomain = `${prefix}-local.test`
    const keylessDomain = `${prefix}-keyless.test`
    const remoteDomain = `${prefix}-remote.test`
    const target = actorIn(localDomain, `${prefix}-target`)
    await seedActor({ id: target, privateKey: 'key' })
    await seedActor({
      id: actorIn(keylessDomain, `${prefix}-keyless`),
      privateKey: ''
    })
    await seedActor({ id: actorIn(remoteDomain, `${prefix}-remote`) })

    const localOlder = await seedFollow({
      actorId: actorIn(localDomain, `${prefix}-1`),
      targetActorId: target,
      status: Accepted,
      createdAt: BASE
    })
    const localNewer = await seedFollow({
      actorId: actorIn(localDomain, `${prefix}-2`),
      targetActorId: target,
      status: Accepted,
      createdAt: BASE + 1000
    })
    await seedFollow({
      actorId: actorIn(keylessDomain, `${prefix}-3`),
      targetActorId: target,
      status: Accepted
    })
    await seedFollow({
      actorId: actorIn(remoteDomain, `${prefix}-4`),
      targetActorId: target,
      status: Accepted
    })
    await seedFollow({
      actorId: actorIn(localDomain, `${prefix}-5`),
      targetActorId: target,
      status: Requested
    })
    await seedFollow({
      actorId: actorIn(localDomain, `${prefix}-6`),
      targetActorId: actorIn(localDomain, `${prefix}-other`),
      status: Accepted
    })

    const follows = await getLocalFollowersForActorId(db, {
      targetActorId: target
    })
    expect(follows.map((follow) => follow.id)).toEqual([localNewer, localOlder])
  })
})

describe('getLocalFollowsFromInboxUrl', () => {
  it('matches the inbox or the shared inbox of the target’s followers, once each', async () => {
    const prefix = nextPrefix()
    const target = actorIn('t.test', `${prefix}-target`)
    const inbox = `https://f.test/${prefix}/inbox`
    const byInbox = await seedFollow({
      actorId: actorIn('f.test', `${prefix}-1`),
      targetActorId: target,
      status: Accepted,
      inbox
    })
    const byShared = await seedFollow({
      actorId: actorIn('f.test', `${prefix}-2`),
      targetActorId: target,
      status: Requested,
      inbox: `https://f.test/${prefix}/other`,
      sharedInbox: inbox
    })
    const byBoth = await seedFollow({
      actorId: actorIn('f.test', `${prefix}-3`),
      targetActorId: target,
      status: Accepted,
      inbox,
      sharedInbox: inbox
    })
    await seedFollow({
      actorId: actorIn('f.test', `${prefix}-4`),
      targetActorId: actorIn('t.test', `${prefix}-other`),
      status: Accepted,
      inbox,
      sharedInbox: inbox
    })
    await seedFollow({
      actorId: actorIn('f.test', `${prefix}-5`),
      targetActorId: target,
      status: Accepted,
      inbox: `https://f.test/${prefix}/elsewhere`
    })

    const follows = await getLocalFollowsFromInboxUrl(db, {
      targetActorId: target,
      followerInboxUrl: inbox
    })
    expect(follows.map((follow) => follow.id).sort()).toEqual(
      [byInbox, byShared, byBoth].sort()
    )
  })
})

describe('getLocalActorsFromFollowerUrl', () => {
  it('maps the local accepted followers of the actor owning the followers URL', async () => {
    const prefix = nextPrefix()
    const target = actorIn('remote.test', `${prefix}-target`)
    const followersUrl = `https://remote.test/collections/${prefix}-followers`
    await seedActor({ id: target, followersUrl })
    await seedActor({
      id: actorIn('remote.test', `${prefix}-neighbour`),
      followersUrl: `${followersUrl}-not`
    })
    const accountId = randomUUID()
    const now = new Date(BASE)
    // Another account, written first, that the actor's account read must not
    // pick up.
    for (const [id, email] of [
      [randomUUID(), `${prefix}-neighbour@local.test`],
      [accountId, `${prefix}@local.test`]
    ]) {
      await db
        .insertInto('accounts')
        .values({ id, email, createdAt: now, updatedAt: now })
        .execute()
    }
    const local = actorIn('local.test', `${prefix}-local`)
    await seedActor({ id: local, privateKey: 'key', accountId })
    const requested = actorIn('local.test', `${prefix}-requested`)
    await seedActor({ id: requested, privateKey: 'key' })
    const keyless = actorIn('local.test', `${prefix}-keyless`)
    await seedActor({ id: keyless, privateKey: '' })
    const elsewhere = actorIn('local.test', `${prefix}-elsewhere`)
    await seedActor({ id: elsewhere, privateKey: 'key' })
    await seedFollow({
      actorId: local,
      targetActorId: target,
      status: Accepted
    })
    await seedFollow({
      actorId: requested,
      targetActorId: target,
      status: Requested
    })
    await seedFollow({
      actorId: keyless,
      targetActorId: target,
      status: Accepted
    })
    await seedFollow({
      actorId: elsewhere,
      targetActorId: actorIn('remote.test', `${prefix}-neighbour`),
      status: Accepted
    })
    for (const [key, value] of [
      [CounterKey.totalFollowing(local), 3],
      [CounterKey.totalFollowers(local), 5],
      [CounterKey.totalStatus(local), 7]
    ] as const) {
      await db
        .insertInto('counters')
        .values({ id: key, value, createdAt: now, updatedAt: now })
        .execute()
    }

    const mapper = vi.mocked(getActor)
    mapper.mockClear()
    const actors = await getLocalActorsFromFollowerUrl(db, {
      followerUrl: followersUrl
    })
    expect(actors.map((actor) => actor.id)).toEqual([local])
    const mapped = mapper.mock.calls
    expect(mapped).toHaveLength(1)
    const [row, following, followers, statuses, lastStatusAt, account] =
      mapped[0]
    expect(row).toMatchObject({ id: local, privateKey: 'key' })
    expect([following, followers, statuses, lastStatusAt]).toEqual([3, 5, 7, 0])
    expect(account).toMatchObject({
      id: accountId,
      email: `${prefix}@local.test`
    })
    expect(actors[0].account).toMatchObject({
      id: accountId,
      email: `${prefix}@local.test`
    })

    expect(
      await getLocalActorsFromFollowerUrl(db, {
        followerUrl: `${followersUrl}-missing`
      })
    ).toEqual([])
    expect(mapper).toHaveBeenCalledTimes(1)
  })

  it('maps rows through the real actor mapper', async () => {
    const prefix = nextPrefix()
    const target = actorIn('remote.test', `${prefix}-target`)
    const followersUrl = `${target}/followers`
    await seedActor({ id: target, followersUrl })
    const local = actorIn('local.test', `${prefix}-local`)
    await seedActor({ id: local, privateKey: 'key' })
    await seedFollow({
      actorId: local,
      targetActorId: target,
      status: Accepted
    })

    const actors = await getLocalActorsFromFollowerUrl(db, {
      followerUrl: followersUrl
    })
    expect(actors).toEqual([
      expect.objectContaining({
        id: local,
        username: `${prefix}-local`,
        domain: 'local.test',
        followersUrl: `${local}/followers`,
        followingCount: 0,
        followersCount: 0,
        statusCount: 0,
        createdAt: BASE
      })
    ])
  })

  it('reads lastStatusAt as before: the stored time, else 0', async () => {
    const prefix = nextPrefix()
    const target = actorIn('remote.test', `${prefix}-target`)
    const followersUrl = `${target}/followers`
    await seedActor({ id: target, followersUrl })
    const local = actorIn('local.test', `${prefix}-local`)
    await seedActor({ id: local, privateKey: 'key' })
    await seedFollow({
      actorId: local,
      targetActorId: target,
      status: Accepted
    })
    const lastStatusAt = async () =>
      (
        await getLocalActorsFromFollowerUrl(db, { followerUrl: followersUrl })
      )[0].lastStatusAt

    expect(await lastStatusAt()).toBe(0)
    await db
      .updateTable('actors')
      .set({ lastStatusAt: new Date(BASE + 5000) })
      .where('id', '=', local)
      .execute()
    expect(await lastStatusAt()).toBe(BASE + 5000)
    if (testDb.backend === 'sqlite') {
      // An empty string, which the driver reads as NaN, is unset too.
      await sql`update actors set "lastStatusAt" = '' where id = ${local}`.execute(
        db
      )
      expect(await lastStatusAt()).toBe(0)
    }
  })
})

describe('getAcceptedOrRequestedFollowsWithDomain', () => {
  it('returns the live follows either way between the actor and the domain, oldest first', async () => {
    const prefix = nextPrefix()
    const domain = `${prefix}.test`
    const actorId = actorIn('home.test', `${prefix}-me`)
    const following = await seedFollow({
      actorId,
      targetActorId: actorIn(domain, 'a'),
      status: Accepted,
      createdAt: BASE + 2000
    })
    const followedBy = await seedFollow({
      actorId: actorIn(domain, 'b'),
      targetActorId: actorId,
      status: Requested,
      createdAt: BASE + 1000
    })
    const third = await seedFollow({
      actorId,
      targetActorId: actorIn(domain, 'c'),
      status: Requested,
      createdAt: BASE + 3000
    })
    // Ended, another domain either way, and someone else's follow on the
    // domain.
    await seedFollow({
      actorId,
      targetActorId: actorIn(domain, 'd'),
      status: Undo,
      createdAt: BASE
    })
    await seedFollow({
      actorId: actorIn(domain, 'e'),
      targetActorId: actorId,
      status: Rejected,
      createdAt: BASE
    })
    await seedFollow({
      actorId,
      targetActorId: actorIn('other.test', `${prefix}-f`),
      status: Accepted,
      createdAt: BASE
    })
    await seedFollow({
      actorId: actorIn('other.test', `${prefix}-g`),
      targetActorId: actorId,
      status: Accepted,
      createdAt: BASE
    })
    await seedFollow({
      actorId: actorIn(domain, 'h'),
      targetActorId: actorIn('home.test', `${prefix}-you`),
      status: Accepted,
      createdAt: BASE
    })
    await seedFollow({
      actorId: actorIn('home.test', `${prefix}-you`),
      targetActorId: actorIn(domain, 'i'),
      status: Accepted,
      createdAt: BASE
    })

    const ids = async (limit: number) =>
      (
        await getAcceptedOrRequestedFollowsWithDomain(db, {
          actorId,
          domain,
          limit
        })
      ).map((follow) => follow.id)
    expect(await ids(10)).toEqual([followedBy, following, third])
    expect(await ids(2)).toEqual([followedBy, following])
  })
})

describe('getAcceptedFollowTargetActorIds', () => {
  it('returns the given targets the actor has an accepted follow of', async () => {
    const prefix = nextPrefix()
    const actorId = actorIn('a.test', `${prefix}-a`)
    const accepted = actorIn('b.test', `${prefix}-accepted`)
    const requested = actorIn('b.test', `${prefix}-requested`)
    const unasked = actorIn('b.test', `${prefix}-unasked`)
    await seedFollow({ actorId, targetActorId: accepted, status: Accepted })
    // A second accepted row for the same target (nothing in the schema stops
    // one) still gives the id once.
    await seedFollow({ actorId, targetActorId: accepted, status: Accepted })
    await seedFollow({ actorId, targetActorId: requested, status: Requested })
    await seedFollow({
      actorId: actorIn('c.test', `${prefix}-c`),
      targetActorId: unasked,
      status: Accepted
    })
    await seedFollow({
      actorId,
      targetActorId: actorIn('b.test', `${prefix}-unlisted`),
      status: Accepted
    })
    expect(
      await getAcceptedFollowTargetActorIds(db, {
        actorId,
        targetActorIds: [accepted, requested, unasked, accepted]
      })
    ).toEqual([accepted])
  })
})

describe('getFollowersInbox', () => {
  it('returns each accepted follower’s shared inbox, or its inbox, once', async () => {
    const prefix = nextPrefix()
    const target = actorIn('t.test', `${prefix}-target`)
    const shared = `https://s.test/${prefix}/inbox`
    await seedFollow({
      actorId: actorIn('s.test', `${prefix}-1`),
      targetActorId: target,
      status: Accepted,
      sharedInbox: shared
    })
    await seedFollow({
      actorId: actorIn('s.test', `${prefix}-2`),
      targetActorId: target,
      status: Accepted,
      sharedInbox: shared
    })
    const personal = actorIn('p.test', `${prefix}-3`)
    await seedFollow({
      actorId: personal,
      targetActorId: target,
      status: Accepted,
      sharedInbox: ''
    })
    await seedFollow({
      actorId: actorIn('r.test', `${prefix}-4`),
      targetActorId: target,
      status: Requested
    })
    await seedFollow({
      actorId: actorIn('o.test', `${prefix}-5`),
      targetActorId: actorIn('t.test', `${prefix}-other`),
      status: Accepted
    })
    expect(
      (await getFollowersInbox(db, { targetActorId: target })).sort()
    ).toEqual([shared, `${personal}/inbox`].sort())
  })
})

describe('updateFollowStatus', () => {
  // An owner, a member they follow (or asked to follow) on two of their
  // lists, and neighbours: the owner's list without the member, another
  // member, another owner listing the same member, and the owner's home feed.
  const setup = async (status: FollowStatus) => {
    const prefix = nextPrefix()
    const owner = actorIn('home.test', `${prefix}-owner`)
    const member = actorIn('m.test', `${prefix}-member`)
    const otherMember = actorIn('m.test', `${prefix}-other-member`)
    const otherOwner = actorIn('home.test', `${prefix}-other-owner`)
    const lists = {
      first: `${prefix}-list-1`,
      second: `${prefix}-list-2`,
      without: `${prefix}-list-3`,
      others: `${prefix}-list-4`
    }
    const followId = await seedFollow({
      actorId: owner,
      targetActorId: member,
      status
    })
    const neighbourFollowId = await seedFollow({
      actorId: owner,
      targetActorId: otherMember,
      status: Requested
    })
    await seedMembership(lists.first, owner, member)
    await seedMembership(lists.second, owner, member)
    await seedMembership(lists.first, owner, otherMember)
    await seedMembership(lists.without, owner, otherMember)
    await seedMembership(lists.others, otherOwner, member)
    const memberPost = `${member}/statuses/1`
    await seedStatus(memberPost, member, BASE + 1000)
    const otherPost = `${otherMember}/statuses/1`
    await seedStatus(otherPost, otherMember, BASE + 1000)
    return {
      prefix,
      owner,
      member,
      otherMember,
      otherOwner,
      lists,
      followId,
      neighbourFollowId,
      memberPost,
      otherPost
    }
  }

  it('counts an accepted request and backfills the member into the owner’s lists that hold it', async () => {
    const s = await setup(Requested)
    await updateFollowStatus(db, { followId: s.followId, status: Accepted })

    expect((await followRow(s.followId)).status).toBe(Accepted)
    expect((await followRow(s.followId)).updatedAt).toBeGreaterThan(BASE)
    expect(await followRow(s.neighbourFollowId)).toMatchObject({
      status: Requested,
      updatedAt: BASE
    })
    expect(await counterValue(CounterKey.totalFollowing(s.owner))).toBe(1)
    expect(await counterValue(CounterKey.totalFollowers(s.member))).toBe(1)
    expect(await timelineRowsOf(s.owner)).toEqual(
      [
        `${listTimelineKey(s.lists.first)}>${s.memberPost}`,
        `${listTimelineKey(s.lists.second)}>${s.memberPost}`
      ].sort()
    )
    expect(await timelineRowsOf(s.otherOwner)).toEqual([])
  })

  it('changes no count and backfills nothing when the status stays accepted', async () => {
    const s = await setup(Accepted)
    await updateFollowStatus(db, { followId: s.followId, status: Accepted })
    expect(
      await counterValue(CounterKey.totalFollowing(s.owner))
    ).toBeUndefined()
    expect(await timelineRowsOf(s.owner)).toEqual([])
  })

  it.each([
    { from: Accepted, to: Undo, counted: true },
    { from: Accepted, to: Rejected, counted: true },
    { from: Requested, to: Undo, counted: false },
    { from: Requested, to: Rejected, counted: false }
  ])(
    'ending a follow $from -> $to removes the member from the owner’s lists',
    async ({ from, to, counted }) => {
      const s = await setup(from)
      const now = new Date(BASE)
      if (counted) {
        for (const key of [
          CounterKey.totalFollowing(s.owner),
          CounterKey.totalFollowers(s.member)
        ]) {
          await db
            .insertInto('counters')
            .values({ id: key, value: 4, createdAt: now, updatedAt: now })
            .execute()
        }
      }
      for (const list of [s.lists.first, s.lists.second]) {
        await seedTimelineRow(
          s.owner,
          listTimelineKey(list),
          s.memberPost,
          s.member
        )
      }
      await seedTimelineRow(
        s.owner,
        listTimelineKey(s.lists.first),
        s.otherPost,
        s.otherMember
      )
      await seedTimelineRow(s.owner, 'main', s.memberPost, s.member)
      await seedTimelineRow(
        s.otherOwner,
        listTimelineKey(s.lists.others),
        s.memberPost,
        s.member
      )
      // A stale feed row of the member in the owner's list that does not hold
      // them: only the lists the member is on are purged, as before.
      await seedTimelineRow(
        s.owner,
        listTimelineKey(s.lists.without),
        s.memberPost,
        s.member
      )

      await updateFollowStatus(db, { followId: s.followId, status: to })

      expect((await followRow(s.followId)).status).toBe(to)
      expect(await counterValue(CounterKey.totalFollowing(s.owner))).toBe(
        counted ? 3 : undefined
      )
      expect(await counterValue(CounterKey.totalFollowers(s.member))).toBe(
        counted ? 3 : undefined
      )
      expect(await membershipsOf(s.owner)).toEqual(
        [
          `${s.lists.first}>${s.otherMember}`,
          `${s.lists.without}>${s.otherMember}`
        ].sort()
      )
      expect(await membershipsOf(s.otherOwner)).toEqual([
        `${s.lists.others}>${s.member}`
      ])
      expect(await timelineRowsOf(s.owner)).toEqual(
        [
          `${listTimelineKey(s.lists.first)}>${s.otherPost}`,
          `${listTimelineKey(s.lists.without)}>${s.memberPost}`,
          `main>${s.memberPost}`
        ].sort()
      )
      expect(await timelineRowsOf(s.otherOwner)).toEqual([
        `${listTimelineKey(s.lists.others)}>${s.memberPost}`
      ])
    }
  )

  it('leaves the lists alone for a late reject of an ended follow and for a self-follow', async () => {
    const s = await setup(Undo)
    await updateFollowStatus(db, { followId: s.followId, status: Rejected })
    expect(await membershipsOf(s.owner)).toHaveLength(4)

    const selfFollowId = await seedFollow({
      actorId: s.owner,
      targetActorId: s.owner,
      status: Requested
    })
    await seedMembership(s.lists.first, s.owner, s.owner)
    const ownPost = `${s.owner}/statuses/own`
    await seedStatus(ownPost, s.owner, BASE)
    await updateFollowStatus(db, { followId: selfFollowId, status: Accepted })
    expect(await timelineRowsOf(s.owner)).toEqual([])
    await updateFollowStatus(db, { followId: selfFollowId, status: Undo })
    expect(await membershipsOf(s.owner)).toContain(
      `${s.lists.first}>${s.owner}`
    )
  })

  it('does nothing for an unknown follow', async () => {
    const s = await setup(Requested)
    await updateFollowStatus(db, {
      followId: `${s.followId}-x`,
      status: Accepted
    })
    expect((await followRow(s.followId)).status).toBe(Requested)
    expect(
      await counterValue(CounterKey.totalFollowing(s.owner))
    ).toBeUndefined()
  })
})

describe('getFollowing and getFollowers', () => {
  // Accepted follows f1..f5 by one actor of five targets (and of one target
  // by five actors), with neighbours: requests, and another actor's follows.
  const setup = async () => {
    const prefix = nextPrefix()
    const actorId = actorIn('a.test', `${prefix}-a`)
    const targetActorId = actorIn('b.test', `${prefix}-b`)
    const followingIds: string[] = []
    const followerIds: string[] = []
    for (let index = 1; index <= 5; index++) {
      followingIds.push(
        await seedFollow({
          id: `${prefix}-f${index}`,
          actorId,
          targetActorId: actorIn('b.test', `${prefix}-t${index}`),
          status: Accepted
        })
      )
      followerIds.push(
        await seedFollow({
          id: `${prefix}-g${index}`,
          actorId: actorIn('c.test', `${prefix}-c${index}`),
          targetActorId,
          status: Accepted
        })
      )
    }
    await seedFollow({
      id: `${prefix}-f6`,
      actorId,
      targetActorId: actorIn('b.test', `${prefix}-t6`),
      status: Requested
    })
    await seedFollow({
      id: `${prefix}-g6`,
      actorId: actorIn('c.test', `${prefix}-c6`),
      targetActorId,
      status: Requested
    })
    await seedFollow({
      id: `${prefix}-f0`,
      actorId: actorIn('d.test', `${prefix}-d`),
      targetActorId: actorIn('b.test', `${prefix}-t1`),
      status: Accepted
    })
    await seedFollow({
      id: `${prefix}-g0`,
      actorId: actorIn('c.test', `${prefix}-c1`),
      targetActorId: actorIn('b.test', `${prefix}-other`),
      status: Accepted
    })
    return { actorId, targetActorId, followingIds, followerIds }
  }

  it.each([
    { cursor: {}, limit: 10, expected: [5, 4, 3, 2, 1] },
    { cursor: {}, limit: 2, expected: [5, 4] },
    { cursor: { maxId: 4 }, limit: 10, expected: [3, 2, 1] },
    { cursor: { maxId: 4 }, limit: 2, expected: [3, 2] },
    { cursor: { sinceId: 2 }, limit: 10, expected: [5, 4, 3] },
    { cursor: { sinceId: 2 }, limit: 2, expected: [5, 4] },
    { cursor: { minId: 2 }, limit: 2, expected: [4, 3] },
    { cursor: { minId: 2 }, limit: 10, expected: [5, 4, 3] },
    { cursor: { maxId: 5, minId: 2 }, limit: 10, expected: [4, 3] },
    { cursor: { maxId: 5, sinceId: 1 }, limit: 2, expected: [4, 3] }
  ])(
    'pages with $cursor and limit $limit',
    async ({ cursor, limit, expected }) => {
      const s = await setup()
      const pick = (ids: string[]) =>
        Object.fromEntries(
          Object.entries(cursor).map(([key, index]) => [key, ids[index - 1]])
        )
      const following = await getFollowing(db, {
        actorId: s.actorId,
        limit,
        ...pick(s.followingIds)
      })
      expect(following.map((follow) => follow.id)).toEqual(
        expected.map((index) => s.followingIds[index - 1])
      )
      const followers = await getFollowers(db, {
        targetActorId: s.targetActorId,
        limit,
        ...pick(s.followerIds)
      })
      expect(followers.map((follow) => follow.id)).toEqual(
        expected.map((index) => s.followerIds[index - 1])
      )
    }
  )
})

describe('getFollowRequests', () => {
  // Requests r1..r5 to one target, r2 and r3 at the same time; neighbours: an
  // accepted follow of the target, and a request to another target.
  const setup = async () => {
    const prefix = nextPrefix()
    const targetActorId = actorIn('t.test', `${prefix}-target`)
    const times = [BASE, BASE + 1000, BASE + 1000, BASE + 2000, BASE + 3000]
    const ids: string[] = []
    for (const [index, createdAt] of times.entries()) {
      ids.push(
        await seedFollow({
          id: `${prefix}-r${index + 1}`,
          actorId: actorIn('r.test', `${prefix}-${index + 1}`),
          targetActorId,
          status: Requested,
          createdAt
        })
      )
    }
    const acceptedId = await seedFollow({
      id: `${prefix}-r6`,
      actorId: actorIn('r.test', `${prefix}-6`),
      targetActorId,
      status: Accepted,
      createdAt: BASE + 1500
    })
    const otherTargetId = await seedFollow({
      id: `${prefix}-r7`,
      actorId: actorIn('r.test', `${prefix}-7`),
      targetActorId: actorIn('t.test', `${prefix}-other`),
      status: Requested,
      createdAt: BASE + 1500
    })
    return { targetActorId, ids, acceptedId, otherTargetId }
  }

  it.each([
    { cursor: {}, limit: 10, expected: [5, 4, 3, 2, 1] },
    { cursor: {}, limit: 2, expected: [5, 4] },
    { cursor: { maxId: 3 }, limit: 10, expected: [2, 1] },
    { cursor: { maxId: 4 }, limit: 10, expected: [3, 2, 1] },
    { cursor: { maxId: 4 }, limit: 1, expected: [3] },
    { cursor: { sinceId: 2 }, limit: 10, expected: [5, 4, 3] },
    { cursor: { sinceId: 2 }, limit: 1, expected: [5] },
    { cursor: { minId: 2 }, limit: 2, expected: [4, 3] },
    { cursor: { minId: 1 }, limit: 10, expected: [5, 4, 3, 2] }
  ])(
    'pages on (createdAt, id) with $cursor and limit $limit',
    async ({ cursor, limit, expected }) => {
      const s = await setup()
      const requests = await getFollowRequests(db, {
        targetActorId: s.targetActorId,
        limit,
        ...Object.fromEntries(
          Object.entries(cursor).map(([key, index]) => [key, s.ids[index - 1]])
        )
      })
      expect(requests.map((follow) => follow.id)).toEqual(
        expected.map((index) => s.ids[index - 1])
      )
    }
  )

  it('orders by createdAt before id', async () => {
    // Ids in the opposite order to the times.
    const prefix = nextPrefix()
    const targetActorId = actorIn('t.test', `${prefix}-target`)
    const ids: string[] = []
    for (const [index, createdAt] of [
      BASE + 2000,
      BASE + 1000,
      BASE
    ].entries()) {
      ids.push(
        await seedFollow({
          id: `${prefix}-r${index + 1}`,
          actorId: actorIn('r.test', `${prefix}-${index + 1}`),
          targetActorId,
          status: Requested,
          createdAt
        })
      )
    }
    const page = async (cursor: Record<string, string>) =>
      (
        await getFollowRequests(db, { targetActorId, limit: 10, ...cursor })
      ).map((follow) => follow.id)
    expect(await page({})).toEqual(ids)
    expect(await page({ maxId: ids[1] })).toEqual([ids[2]])
    expect(await page({ minId: ids[2] })).toEqual([ids[0], ids[1]])
  })

  it('keeps paging from a request that was accepted since, and stops on an unknown or foreign cursor', async () => {
    const s = await setup()
    expect(
      (
        await getFollowRequests(db, {
          targetActorId: s.targetActorId,
          limit: 10,
          maxId: s.acceptedId
        })
      ).map((follow) => follow.id)
    ).toEqual([s.ids[2], s.ids[1], s.ids[0]])
    expect(
      await getFollowRequests(db, {
        targetActorId: s.targetActorId,
        limit: 10,
        maxId: s.otherTargetId
      })
    ).toEqual([])
    expect(
      await getFollowRequests(db, {
        targetActorId: s.targetActorId,
        limit: 10,
        sinceId: `${s.ids[0]}-missing`
      })
    ).toEqual([])
  })

  it('pages requests without a createdAt on their id only', async () => {
    const prefix = nextPrefix()
    const targetActorId = actorIn('t.test', `${prefix}-target`)
    const nullIds: string[] = []
    for (const index of [1, 2, 3]) {
      nullIds.push(
        await seedFollow({
          id: `${prefix}-n${index}`,
          actorId: actorIn('r.test', `${prefix}-${index}`),
          targetActorId,
          status: Requested,
          createdAt: null
        })
      )
    }
    const datedId = await seedFollow({
      id: `${prefix}-n4`,
      actorId: actorIn('r.test', `${prefix}-4`),
      targetActorId,
      status: Requested,
      createdAt: BASE
    })
    const page = async (cursor: Record<string, string>) =>
      (
        await getFollowRequests(db, { targetActorId, limit: 10, ...cursor })
      ).map((follow) => follow.id)
    expect(await page({ maxId: nullIds[1] })).toEqual([nullIds[0]])
    expect(await page({ sinceId: nullIds[1] })).toEqual([nullIds[2]])
    expect(await page({ minId: nullIds[0] })).toEqual([nullIds[2], nullIds[1]])
    // A dated cursor never reaches the undated rows.
    expect(await page({ sinceId: datedId })).toEqual([])
  })
})

describe('getFollowRequestsCount', () => {
  it('counts the pending requests to the target', async () => {
    const prefix = nextPrefix()
    const targetActorId = actorIn('t.test', `${prefix}-target`)
    for (const index of [1, 2, 3]) {
      await seedFollow({
        actorId: actorIn('r.test', `${prefix}-${index}`),
        targetActorId,
        status: Requested
      })
    }
    await seedFollow({
      actorId: actorIn('r.test', `${prefix}-4`),
      targetActorId,
      status: Accepted
    })
    await seedFollow({
      actorId: actorIn('r.test', `${prefix}-5`),
      targetActorId: actorIn('t.test', `${prefix}-other`),
      status: Requested
    })
    expect(await getFollowRequestsCount(db, { targetActorId })).toBe(3)
    expect(
      await getFollowRequestsCount(db, {
        targetActorId: actorIn('t.test', `${prefix}-nobody`)
      })
    ).toBe(0)
  })
})

// Forces the next matching write on `table` to fail with a database error.
// Returns the function that removes the trigger again.
const failWrite = async (
  table: string,
  event: 'insert' | 'update' | 'delete',
  column: string,
  value: string
) => {
  const name = `follow_queries_fail_${event}_${table}`.toLowerCase()
  const record = event === 'delete' ? 'old' : 'new'
  const literal = `'${value.replaceAll("'", "''")}'`
  if (testDb.backend === 'pg') {
    await sql
      .raw(
        `create or replace function follow_queries_fail() returns trigger language plpgsql as $$ begin raise exception 'forced failure'; end $$`
      )
      .execute(db)
    await sql
      .raw(
        `create trigger ${name} before ${event} on "${table}" for each row when (${record}."${column}" = ${literal}) execute function follow_queries_fail()`
      )
      .execute(db)
    return () => sql.raw(`drop trigger ${name} on "${table}"`).execute(db)
  }
  await sql
    .raw(
      `create trigger ${name} before ${event} on "${table}" when ${record}."${column}" = ${literal} begin select raise(abort, 'forced failure'); end`
    )
    .execute(db)
  return () => sql.raw(`drop trigger ${name}`).execute(db)
}

const TABLES = [
  'follows',
  'lists',
  'list_accounts',
  'timelines',
  'counters'
] as const

const dumpTables = async () => {
  const dump: Record<string, unknown[]> = {}
  for (const table of TABLES) {
    dump[table] = await db.selectFrom(table).selectAll().orderBy('id').execute()
  }
  return dump
}

describe('transactions', () => {
  it('createFollow keeps nothing when its followers counter write fails', async () => {
    const prefix = nextPrefix()
    const actorId = actorIn('a.test', `${prefix}-a`)
    const targetActorId = actorIn('b.test', `${prefix}-b`)
    const drop = await failWrite(
      'counters',
      'insert',
      'id',
      CounterKey.totalFollowers(targetActorId)
    )
    const before = await dumpTables()
    try {
      await expect(
        createFollow(db, {
          actorId,
          targetActorId,
          status: Accepted,
          inbox: `${actorId}/inbox`,
          sharedInbox: ''
        })
      ).rejects.toThrow()
    } finally {
      await drop()
    }
    expect(await dumpTables()).toEqual(before)
  })

  it('updateFollowStatus keeps nothing when the backfill of an accepted member fails', async () => {
    const prefix = nextPrefix()
    const owner = actorIn('home.test', `${prefix}-owner`)
    const member = actorIn('m.test', `${prefix}-member`)
    const followId = await seedFollow({
      actorId: owner,
      targetActorId: member,
      status: Requested
    })
    await seedMembership(`${prefix}-list`, owner, member)
    const post = `${member}/statuses/1`
    await seedStatus(post, member, BASE)
    const drop = await failWrite('timelines', 'insert', 'statusId', post)
    const before = await dumpTables()
    try {
      await expect(
        updateFollowStatus(db, { followId, status: Accepted })
      ).rejects.toThrow()
    } finally {
      await drop()
    }
    expect(await dumpTables()).toEqual(before)
  })

  it('updateFollowStatus keeps nothing when the list feed purge of an ended follow fails', async () => {
    const prefix = nextPrefix()
    const owner = actorIn('home.test', `${prefix}-owner`)
    const member = actorIn('m.test', `${prefix}-member`)
    const followId = await createFollow(db, {
      actorId: owner,
      targetActorId: member,
      status: Accepted,
      inbox: `${owner}/inbox`,
      sharedInbox: ''
    })
    await seedMembership(`${prefix}-list`, owner, member)
    const post = `${member}/statuses/1`
    await seedStatus(post, member, BASE)
    await seedTimelineRow(
      owner,
      listTimelineKey(`${prefix}-list`),
      post,
      member
    )
    const drop = await failWrite('timelines', 'delete', 'statusId', post)
    const before = await dumpTables()
    try {
      await expect(
        updateFollowStatus(db, { followId: followId.id, status: Undo })
      ).rejects.toThrow()
    } finally {
      await drop()
    }
    expect(await dumpTables()).toEqual(before)
  })

  it('updateFollowStatus keeps nothing when the followers counter of an unfollow fails', async () => {
    const prefix = nextPrefix()
    const owner = actorIn('home.test', `${prefix}-owner`)
    const member = actorIn('m.test', `${prefix}-member`)
    const follow = await createFollow(db, {
      actorId: owner,
      targetActorId: member,
      status: Accepted,
      inbox: `${owner}/inbox`,
      sharedInbox: ''
    })
    const drop = await failWrite(
      'counters',
      'update',
      'id',
      CounterKey.totalFollowers(member)
    )
    const before = await dumpTables()
    try {
      await expect(
        updateFollowStatus(db, { followId: follow.id, status: Undo })
      ).rejects.toThrow()
    } finally {
      await drop()
    }
    expect(await dumpTables()).toEqual(before)
  })
})
