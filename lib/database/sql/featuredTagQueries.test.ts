import {
  createSearchActor,
  seedStatus,
  seedTag
} from '@/lib/database/sql/searchTestHelpers'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
} from '@/lib/utils/activitystream'

const DOMAIN = 'fq.test'
const PUBLIC = ACTIVITY_STREAM_PUBLIC
const actorIdOf = (username: string) => `https://${DOMAIN}/users/${username}`

describe('featured tag queries', () => {
  const testDb = createTestDatabase()
  const { database, db } = testDb

  const addActor = async (username: string) => {
    const id = actorIdOf(username)
    await createSearchActor(database, { id, username, domain: DOMAIN })
    return id
  }

  let statusCount = 0
  // A status by actorId with the given tags, each in its default `#name`
  // stored form unless given as [name, nameNormalized, type?].
  const tagged = async (
    actorId: string,
    createdAt: number,
    tags: (string | [string, string, string?])[],
    status: { type?: string; to?: string[]; cc?: string[] } = { to: [PUBLIC] }
  ) => {
    statusCount += 1
    const statusId = await seedStatus(db, {
      id: `${actorId}/statuses/${statusCount}`,
      actorId,
      createdAt,
      ...status
    })
    for (const tag of tags) {
      if (typeof tag === 'string') {
        await seedTag(db, { statusId, name: tag })
      } else {
        const [name, nameNormalized, type] = tag
        await seedTag(db, { statusId, name, nameNormalized, type })
      }
    }
    return statusId
  }

  const feature = (
    actorId: string,
    id: string,
    name: string,
    createdAt: number
  ) =>
    db
      .insertInto('featured_tags')
      .values({
        id,
        actorId,
        name,
        nameNormalized: name.toLowerCase(),
        createdAt: new Date(createdAt)
      })
      .execute()

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
  })

  afterAll(async () => {
    await database.destroy()
  })

  it('derives stats from the actor own public Notes and Polls in either stored form', async () => {
    const owner = await addActor('fqstats')
    const other = await addActor('fqstats-other')
    // Counted: a public Note, a Poll with the public collection in cc and
    // the bare stored form, and a Note to the compact public id carrying both
    // forms.
    await tagged(owner, 10, ['#fqrun'])
    await tagged(owner, 30, [['fqrun', 'fqrun']], {
      type: 'Poll',
      cc: [PUBLIC]
    })
    await tagged(owner, 20, ['#fqrun', ['fqrun', 'fqrun']], {
      to: [ACTIVITY_STREAM_PUBLIC_COMPACT]
    })
    // Not counted, all newer: an Announce, a followers-only Note, a Note with
    // no recipients, a mention carrying the name, another author's Note, and
    // a spelling that only folds to the name.
    await tagged(owner, 50, ['#fqrun'], { type: 'Announce', to: [PUBLIC] })
    await tagged(owner, 60, ['#fqrun'], { to: [`${owner}/followers`] })
    await tagged(owner, 70, ['#fqrun'], {})
    await tagged(owner, 80, [['#fqrun', '#fqrun', 'mention']])
    await tagged(other, 90, ['#fqrun'])
    await tagged(owner, 100, [['# fqfold', '# fqfold']])

    const created = await database.createFeaturedTag({
      actorId: owner,
      name: '#FQRun'
    })
    expect(created).toMatchObject({
      actorId: owner,
      name: 'FQRun',
      statusesCount: 3,
      lastStatusAt: 30
    })
    await expect(
      database.getFeaturedTagByName({ actorId: owner, name: 'fqrun' })
    ).resolves.toEqual(created)

    await expect(
      database.createFeaturedTag({ actorId: owner, name: 'fqfold' })
    ).resolves.toMatchObject({ statusesCount: 0, lastStatusAt: null })
    await expect(
      database.getFeaturedTags({ actorId: owner })
    ).resolves.toMatchObject([
      { name: 'FQRun', statusesCount: 3, lastStatusAt: 30 },
      { name: 'fqfold', statusesCount: 0, lastStatusAt: null }
    ])
  })

  it('lists one actor featured tags by statuses_count, then newest, then id', async () => {
    const owner = await addActor('fqlist')
    const other = await addActor('fqlist-other')
    await feature(other, 'fqlist-x', 'fqlistx', 9000)
    await feature(owner, 'fqlist-1', 'fqlist1', 1000)
    await feature(owner, 'fqlist-2', 'fqlist2', 2000)
    await feature(owner, 'fqlist-3', 'fqlist3', 3000)
    await feature(owner, 'fqlist-4', 'fqlist4', 4000)
    await feature(owner, 'fqlist-5b', 'fqlist5b', 5000)
    await feature(owner, 'fqlist-5a', 'fqlist5a', 5000)
    await tagged(owner, 10, ['#fqlist3'])
    await tagged(owner, 20, ['#fqlist3'])
    await tagged(owner, 30, ['#fqlist4'])

    const tags = await database.getFeaturedTags({ actorId: owner })
    expect(tags.map((tag) => [tag.id, tag.statusesCount])).toEqual([
      ['fqlist-3', 2],
      ['fqlist-4', 1],
      ['fqlist-5b', 0],
      ['fqlist-5a', 0],
      ['fqlist-2', 0],
      ['fqlist-1', 0]
    ])
    expect(tags[0]).toEqual({
      id: 'fqlist-3',
      actorId: owner,
      name: 'fqlist3',
      createdAt: 3000,
      statusesCount: 2,
      lastStatusAt: 20
    })
    await expect(database.countFeaturedTags({ actorId: owner })).resolves.toBe(
      6
    )
    await expect(database.countFeaturedTags({ actorId: other })).resolves.toBe(
      1
    )
    await expect(
      database.countFeaturedTags({ actorId: actorIdOf('fqlist-nobody') })
    ).resolves.toBe(0)
  })

  it('finds a featured tag by its normalized name for that actor only', async () => {
    const owner = await addActor('fqname')
    const other = await addActor('fqname-other')
    await feature(other, 'fqname-other', 'FQName', 1000)
    await feature(owner, 'fqname-decoy', 'fqdecoy', 1000)
    await feature(owner, 'fqname-own', 'FQName', 2000)

    await expect(
      database.getFeaturedTagByName({ actorId: owner, name: '  ##FQNAME ' })
    ).resolves.toMatchObject({ id: 'fqname-own', name: 'FQName' })
    await expect(
      database.getFeaturedTagByName({ actorId: owner, name: 'fqmissing' })
    ).resolves.toBeNull()
  })

  it('creates one featured tag per actor and name, returning the existing one on a repeat', async () => {
    const owner = await addActor('fqcreate')
    const other = await addActor('fqcreate-other')

    const first = await database.createFeaturedTag({
      actorId: owner,
      name: '  ##FQCreate '
    })
    expect(first).toMatchObject({ actorId: owner, name: 'FQCreate' })
    await expect(
      database.createFeaturedTag({ actorId: owner, name: '#fqcreate' })
    ).resolves.toEqual(first)
    const otherTag = await database.createFeaturedTag({
      actorId: other,
      name: 'fqcreate'
    })
    expect(otherTag.id).not.toBe(first.id)
    await expect(database.countFeaturedTags({ actorId: owner })).resolves.toBe(
      1
    )

    // A name with nothing left after the `#` has no stored spellings.
    await expect(
      database.createFeaturedTag({ actorId: owner, name: '#' })
    ).resolves.toMatchObject({ name: '', statusesCount: 0 })
    await expect(
      database.getFeaturedTags({ actorId: owner })
    ).resolves.toHaveLength(2)
  })

  it('deletes only the owner row with that id', async () => {
    const owner = await addActor('fqdelete')
    const other = await addActor('fqdelete-other')
    await feature(owner, 'fqdelete-a', 'fqdeletea', 1000)
    await feature(owner, 'fqdelete-b', 'fqdeleteb', 2000)
    await feature(other, 'fqdelete-c', 'fqdeletec', 3000)

    await expect(
      database.deleteFeaturedTag({ actorId: other, id: 'fqdelete-a' })
    ).resolves.toBeNull()
    await expect(
      database.deleteFeaturedTag({ actorId: owner, id: 'fqdelete-missing' })
    ).resolves.toBeNull()
    await expect(
      database.deleteFeaturedTag({ actorId: owner, id: 'fqdelete-a' })
    ).resolves.toEqual({
      id: 'fqdelete-a',
      actorId: owner,
      name: 'fqdeletea',
      createdAt: 1000
    })

    const remaining = await db
      .selectFrom('featured_tags')
      .select('id')
      .where('id', 'like', 'fqdelete-%')
      .execute()
    expect(remaining.map((row) => row.id).sort()).toEqual([
      'fqdelete-b',
      'fqdelete-c'
    ])
  })

  it('suggests the actor most used public hashtags that are not featured', async () => {
    const owner = await addActor('fqsuggest')
    const other = await addActor('fqsuggest-other')
    // fqa: 3 uses (last 30); fqc: 2 (last 50); fqb: 2 (last 40); fqd: 1
    // (60); fqe: 1 (55). On equal counts the newer comes first, whichever way
    // the names sort.
    await tagged(owner, 10, ['#fqa'])
    await tagged(owner, 20, ['#fqa', '#fqb'])
    await tagged(owner, 30, ['#fqa', '#fqc'])
    await tagged(owner, 40, ['#fqb'])
    await tagged(owner, 50, ['#fqc'])
    await tagged(owner, 55, ['#fqe'])
    await tagged(owner, 60, ['#fqd'])
    // Featured by the owner (one through a bare stored row) or used only in
    // private, by others, or in a mention.
    for (const createdAt of [1, 2, 3, 4, 5]) {
      await tagged(owner, createdAt, ['#fqfeatured', ['fqbare', 'fqbare']])
    }
    for (const createdAt of [6, 7, 8, 9]) {
      await tagged(owner, createdAt, ['#fqprivate'], {
        to: [`${owner}/followers`]
      })
      await tagged(other, createdAt, ['#fqothers'])
      await tagged(owner, createdAt, [['#fqmention', '#fqmention', 'mention']])
    }
    await feature(owner, 'fqsuggest-featured', 'FQFeatured', 1000)
    await feature(owner, 'fqsuggest-bare', 'fqbare', 1000)
    // Another actor featuring fqa does not hide it.
    await feature(other, 'fqsuggest-other-a', 'fqa', 1000)

    const expected = [
      { name: 'fqa', statusesCount: 3, lastStatusAt: 30 },
      { name: 'fqc', statusesCount: 2, lastStatusAt: 50 },
      { name: 'fqb', statusesCount: 2, lastStatusAt: 40 },
      { name: 'fqd', statusesCount: 1, lastStatusAt: 60 },
      { name: 'fqe', statusesCount: 1, lastStatusAt: 55 }
    ]
    await expect(
      database.getFeaturedTagSuggestions({ actorId: owner, limit: 3 })
    ).resolves.toEqual(expected.slice(0, 3))
    await expect(
      database.getFeaturedTagSuggestions({ actorId: owner })
    ).resolves.toEqual(expected)
  })
})
