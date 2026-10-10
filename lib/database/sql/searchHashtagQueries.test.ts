import {
  createSearchActor,
  readSearchDocument,
  seedStatus,
  seedTag
} from '@/lib/database/sql/searchTestHelpers'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
} from '@/lib/utils/activitystream'

const AUTHOR = 'https://hq.test/users/author'
const PUBLIC = ACTIVITY_STREAM_PUBLIC

const statusIdOf = (slug: string) => `${AUTHOR}/statuses/${slug}`

// A Note addressed to the public collection, with hashtags in their default
// `#name` stored form.
const seedPublicNote = async (
  db: ReturnType<typeof createTestDatabase>['db'],
  slug: string,
  createdAt: number,
  hashtags: string[]
) => {
  const statusId = await seedStatus(db, {
    id: statusIdOf(slug),
    actorId: AUTHOR,
    createdAt,
    to: [PUBLIC]
  })
  for (const name of hashtags) await seedTag(db, { statusId, name })
  return statusId
}

describe('hashtag search queries', () => {
  const testDb = createTestDatabase()
  const { database, db } = testDb

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
    await createSearchActor(database, { id: AUTHOR, username: 'author' })
  })

  afterAll(async () => {
    await database.destroy()
  })

  describe('indexHashtagSearchDocument', () => {
    it('counts public Notes and Polls carrying the tag in either stored form, once per status', async () => {
      // Counted: a Note to the public collection, a Poll with the public
      // collection in cc and the bare legacy form, a Note to the compact
      // public id, and a Note carrying both stored forms.
      await seedPublicNote(db, 'count-note', 10, ['#hqcount'])
      const pollId = await seedStatus(db, {
        id: statusIdOf('count-poll'),
        actorId: AUTHOR,
        type: 'Poll',
        createdAt: 30,
        cc: [PUBLIC]
      })
      await seedTag(db, {
        statusId: pollId,
        name: 'hqcount',
        nameNormalized: 'hqcount'
      })
      const compactId = await seedStatus(db, {
        id: statusIdOf('count-compact'),
        actorId: AUTHOR,
        createdAt: 20,
        to: [ACTIVITY_STREAM_PUBLIC_COMPACT]
      })
      await seedTag(db, { statusId: compactId, name: '#hqcount' })
      const bothId = await seedPublicNote(db, 'count-both', 5, ['#hqcount'])
      await seedTag(db, {
        statusId: bothId,
        name: 'hqcount',
        nameNormalized: 'hqcount'
      })

      // Not counted, all newer than the counted rows: an Announce, a
      // followers-only Note, a Note with no recipients, a mention tag that
      // carries the name, and another tag on a public Note.
      const announceId = await seedStatus(db, {
        id: statusIdOf('count-announce'),
        actorId: AUTHOR,
        type: 'Announce',
        createdAt: 90,
        to: [PUBLIC]
      })
      await seedTag(db, { statusId: announceId, name: '#hqcount' })
      const privateId = await seedStatus(db, {
        id: statusIdOf('count-private'),
        actorId: AUTHOR,
        createdAt: 91,
        to: [`${AUTHOR}/followers`]
      })
      await seedTag(db, { statusId: privateId, name: '#hqcount' })
      const directId = await seedStatus(db, {
        id: statusIdOf('count-direct'),
        actorId: AUTHOR,
        createdAt: 92
      })
      await seedTag(db, { statusId: directId, name: '#hqcount' })
      const mentionId = await seedPublicNote(db, 'count-mention', 93, [])
      await seedTag(db, {
        statusId: mentionId,
        name: '#hqcount',
        type: 'mention',
        nameNormalized: '#hqcount'
      })
      await seedPublicNote(db, 'count-other', 94, ['#hqcountother'])

      await database.indexHashtagSearchDocument({ hashtag: '#HQCount' })

      expect(await readSearchDocument(db, 'hashtag', 'hqcount')).toMatchObject({
        id: 'hashtag:hqcount',
        documentText: 'hqcount #hqcount',
        postCount: 4,
        lastPostAt: 30,
        actorId: null,
        visibility: null,
        entityCreatedAt: null
      })
    })

    it('looks up only the stored spellings of the requested name', async () => {
      // `# hqfold` folds to `hqfold` in SQL but is not a stored spelling of it.
      const foldId = await seedPublicNote(db, 'fold', 10, [])
      await seedTag(db, {
        statusId: foldId,
        name: '# hqfold',
        nameNormalized: '# hqfold'
      })
      await database.indexHashtagSearchDocument({ hashtag: 'hqfold' })
      expect(await readSearchDocument(db, 'hashtag', 'hqfold')).toBeUndefined()

      // Asking for `# hqspace` asks for ` hqspace`, which has no uses; the
      // `hqspace` tag it looks up is not what was asked for.
      await seedPublicNote(db, 'space', 10, ['#hqspace'])
      await database.indexHashtagSearchDocument({ hashtag: '# hqspace' })
      expect(await readSearchDocument(db, 'hashtag', 'hqspace')).toBeUndefined()
      expect(
        await readSearchDocument(db, 'hashtag', ' hqspace')
      ).toBeUndefined()
    })

    it('rewrites text, counts and updatedAt of an existing document but keeps createdAt', async () => {
      await seedPublicNote(db, 'refresh', 40, ['#hqrefresh'])
      await database.upsertSearchDocument({
        entityType: 'hashtag',
        entityId: 'hqrefresh',
        documentText: 'stale',
        postCount: 99,
        lastPostAt: 1
      })
      await db
        .updateTable('search_documents')
        .set({ createdAt: new Date(1000), updatedAt: new Date(1000) })
        .where('id', '=', 'hashtag:hqrefresh')
        .execute()

      await database.indexHashtagSearchDocument({ hashtag: 'hqrefresh' })
      await database.indexHashtagSearchDocument({ hashtag: 'hqrefresh' })

      const document = await readSearchDocument(db, 'hashtag', 'hqrefresh')
      expect(document).toMatchObject({
        documentText: 'hqrefresh #hqrefresh',
        postCount: 1,
        lastPostAt: 40,
        createdAt: 1000
      })
      expect(document?.updatedAt).toBeGreaterThan(1000)
    })

    it('deletes requested hashtag documents without uses and leaves other documents alone', async () => {
      await seedPublicNote(db, 'keep', 50, ['#hqkeep'])
      for (const entityId of ['hqgone', 'hqbystander']) {
        await database.upsertSearchDocument({
          entityType: 'hashtag',
          entityId,
          documentText: entityId,
          postCount: 3
        })
      }
      await database.upsertSearchDocument({
        entityType: 'status',
        entityId: 'hqgone',
        documentText: 'hqgone status'
      })

      await database.indexHashtagSearchDocuments({
        hashtags: ['#HQGone', 'hqkeep', '', '#']
      })

      expect(await readSearchDocument(db, 'hashtag', 'hqgone')).toBeUndefined()
      expect(await readSearchDocument(db, 'hashtag', 'hqkeep')).toMatchObject({
        postCount: 1,
        lastPostAt: 50
      })
      expect(
        await readSearchDocument(db, 'hashtag', 'hqbystander')
      ).toMatchObject({ postCount: 3 })
      expect(await readSearchDocument(db, 'status', 'hqgone')).toMatchObject({
        documentText: 'hqgone status'
      })
    })
  })

  it('deleteHashtagSearchDocument removes the normalized hashtag document only', async () => {
    for (const entityType of ['hashtag', 'status'] as const) {
      await database.upsertSearchDocument({
        entityType,
        entityId: 'hqdelete',
        documentText: 'hqdelete'
      })
    }

    await database.deleteHashtagSearchDocument({ hashtag: '  ##HQDelete ' })

    expect(await readSearchDocument(db, 'hashtag', 'hqdelete')).toBeUndefined()
    expect(await readSearchDocument(db, 'status', 'hqdelete')).toBeDefined()
  })

  it('searchHashtags maps documents to Mastodon tags', async () => {
    await database.upsertSearchDocument({
      entityType: 'hashtag',
      entityId: 'hqmapped',
      documentText: 'hqmapped #hqmapped',
      postCount: 7,
      lastPostAt: 0
    })
    await database.upsertSearchDocument({
      entityType: 'hashtag',
      entityId: 'hqmappednull',
      documentText: 'hqmappednull #hqmappednull'
    })

    await expect(
      database.searchHashtags({ q: 'hqmapped', limit: 1, offset: 0 })
    ).resolves.toEqual([
      {
        name: 'hqmapped',
        url: expect.stringMatching(/^https:\/\/[^/]+\/tags\/hqmapped$/),
        history: [],
        following: false,
        postCount: 7,
        lastPostAt: 0
      }
    ])
    await expect(
      database.searchHashtags({ q: 'hqmapped', limit: 1, offset: 1 })
    ).resolves.toEqual([
      expect.objectContaining({
        name: 'hqmappednull',
        postCount: 0,
        lastPostAt: null
      })
    ])
  })
})

