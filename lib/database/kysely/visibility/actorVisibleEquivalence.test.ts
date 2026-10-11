import { actorVisibleStatusIds } from '@/lib/database/kysely/visibility/actorVisible'
import { buildActorVisibleStatusIdsQuery } from '@/lib/database/sql/status'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
} from '@/lib/utils/activitystream'

// The Kysely actorVisibleStatusIds must select exactly the status ids its Knex
// original buildActorVisibleStatusIdsQuery selects while both are in use: the
// Knex one still serves the gallery and status mixins. Both run over the same
// rows, for every combination of the audience flags, with each subquery used
// as the media and fitness file reads use it (`status id in (…)`), and the id
// sets are compared; the named cases say which arm broke.
describe('actorVisibleStatusIds matches buildActorVisibleStatusIdsQuery', () => {
  const testDb = createTestDatabase()
  const { database, knex } = testDb

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
  ) => knex('statuses').where('id', ids[key]).update(pointers)

  type Audience = {
    publicOnly?: boolean
    visibleToActorId?: string | null
    includeFollowersOnly?: boolean
    followersAudience?: string | null
  }

  // Each subquery as the reads use it: the statuses whose id it selects.
  const selectedByKnex = async (actorId: string, audience: Audience) => {
    const subquery = buildActorVisibleStatusIdsQuery({
      database: knex,
      actorId,
      ...audience
    })
    if (!subquery) return null
    const rows: { id: string }[] = await knex('statuses')
      .select('statuses.id')
      .whereIn('statuses.id', subquery)
    return rows.map(({ id }) => id).sort()
  }

  const selectedByKysely = async (actorId: string, audience: Audience) => {
    const db = testDb.db
    const subquery = actorVisibleStatusIds(db, actorId, audience)
    if (!subquery) return null
    const rows = await db
      .selectFrom('statuses')
      .select('statuses.id')
      .where('statuses.id', 'in', subquery)
      .execute()
    return rows.map(({ id }) => id).sort()
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

  it.each([
    { name: 'author', actorId: author },
    { name: 'other', actorId: other },
    { name: 'ghost', actorId: ghost }
  ])(
    'selects the same statuses as the Knex builder for every audience of $name',
    async ({ actorId }) => {
      let filtered = 0
      for (const audience of audiences) {
        const [knexIds, kyselyIds] = await Promise.all([
          selectedByKnex(actorId, audience),
          selectedByKysely(actorId, audience)
        ])
        expect({ audience, ids: kyselyIds }).toEqual({
          audience,
          ids: knexIds
        })
        if (knexIds) filtered += 1
      }
      // Both the unfiltered and the filtered answers were compared.
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
    expect(
      buildActorVisibleStatusIdsQuery({
        database: knex,
        actorId: author,
        ...audience
      })
    ).toBeNull()
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
    'agrees that $key is selected=$selected for $audience',
    async ({ key, audience, selected }) => {
      const id = ids[key]
      expect(id).toBeDefined()
      const [knexIds, kyselyIds] = await Promise.all([
        selectedByKnex(author, audience),
        selectedByKysely(author, audience)
      ])
      expect(knexIds?.includes(id)).toBe(selected)
      expect(kyselyIds?.includes(id)).toBe(selected)
    }
  )
})
