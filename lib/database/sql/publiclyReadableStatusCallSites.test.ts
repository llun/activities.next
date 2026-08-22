import { getTestDatabaseWithInstance } from '@/lib/database/testUtils'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

// Every `publicOnly` call site must actually drop a followers-only row.
//
// This is the assertion the suite was missing. `publiclyReadableStatusEquivalence`
// proves the two readability forms agree with each other, and
// `publiclyReadableStatusQueryShape` proves which form each call site is wired
// to — but neither notices if a call site stops filtering altogether. Deleting
// the `publicOnly` branch from `getStatusReplies`, `getStatusRepliesCount` or
// `getRebloggedBy` left every other test in the suite green.
//
// `getStatusRepliesCount` is the one with no backstop: the two ActivityPub route
// handlers that call `getStatusReplies({ publicOnly: true })` re-filter the
// returned array with `isStatusPubliclyReadable` before serialising, but the
// count flows straight into the replies collection's `totalItems`, so a broken
// filter there leaks how many private replies a status has to anonymous
// callers while the `items` array stays correctly filtered.
describe('publicly readable status filtering at each call site', () => {
  const { database, prepare } = getTestDatabaseWithInstance()

  const actorId = 'https://llun.test/users/callsites'
  const followers = `${actorId}/followers`
  const parentId = `${actorId}/statuses/parent`

  const publicReplyId = `${actorId}/statuses/public-reply`
  const privateReplyId = `${actorId}/statuses/private-reply`
  // `getRebloggedBy` dedupes to one row per actor, so the public and the
  // followers-only boost have to come from DIFFERENT actors — one actor's two
  // boosts collapse into a single row and the assertion could not tell a
  // working filter from a broken one.
  const boosterPublicId = 'https://llun.test/users/booster-public'
  const boosterPrivateId = 'https://llun.test/users/booster-private'
  const publicBoostId = `${boosterPublicId}/statuses/public-boost`
  const privateBoostId = `${boosterPrivateId}/statuses/private-boost`
  const publicOwnId = `${actorId}/statuses/public-own`
  const privateOwnId = `${actorId}/statuses/private-own`
  // A PUBLIC boost of the actor's own FOLLOWERS-ONLY note. This is the row that
  // separates the readability predicate from the plain "addressed to the public
  // collection" filter `getActorStatuses` falls back to for a signed-in viewer:
  // the boost itself is public, so the recipients test alone lets it through,
  // and only following the announce chain to a non-public original drops it.
  const publicBoostOfPrivateId = `${actorId}/statuses/public-boost-of-private`
  const taggedPublicId = `${actorId}/statuses/tagged-public`
  const taggedPrivateId = `${actorId}/statuses/tagged-private`

  const audience = (isPublic: boolean, followersUrl: string = followers) =>
    isPublic ? [ACTIVITY_STREAM_PUBLIC] : [followersUrl]

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await database.createActor({
      actorId,
      username: 'callsites',
      domain: 'llun.test',
      publicKey: 'publicKey-callsites',
      privateKey: 'privateKey-callsites',
      inboxUrl: `${actorId}/inbox`,
      sharedInboxUrl: 'https://llun.test/inbox',
      followersUrl: followers,
      createdAt: Date.now()
    })

    await database.createNote({
      id: parentId,
      url: parentId,
      actorId,
      text: 'parent',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })

    for (const [id, isPublic] of [
      [publicReplyId, true],
      [privateReplyId, false]
    ] as const) {
      await database.createNote({
        id,
        url: id,
        actorId,
        text: id,
        reply: parentId,
        to: audience(isPublic),
        cc: []
      })
    }

    for (const [id, isPublic] of [
      [publicOwnId, true],
      [privateOwnId, false]
    ] as const) {
      await database.createNote({
        id,
        url: id,
        actorId,
        text: id,
        to: audience(isPublic),
        cc: []
      })
    }

    for (const [id, isPublic] of [
      [taggedPublicId, true],
      [taggedPrivateId, false]
    ] as const) {
      await database.createNote({
        id,
        url: id,
        actorId,
        text: `${id} #combo`,
        to: audience(isPublic),
        cc: []
      })
      await database.createTag({
        statusId: id,
        name: '#combo',
        type: 'hashtag'
      })
    }

    await database.createAnnounce({
      id: publicBoostOfPrivateId,
      actorId,
      originalStatusId: privateOwnId,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })

    // Pin one row of each kind, including the public boost of a private note.
    // That last one is what lets the pinned case tell the readability predicate
    // apart from the plain "addressed to the public collection" fallback: it is
    // pinned AND public, so only following the announce chain drops it.
    await database.pinStatus({ actorId, statusId: publicOwnId })
    await database.pinStatus({ actorId, statusId: privateOwnId })
    await database.pinStatus({ actorId, statusId: publicBoostOfPrivateId })

    for (const [boosterId, username] of [
      [boosterPublicId, 'booster-public'],
      [boosterPrivateId, 'booster-private']
    ] as const) {
      await database.createActor({
        actorId: boosterId,
        username,
        domain: 'llun.test',
        publicKey: `publicKey-${username}`,
        privateKey: `privateKey-${username}`,
        inboxUrl: `${boosterId}/inbox`,
        sharedInboxUrl: 'https://llun.test/inbox',
        followersUrl: `${boosterId}/followers`,
        createdAt: Date.now()
      })
    }

    for (const [id, boosterId, isPublic] of [
      [publicBoostId, boosterPublicId, true],
      [privateBoostId, boosterPrivateId, false]
    ] as const) {
      await database.createAnnounce({
        id,
        actorId: boosterId,
        originalStatusId: parentId,
        to: audience(isPublic, `${boosterId}/followers`),
        cc: []
      })
    }
  })

  afterAll(async () => {
    await database.destroy()
  })

  it('drops a followers-only reply from the public replies list', async () => {
    const replies = await database.getStatusReplies({
      statusId: parentId,
      publicOnly: true
    })
    const ids = replies.map(({ id }) => id)

    expect(ids).toContain(publicReplyId)
    expect(ids).not.toContain(privateReplyId)
  })

  it('drops a followers-only reply from the public replies count', async () => {
    // Counted rather than compared to the list: this number is the ActivityPub
    // collection's `totalItems` and nothing downstream re-checks it.
    const publicCount = await database.getStatusRepliesCount({
      statusId: parentId,
      publicOnly: true
    })
    const allCount = await database.getStatusRepliesCount({
      statusId: parentId
    })

    expect(publicCount).toBe(1)
    expect(allCount).toBe(2)
  })

  it('drops a followers-only boost from the anonymous reblogged-by list', async () => {
    // No `visibleToActorId`, so this takes the public branch.
    const reblogs = await database.getRebloggedBy({ statusId: parentId })
    const actorIds = reblogs.map((account) => account.actorId)

    expect(actorIds).toContain(boosterPublicId)
    expect(actorIds).not.toContain(boosterPrivateId)
  })

  it('drops a followers-only status from the public actor status page', async () => {
    const statuses = await database.getActorStatuses({
      actorId,
      publicOnly: true
    })
    const ids = statuses.map(({ id }) => id)

    expect(ids).toContain(publicOwnId)
    expect(ids).not.toContain(privateOwnId)
    expect(ids).not.toContain(privateReplyId)
  })

  // The Mastodon accounts-statuses endpoint
  // (`app/api/v1/accounts/[id]/statuses/route.ts`) passes `publicOnly` together
  // with `excludeReblogs`, `pinned`, `tagged` and `onlyMedia` in one call, and
  // nothing exercised those combinations. They compose as independent top-level
  // `AND`s today, so none of these failed when first written — this is coverage
  // for a real argument shape, not a fix. `onlyMedia` is left out because an
  // attachment fixture needs a `medias` row whose id is a valid integer on
  // PostgreSQL, which buys no additional composition signal.
  it.each([
    { description: 'excludeReblogs', filters: { excludeReblogs: true } },
    { description: 'pinned', filters: { pinned: true } },
    { description: 'tagged', filters: { tagged: '#combo' } }
  ])(
    'still drops followers-only rows with publicOnly and $description',
    async ({ filters }) => {
      const statuses = await database.getActorStatuses({
        actorId,
        publicOnly: true,
        ...filters
      })
      const ids = statuses.map(({ id }) => id)

      expect(ids).not.toContain(privateOwnId)
      expect(ids).not.toContain(privateReplyId)
      expect(ids).not.toContain(taggedPrivateId)
      expect(ids).not.toContain(publicBoostOfPrivateId)
      // The filter itself still has to do its own job, or the assertions above
      // would pass against an empty list.
      expect(ids.length).toBeGreaterThan(0)
    }
  )

  it('drops a public boost of a followers-only note from the public actor status page', async () => {
    // The recipients-only fallback would return this row: the boost is
    // addressed to the public collection. Only following the announce chain to
    // a non-public original excludes it, so this is the case that distinguishes
    // the readability predicate from that fallback — the sibling test above,
    // with a plainly private note, passes under that fallback too.
    //
    // Both `getActorStatuses` cases in this file are already covered in
    // `status.test.ts` — this one by 'excludes nested announces when the
    // boosted original is not publicly readable', the sibling above by 'counts
    // only publicly readable actor statuses when requested'. Unlike the three
    // reply/reblog cases, they are not filling a gap. They stay so that all
    // four `publicOnly` call sites state the same invariant in one place,
    // rather than sending a reader to another file to confirm this one.
    const statuses = await database.getActorStatuses({
      actorId,
      publicOnly: true
    })

    expect(statuses.map(({ id }) => id)).not.toContain(publicBoostOfPrivateId)
  })
})