// Reindexing scans every tag, so these run on their own database.
describe('reindexSearchHashtags', () => {
  const testDb = createTestDatabase()
  const { database, db } = testDb

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
    await createSearchActor(database, { id: AUTHOR, username: 'author' })
  })

  afterAll(async () => {
    await database.destroy()
  })

  const hashtagDocumentIds = async () =>
    (
      await db
        .selectFrom('search_documents')
        .select('entityId')
        .where('entityType', '=', 'hashtag')
        .execute()
    ).map((row) => row.entityId)

  it('removes stale documents on a full run, keeps live ones and pages through tag names', async () => {
    // Tags: `#aa` (public, twice), bare `zz` (public), `#cc` (followers
    // only), a mention carrying `#dd`, and a hashtag row with no stored name.
    // Names keep one form per position so the order holds under any
    // collation.
    await seedPublicNote(db, 'aa-1', 10, ['#aa'])
    await seedPublicNote(db, 'aa-2', 20, ['#aa'])
    const bareId = await seedPublicNote(db, 'zz', 30, [])
    await seedTag(db, { statusId: bareId, name: 'zz', nameNormalized: 'zz' })
    const privateId = await seedStatus(db, {
      id: statusIdOf('cc'),
      actorId: AUTHOR,
      createdAt: 40,
      to: [`${AUTHOR}/followers`]
    })
    await seedTag(db, { statusId: privateId, name: '#cc' })
    await seedTag(db, {
      statusId: bareId,
      name: '#dd',
      type: 'mention',
      nameNormalized: '#dd'
    })
    await seedTag(db, {
      statusId: bareId,
      name: 'nameless',
      nameNormalized: null
    })

    // More hashtag documents than one cleanup page: the even ones have a tag
    // (on the followers-only status), the odd ones are stale.
    for (let index = 0; index < 150; index += 1) {
      const name = `stale${String(index).padStart(3, '0')}`
      await database.upsertSearchDocument({
        entityType: 'hashtag',
        entityId: name,
        documentText: name
      })
      if (index % 2 === 0) {
        await seedTag(db, { statusId: privateId, name: `#${name}` })
      }
    }
    for (const entityId of ['cc', 'dd', 'ghost']) {
      await database.upsertSearchDocument({
        entityType: 'hashtag',
        entityId,
        documentText: entityId
      })
    }
    // A status document named like a stale hashtag stays.
    await database.upsertSearchDocument({
      entityType: 'status',
      entityId: 'ghost',
      documentText: 'ghost'
    })

    // A resumed run leaves stale documents alone.
    await expect(
      database.reindexSearchHashtags({ afterId: 'zzz', limit: 2 })
    ).resolves.toEqual({ indexed: 0, nextCursor: null })
    expect(await hashtagDocumentIds()).toContain('ghost')

    await expect(database.reindexSearchHashtags({ limit: 1 })).resolves.toEqual(
      { indexed: 1, nextCursor: '#aa' }
    )
    const ids = await hashtagDocumentIds()
    expect(ids).toEqual(
      expect.arrayContaining(['aa', 'cc', 'stale000', 'stale148'])
    )
    expect(ids).not.toContain('dd')
    expect(ids).not.toContain('ghost')
    expect(ids.filter((id) => id.startsWith('stale'))).toHaveLength(75)
    expect(ids).not.toContain('stale001')
    expect(ids).not.toContain('stale149')
    expect(await readSearchDocument(db, 'status', 'ghost')).toBeDefined()
    expect(await readSearchDocument(db, 'hashtag', 'aa')).toMatchObject({
      postCount: 2,
      lastPostAt: 20
    })

    // Pages run over distinct stored names in order: `#aa`, `#cc`, the
    // `#stale…` names, then bare `zz`.
    await expect(
      database.reindexSearchHashtags({ afterId: '#aa', limit: 2 })
    ).resolves.toEqual({ indexed: 2, nextCursor: '#stale000' })
    // `cc` has no public use, so its document goes.
    expect(await readSearchDocument(db, 'hashtag', 'cc')).toBeUndefined()
    await expect(
      database.reindexSearchHashtags({ afterId: '#stale148', limit: 2 })
    ).resolves.toEqual({ indexed: 1, nextCursor: null })
    expect(await readSearchDocument(db, 'hashtag', 'zz')).toMatchObject({
      postCount: 1,
      lastPostAt: 30
    })
    await expect(
      database.reindexSearchHashtags({ afterId: 'zz', limit: 2 })
    ).resolves.toEqual({ indexed: 0, nextCursor: null })

    // A full run with room for everything skips the nameless row.
    await expect(
      database.reindexSearchHashtags({ limit: 500 })
    ).resolves.toEqual({ indexed: 78, nextCursor: null })
  })
})

// `# name` and `#name` rows sort apart under some collations and together
// under others, so they get a database of their own.
describe('reindexSearchHashtags with a spaced stored name', () => {
  const testDb = createTestDatabase()
  const { database, db } = testDb

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
    await createSearchActor(database, { id: AUTHOR, username: 'author' })
  })

  afterAll(async () => {
    await database.destroy()
  })

  it('indexes the bare name from a page holding either of its spellings', async () => {
    // `# hqspaced` reindexes as `hqspaced`, counted from the `#hqspaced`
    // row; it is not a stored spelling of that name, so it adds no use.
    const statusId = await seedPublicNote(db, 'spaced', 10, ['#hqspaced'])
    await seedTag(db, {
      statusId,
      name: '# hqspaced',
      nameNormalized: '# hqspaced'
    })

    await expect(
      database.reindexSearchHashtags({ limit: 1 })
    ).resolves.toMatchObject({ indexed: 1 })
    expect(await readSearchDocument(db, 'hashtag', 'hqspaced')).toMatchObject({
      postCount: 1,
      lastPostAt: 10
    })
    expect(await readSearchDocument(db, 'hashtag', ' hqspaced')).toBeUndefined()
  })
})
