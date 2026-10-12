import { actorVisibleStatusIds } from '@/lib/database/kysely/visibility/actorVisible'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
} from '@/lib/utils/activitystream'

// The status ids actorVisibleStatusIds selects, over one set of rows, for
// every combination of the audience flags, with each subquery used as the
// media and fitness file reads use it (`status id in (…)`); the named cases say
// which arm decides a row. The expected sets are the ones its Knex original
// selected over the same rows when this suite compared the two.
describe('actorVisibleStatusIds', () => {
  const testDb = createTestDatabase()
  const { database, db } = testDb

  const DOMAIN = 'visible.test'
  const actor = (name: string, domain = DOMAIN) =>
    `https://${domain}/users/${name}`
  const author = actor('author')
  // Writes the statuses the author's boosts point at.
  const other = actor('other')
  const viewer = actor('viewer')
  const stranger = actor('stranger')
  // Has no statuses at all.
  const ghost = actor('ghost', 'gone.test')
  const storedFollowers = `https://${DOMAIN}/collections/author-followers`

  const ids: Record<string, string> = {}
  const keyOf = (id: string | null) =>
    Object.keys(ids).find((key) => ids[key] === id) ?? String(id)
  const statusId = (actorId: string, key: string) =>
    `${actorId}/statuses/${key}`

  const note = async (
    key: string,
    {
      actorId = author,
      to,
      cc = []
    }: { actorId?: string; to: string[]; cc?: string[] }
  ) => {
    const id = statusId(actorId, key)
    await database.createNote({ id, url: id, actorId, text: key, to, cc })
    ids[key] = id
    return id
  }

  const announce = async (
    key: string,
    originalStatusId: string,
    { actorId = author, to }: { actorId?: string; to: string[] }
  ) => {
    const id = statusId(actorId, key)
    await database.createAnnounce({ id, actorId, originalStatusId, to, cc: [] })
    ids[key] = id
    return id
  }

  const setPointers = (
    key: string,
    pointers: { originalStatusId?: string | null; content?: string }
  ) =>
    db
      .updateTable('statuses')
      .set(pointers)
      .where('id', '=', ids[key])
      .execute()

  type Audience = {
    publicOnly?: boolean
    visibleToActorId?: string | null
    includeFollowersOnly?: boolean
    followersAudience?: string | null
  }

  // Each subquery as the reads use it: the statuses whose id it selects.
  const selectedBy = async (actorId: string, audience: Audience) => {
    const subquery = actorVisibleStatusIds(db, actorId, audience)
    if (!subquery) return null
    const rows = await db
      .selectFrom('statuses')
      .select('statuses.id')
      .where('statuses.id', 'in', subquery)
      .execute()
    return rows.map(({ id }) => keyOf(id)).sort()
  }

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()

    for (const id of [author, other, viewer, stranger]) {
      const [, , domain, , username] = id.split('/')
      await database.createActor({
        actorId: id,
        username,
        domain,
        publicKey: `public-${username}`,
        privateKey: `private-${username}`,
        inboxUrl: `${id}/inbox`,
        sharedInboxUrl: `https://${domain}/inbox`,
        followersUrl: id === author ? storedFollowers : `${id}/followers`,
        createdAt: Date.now()
      })
    }

    // The author's own posts, one per audience.
    await note('public', { to: [ACTIVITY_STREAM_PUBLIC] })
    await note('public-compact', { to: [ACTIVITY_STREAM_PUBLIC_COMPACT] })
    await note('unlisted', {
      to: [`${author}/followers`],
      cc: [ACTIVITY_STREAM_PUBLIC]
    })
    await note('followers-fallback', { to: [`${author}/followers`] })
    await note('followers-stored', { to: [storedFollowers] })
    await note('direct', { to: [viewer] })
    await note('direct-cc', { to: [stranger], cc: [viewer] })
    await note('list', { to: [`https://${DOMAIN}/lists/runners`] })
    await note('no-recipients', { to: [] })

    // Another actor's posts: boost targets, and rows outside the author's
    // statuses that the recipient arm still selects.
    await note('other-public', { actorId: other, to: [ACTIVITY_STREAM_PUBLIC] })
    await note('other-private', { actorId: other, to: [`${other}/followers`] })
    await note('other-direct', { actorId: other, to: [viewer] })
    await note('other-followers-of-author', {
      actorId: other,
      to: [`${author}/followers`]
    })

    // The author's boosts.
    await announce('boost-public', ids['other-public'], {
      to: [ACTIVITY_STREAM_PUBLIC]
    })
    await announce('boost-private', ids['other-private'], {
      to: [ACTIVITY_STREAM_PUBLIC]
    })
    // Followers-only itself, of a public note.
    await announce('private-boost', ids['other-public'], {
      to: [`${author}/followers`]
    })
    // The other actor's public boost of a public note, boosted again by the
    // author: depth 2.
    await announce('other-boost', ids['other-public'], {
      actorId: other,
      to: [ACTIVITY_STREAM_PUBLIC]
    })
    await announce('boost-of-boost', ids['other-boost'], {
      to: [ACTIVITY_STREAM_PUBLIC]
    })
    // Depth 2 through a hop that is not public.
    await announce('other-private-boost', ids['other-public'], {
      actorId: other,
      to: [`${other}/followers`]
    })
    await announce('boost-of-private-boost', ids['other-private-boost'], {
      to: [ACTIVITY_STREAM_PUBLIC]
    })
    // Legacy: the boosted id only in `content`.
    await announce('legacy-boost', ids['other-public'], {
      to: [ACTIVITY_STREAM_PUBLIC]
    })
    await setPointers('legacy-boost', {
      originalStatusId: null,
      content: ids['other-public']
    })
    // The two pointers disagree: `originalStatusId` wins.
    await announce('disagreeing-boost', ids['other-public'], {
      to: [ACTIVITY_STREAM_PUBLIC]
    })
    await setPointers('disagreeing-boost', { content: ids['other-private'] })
    await announce('reverse-disagreeing-boost', ids['other-private'], {
      to: [ACTIVITY_STREAM_PUBLIC]
    })
    await setPointers('reverse-disagreeing-boost', {
      content: ids['other-public']
    })
    // A cycle, a boost of itself and a boost of a missing row.
    await announce('cycle-a', ids['other-public'], {
      to: [ACTIVITY_STREAM_PUBLIC]
    })
    await announce('cycle-b', ids['cycle-a'], { to: [ACTIVITY_STREAM_PUBLIC] })
    await setPointers('cycle-a', {
      originalStatusId: ids['cycle-b'],
      content: ids['cycle-b']
    })
    await announce('self-boost', ids['other-public'], {
      to: [ACTIVITY_STREAM_PUBLIC]
    })
    await setPointers('self-boost', {
      originalStatusId: ids['self-boost'],
      content: ids['self-boost']
    })
    await announce('dangling-boost', ids['other-public'], {
      to: [ACTIVITY_STREAM_PUBLIC]
    })
    await setPointers('dangling-boost', {
      originalStatusId: statusId(other, 'gone'),
      content: statusId(other, 'gone')
    })
    // An Announce whose pointer names a public Note but whose type is not
    // Announce: a Note never follows a pointer.
    await note('note-with-pointer', { to: [ACTIVITY_STREAM_PUBLIC] })
    await setPointers('note-with-pointer', {
      originalStatusId: ids['other-private']
    })
  })

  afterAll(async () => {
    await database.destroy()
  })

  const optionalStrings = (values: string[]) => [undefined, null, '', ...values]
  const audiences: Audience[] = []
  for (const publicOnly of [undefined, false, true]) {
    for (const visibleToActorId of optionalStrings([
      viewer,
      stranger,
      author
    ])) {
      for (const includeFollowersOnly of [undefined, false, true]) {
        for (const followersAudience of optionalStrings([
          storedFollowers,
          `${author}/followers`,
          'https://elsewhere.test/followers'
        ])) {
          audiences.push({
            publicOnly,
            visibleToActorId,
            includeFollowersOnly,
            followersAudience
          })
        }
      }
    }
  }

  // Every status addressed to the public collection, in either spelling.
  const PUBLICLY_ADDRESSED = [
    'boost-of-boost',
    'boost-of-private-boost',
    'boost-private',
    'boost-public',
    'cycle-a',
    'cycle-b',
    'dangling-boost',
    'disagreeing-boost',
    'legacy-boost',
    'note-with-pointer',
    'other-boost',
    'other-public',
    'public',
    'public-compact',
    'reverse-disagreeing-boost',
    'self-boost',
    'unlisted'
  ]
  // The statuses addressed to each other recipient the audiences name.
  const addressedTo: Record<string, string[]> = {
    [viewer]: ['direct', 'direct-cc', 'other-direct'],
    [stranger]: ['direct-cc'],
    [`${author}/followers`]: [
      'followers-fallback',
      'other-followers-of-author',
      'private-boost',
      'unlisted'
    ],
    [storedFollowers]: ['followers-stored'],
    [`${other}/followers`]: ['other-private', 'other-private-boost']
  }
  // Each actor's own statuses that anyone may read, boosts only when their
  // whole chain is public.
  const publiclyReadableOf: Record<string, string[]> = {
    [author]: [
      'boost-of-boost',
      'boost-public',
      'disagreeing-boost',
      'legacy-boost',
      'note-with-pointer',
      'public',
      'public-compact',
      'unlisted'
    ],
    [other]: ['other-boost', 'other-public'],
    [ghost]: []
  }
  // No flag: no filter. publicOnly: the actor's publicly readable statuses.
  // Otherwise every status addressed to the public collection, to the viewer,
  // or with includeFollowersOnly to followersAudience and the actor's
  // `<id>/followers`.
  const expectedFor = (
    actorId: string,
    {
      publicOnly,
      visibleToActorId,
      includeFollowersOnly,
      followersAudience
    }: Audience
  ) => {
    if (!publicOnly && !visibleToActorId && !includeFollowersOnly) return null
    if (publicOnly) return [...publiclyReadableOf[actorId]].sort()
    const recipients = [
      visibleToActorId,
      ...(includeFollowersOnly
        ? [followersAudience, `${actorId}/followers`]
        : [])
    ]
    return [
      ...new Set([
        ...PUBLICLY_ADDRESSED,
        ...recipients.flatMap((recipient) =>
          recipient ? (addressedTo[recipient] ?? []) : []
        )
      ])
    ].sort()
  }

  it.each([
    { name: 'author', actorId: author },
    { name: 'other', actorId: other },
    { name: 'ghost', actorId: ghost }
  ])(
    'selects exactly the expected statuses for every audience of $name',
    async ({ actorId }) => {
      let filtered = 0
      for (const audience of audiences) {
        const expected = expectedFor(actorId, audience)
        expect({ audience, ids: await selectedBy(actorId, audience) }).toEqual({
          audience,
          ids: expected
        })
        if (expected) filtered += 1
      }
      // Both the unfiltered and the filtered answers were checked.
      expect(filtered).toBeGreaterThan(0)
      expect(filtered).toBeLessThan(audiences.length)
    }
  )

  it.each([
    { description: 'no flags', audience: {} },
    {
      description: 'falsy flags',
      audience: {
        publicOnly: false,
        visibleToActorId: '',
        includeFollowersOnly: false,
        followersAudience: storedFollowers
      }
    }
  ])('is unfiltered for $description', ({ audience }) => {
    expect(actorVisibleStatusIds(testDb.db, author, audience)).toBeNull()
  })

  const publicOnly = { publicOnly: true }
  const viewerAudience = { visibleToActorId: viewer }
  const followers = {
    includeFollowersOnly: true,
    followersAudience: storedFollowers
  }
  it.each([
    { key: 'public', audience: publicOnly, selected: true },
    { key: 'public-compact', audience: publicOnly, selected: true },
    { key: 'unlisted', audience: publicOnly, selected: true },
    { key: 'followers-fallback', audience: publicOnly, selected: false },
    { key: 'direct', audience: publicOnly, selected: false },
    { key: 'no-recipients', audience: publicOnly, selected: false },
    // Only the author's statuses are publicOnly targets.
    { key: 'other-public', audience: publicOnly, selected: false },
    { key: 'boost-public', audience: publicOnly, selected: true },
    { key: 'boost-private', audience: publicOnly, selected: false },
    { key: 'private-boost', audience: publicOnly, selected: false },
    { key: 'boost-of-boost', audience: publicOnly, selected: true },
    { key: 'boost-of-private-boost', audience: publicOnly, selected: false },
    { key: 'legacy-boost', audience: publicOnly, selected: true },
    { key: 'disagreeing-boost', audience: publicOnly, selected: true },
    { key: 'reverse-disagreeing-boost', audience: publicOnly, selected: false },
    { key: 'cycle-a', audience: publicOnly, selected: false },
    { key: 'self-boost', audience: publicOnly, selected: false },
    { key: 'dangling-boost', audience: publicOnly, selected: false },
    { key: 'note-with-pointer', audience: publicOnly, selected: true },
    // publicOnly wins over the other flags.
    {
      key: 'direct',
      audience: { ...publicOnly, ...viewerAudience, ...followers },
      selected: false
    },
    { key: 'public', audience: viewerAudience, selected: true },
    { key: 'unlisted', audience: viewerAudience, selected: true },
    { key: 'direct', audience: viewerAudience, selected: true },
    { key: 'direct-cc', audience: viewerAudience, selected: true },
    {
      key: 'direct',
      audience: { visibleToActorId: stranger },
      selected: false
    },
    { key: 'followers-fallback', audience: viewerAudience, selected: false },
    // The recipient arm is not limited to the actor's statuses.
    { key: 'other-direct', audience: viewerAudience, selected: true },
    { key: 'other-public', audience: viewerAudience, selected: true },
    // Without publicOnly a boost is selected by its own recipients only.
    { key: 'boost-private', audience: viewerAudience, selected: true },
    { key: 'cycle-a', audience: viewerAudience, selected: true },
    { key: 'followers-stored', audience: followers, selected: true },
    { key: 'followers-fallback', audience: followers, selected: true },
    {
      key: 'followers-fallback',
      audience: { includeFollowersOnly: true },
      selected: true
    },
    {
      key: 'followers-stored',
      audience: { includeFollowersOnly: true },
      selected: false
    },
    {
      key: 'followers-stored',
      audience: { followersAudience: storedFollowers, ...viewerAudience },
      selected: false
    },
    { key: 'other-followers-of-author', audience: followers, selected: true },
    { key: 'list', audience: followers, selected: false },
    { key: 'direct', audience: followers, selected: false }
  ])(
    'selects $key as $selected for $audience',
    async ({ key, audience, selected }) => {
      expect(ids[key]).toBeDefined()
      expect((await selectedBy(author, audience))?.includes(key)).toBe(selected)
    }
  )
})
