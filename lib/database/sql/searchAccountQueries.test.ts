import type { Updateable } from 'kysely'

import type { Actors } from '@/lib/database/kysely/db'
import { createSearchActor } from '@/lib/database/sql/searchTestHelpers'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { FollowStatus } from '@/lib/types/domain/follow'
import { getLocalActorId } from '@/lib/utils/activitypubId'

const testDb = createTestDatabase()
const { database } = testDb

const actorIdOf = (username: string, domain = 'acct.test') =>
  `https://${domain}/users/${username}`

const addActor = async (
  username: string,
  { summary, domain = 'acct.test' }: { summary?: string; domain?: string } = {}
) => {
  const id = actorIdOf(username, domain)
  await createSearchActor(database, { id, username, domain, summary })
  return id
}

// Changes the actor row without refreshing its search document, so the
// document stays as it was when the actor was created.
const patchActor = (id: string, values: Updateable<Actors>) =>
  testDb.db.updateTable('actors').set(values).where('id', '=', id).execute()

const setDocumentDiscoverable = (ids: string[], discoverable: boolean) =>
  testDb.db
    .updateTable('search_documents')
    .set({ discoverable })
    .where('entityType', '=', 'account')
    .where('entityId', 'in', ids)
    .execute()

const deleteAccountDocuments = (ids: string[]) =>
  testDb.db
    .deleteFrom('search_documents')
    .where('entityType', '=', 'account')
    .where('entityId', 'in', ids)
    .execute()

const readDocument = (entityType: string, entityId: string) =>
  testDb.db
    .selectFrom('search_documents')
    .selectAll()
    .where('entityType', '=', entityType)
    .where('entityId', '=', entityId)
    .executeTakeFirst()

const follow = (
  actorId: string,
  targetActorId: string,
  status: FollowStatus = FollowStatus.enum.Accepted
) =>
  database.createFollow({
    actorId,
    targetActorId,
    status,
    inbox: `${targetActorId}/inbox`,
    sharedInbox: 'https://acct.test/inbox'
  })

const searchIds = (
  params: Partial<Parameters<typeof database.searchAccountIds>[0]> & {
    q: string
  }
) => database.searchAccountIds({ limit: 20, ...params })

beforeAll(async () => {
  await testDb.prepare()
  await database.migrate()
})

afterAll(async () => {
  await database.destroy()
})

describe('searchAccountIds', () => {
  it('only returns account documents that have an actor', async () => {
    const backedId = await addActor('zqbacked', { summary: 'zqjoin' })
    const decoyId = await addActor('zqdecoy', { summary: 'plain' })
    // A document of another type whose entity id is an actor's id, and an
    // account document with no actor row, both match the text.
    await database.upsertSearchDocument({
      entityType: 'status',
      entityId: decoyId,
      documentText: 'zqjoin status',
      actorId: decoyId,
      visibility: 'public',
      discoverable: true
    })
    await database.upsertSearchDocument({
      entityType: 'hashtag',
      entityId: decoyId,
      documentText: 'zqjoin hashtag',
      discoverable: true
    })
    await database.upsertSearchDocument({
      entityType: 'account',
      entityId: actorIdOf('zqorphan'),
      documentText: 'zqjoin orphan',
      discoverable: true
    })

    await expect(searchIds({ q: 'zqjoin' })).resolves.toEqual([backedId])
  })

  it('leaves out accounts being deleted and the internal federation actor but keeps look-alikes', async () => {
    const liveId = await addActor('zqscope-live', { summary: 'zqscope' })
    const deletingId = await addActor('zqscope-deleting', {
      summary: 'zqscope'
    })
    const scheduledId = await addActor('zqscope-scheduled', {
      summary: 'zqscope'
    })
    const internalId = await addActor('zqscope-internal', {
      summary: 'zqscope'
    })
    const prefixedId = await addActor('zqscope-prefixed', {
      summary: 'zqscope'
    })
    const wildcardId = await addActor('zqscope-wildcard', {
      summary: 'zqscope'
    })
    const personId = await addActor('zqscope-person', { summary: 'zqscope' })
    const ownedId = getLocalActorId({
      domain: 'acct.test',
      username: 'zqscope-owner'
    })
    await database.createAccount({
      email: 'zqscope-owner@acct.test',
      username: 'zqscope-owner',
      passwordHash: 'password-hash',
      domain: 'acct.test',
      privateKey: 'private-key',
      publicKey: 'public-key'
    })
    await database.upsertSearchDocument({
      entityType: 'account',
      entityId: ownedId,
      documentText: 'zqscope owner',
      actorId: ownedId,
      discoverable: true
    })

    await patchActor(deletingId, { deletionStatus: 'deleting' })
    await patchActor(scheduledId, { deletionStatus: 'scheduled' })
    // The internal actor is a Service named __instance__ without an account.
    await patchActor(internalId, {
      type: 'Service',
      username: '__instance__'
    })
    await patchActor(prefixedId, {
      type: 'Service',
      username: '__instance__2'
    })
    // Look-alikes: `_` in the name pattern is literal, the type must be
    // Service, and an actor with an account is not the internal one.
    await patchActor(wildcardId, {
      type: 'Service',
      username: 'abinstancecd'
    })
    await patchActor(personId, { type: 'Person', username: '__instance__x' })
    await patchActor(ownedId, { type: 'Service', username: '__instance__y' })

    expect((await searchIds({ q: 'zqscope' })).sort()).toEqual(
      [liveId, wildcardId, personId, ownedId].sort()
    )
  })

  it('only lists discoverable accounts unless the searcher is following', async () => {
    const viewerId = await addActor('zqviewer', { summary: 'zqfollow' })
    const otherViewerId = await addActor('zqother-viewer')
    const followedId = await addActor('zqfollowed', { summary: 'zqfollow' })
    const hiddenId = await addActor('zqhidden', { summary: 'zqfollow' })
    const pendingId = await addActor('zqpending', { summary: 'zqfollow' })
    const theirsId = await addActor('zqtheirs', { summary: 'zqfollow' })
    const strangerId = await addActor('zqstranger', { summary: 'zqfollow' })
    await setDocumentDiscoverable([hiddenId], false)
    await follow(viewerId, followedId)
    await follow(viewerId, hiddenId)
    await follow(viewerId, pendingId, FollowStatus.enum.Requested)
    await follow(otherViewerId, theirsId)

    expect((await searchIds({ q: 'zqfollow' })).sort()).toEqual(
      [viewerId, followedId, pendingId, theirsId, strangerId].sort()
    )
    // Following mode lists the accepted follows (hidden ones too) and the
    // searcher; another actor's follows and requests do not count.
    expect(
      (await searchIds({ q: 'zqfollow', followingActorId: viewerId })).sort()
    ).toEqual([viewerId, followedId, hiddenId].sort())
    await expect(
      searchIds({ q: 'zqfollow', followingActorId: otherViewerId })
    ).resolves.toEqual([theirsId])
  })

  it('ranks exact usernames, then prefixes, then other matches, and breaks ties by name and id', async () => {
    const exactId = await addActor('zqrank')
    const lowerId = await addActor('zqranka')
    const upperId = await addActor('zqrankB')
    const laterId = await addActor('zqrankc')
    const summaryId = await addActor('aaa', { summary: 'zqrank fan' })
    const nullDomainId = await addActor('zqranknull')
    // A prefix of the username when the actor has no domain to form a handle.
    await patchActor(nullDomainId, { domain: null })
    await database.indexActorSearchDocument({ id: nullDomainId })

    const ranked = [exactId, lowerId, upperId, laterId, nullDomainId, summaryId]
    await expect(searchIds({ q: 'zqrank' })).resolves.toEqual(ranked)
    await expect(
      searchIds({ q: 'zqrank', limit: 3, offset: 2 })
    ).resolves.toEqual(ranked.slice(2, 5))
    await expect(searchIds({ q: 'zqrank', limit: 2 })).resolves.toEqual(
      ranked.slice(0, 2)
    )
    // A leading @ and surrounding spaces do not change the ranking.
    await expect(searchIds({ q: ' @ZQRANK ' })).resolves.toEqual(ranked)
  })

  it('breaks ties between equal usernames by actor id', async () => {
    // Added in the opposite order to the expected one.
    const ids: string[] = []
    for (const domain of ['d', 'b', 'e', 'a', 'c']) {
      ids.push(await addActor('zqtie', { domain: `${domain}.acct.test` }))
    }

    const found = await searchIds({ q: 'zqtie' })
    expect(found).toEqual([...ids].sort())

    const searches: string[] = []
    const capture = ({ sql }: { sql: string }) => {
      if (sql.startsWith('select "search_documents"."entityId"'))
        searches.push(sql)
    }
    testDb.knex.on('query', capture)
    try {
      await searchIds({ q: 'zqtie' })
    } finally {
      testDb.knex.off('query', capture)
    }
    expect(searches).toHaveLength(1)
    expect(searches[0]).toMatch(
      /lower\("actors"\."username"\), "search_documents"\."entityId" asc limit [?$]\d* offset [?$]\d*$/
    )
  })

  it('ranks an exact username above a handle prefix, and that above a username prefix without a domain', async () => {
    // Without a domain an actor has no handle, so only its username ranks it.
    const exactId = await addActor('zqexn')
    const prefixId = await addActor('zqexnb')
    await patchActor(exactId, { domain: null })
    await database.indexActorSearchDocument({ id: exactId })
    await expect(searchIds({ q: 'zqexn' })).resolves.toEqual([
      exactId,
      prefixId
    ])

    // A % in the query is a literal in both prefix patterns.
    const handlePrefixId = await addActor('zqesc%b')
    const usernamePrefixId = await addActor('zqesc%a')
    await patchActor(usernamePrefixId, { domain: null })
    await database.indexActorSearchDocument({ id: usernamePrefixId })
    await expect(searchIds({ q: 'zqesc%' })).resolves.toEqual([
      handlePrefixId,
      usernamePrefixId
    ])
  })

  it('ranks prefixes literally when the search text has LIKE wildcards', async () => {
    const prefixId = await addActor('zq_xfan')
    const noDomainId = await addActor('zq_xnull')
    const wildcardId = await addActor('zqaxwild', { summary: 'zq_x' })
    const summaryId = await addActor('aaa-wild', { summary: 'zq_x thing' })
    await patchActor(noDomainId, { domain: null })
    await database.indexActorSearchDocument({ id: noDomainId })

    // `_` is a literal in the prefix: zqaxwild only matches through its
    // summary, like aaa-wild, and so ranks after the handle and username
    // prefixes.
    await expect(searchIds({ q: 'zq_x' })).resolves.toEqual([
      prefixId,
      noDomainId,
      summaryId,
      wildcardId
    ])
  })

  it('matches every token against the account text', async () => {
    const bothId = await addActor('zqtoken-both', { summary: 'zqone zqtwo' })
    await addActor('zqtoken-one', { summary: 'zqone' })
    await addActor('zqtoken-two', { summary: 'zqtwo' })

    await expect(searchIds({ q: 'zqone zqtwo' })).resolves.toEqual([bothId])
    await expect(searchIds({ q: '!!!' })).resolves.toEqual([])
  })
})

describe('searchAccountIds with exact matches', () => {
  it('resolves handles and local usernames regardless of case, to the matching actor only', async () => {
    const handleId = await addActor('ZqHandle')
    const otherDomainId = await addActor('ZqHandle', { domain: 'other.test' })
    const otherNameId = await addActor('zqhandle-other')
    const mixedDomainId = await addActor('zqdom', { domain: 'MixDom.test' })
    // Exact matches do not need a search document, so remove them to see
    // only what the exact lookup returns.
    await deleteAccountDocuments([
      handleId,
      otherDomainId,
      otherNameId,
      mixedDomainId
    ])

    await expect(searchIds({ q: '@zqhandle@acct.test' })).resolves.toEqual([
      handleId
    ])
    await expect(searchIds({ q: '@ZQHANDLE@ACCT.test' })).resolves.toEqual([
      handleId
    ])
    await expect(searchIds({ q: '@zqdom@mixdom.test' })).resolves.toEqual([
      mixedDomainId
    ])
    await expect(
      searchIds({ q: 'zqhandle', localDomain: 'ACCT.test' })
    ).resolves.toEqual([handleId])
    await expect(
      searchIds({ q: ' ZQHANDLE ', localDomain: 'acct.test' })
    ).resolves.toEqual([handleId])
    await expect(searchIds({ q: 'zqhandle' })).resolves.toEqual([])
    // A query with an @ is a handle or nothing, never a local username.
    const atId = await addActor('zqat@')
    await deleteAccountDocuments([atId])
    await expect(
      searchIds({ q: 'zqat@', localDomain: 'acct.test' })
    ).resolves.toEqual([])
  })

  it('keeps the requested ids that are visible and, when following, followed', async () => {
    const viewerId = await addActor('zqex-viewer')
    const visibleId = await addActor('zqex-visible')
    const deletingId = await addActor('zqex-deleting')
    const internalId = await addActor('zqex-internal')
    const followedId = await addActor('zqex-followed')
    const requestedId = await addActor('zqex-requested')
    // Not requested, so never part of the result.
    await addActor('zqex-not-requested')
    await patchActor(deletingId, { deletionStatus: 'scheduled' })
    await patchActor(internalId, {
      type: 'Service',
      username: '__instance__3'
    })
    await follow(viewerId, followedId)
    await follow(viewerId, requestedId, FollowStatus.enum.Requested)
    const exactActorIds = [
      visibleId,
      deletingId,
      'https://acct.test/users/zqex-missing',
      internalId,
      followedId,
      visibleId,
      requestedId
    ]

    await expect(searchIds({ q: 'zqnomatch', exactActorIds })).resolves.toEqual(
      [visibleId, followedId, requestedId]
    )
    await expect(
      searchIds({ q: 'zqnomatch', exactActorIds, limit: 2, offset: 1 })
    ).resolves.toEqual([followedId, requestedId])
    await expect(
      searchIds({
        q: 'zqnomatch',
        exactActorIds,
        followingActorId: viewerId
      })
    ).resolves.toEqual([followedId])
  })

  it('does not repeat an exact match in the indexed results', async () => {
    const exactId = await addActor('zqrepeat')
    const prefixId = await addActor('zqrepeat-more')

    await expect(
      searchIds({ q: 'zqrepeat', localDomain: 'acct.test' })
    ).resolves.toEqual([exactId, prefixId])
    await expect(
      searchIds({ q: 'zqrepeat', exactActorIds: [prefixId] })
    ).resolves.toEqual([prefixId, exactId])
  })
})

describe('the actor search document', () => {
  it('is rebuilt for the given actor only', async () => {
    const actorId = await addActor('zqindex', { summary: 'About Index' })
    const neighbourId = await addActor('zqindex-neighbour')
    await patchActor(actorId, { name: 'Index Name' })
    await testDb.db
      .updateTable('search_documents')
      .set({ documentText: 'stale', discoverable: false })
      .where('entityType', '=', 'account')
      .where('entityId', 'in', [actorId, neighbourId])
      .execute()

    await database.indexActorSearchDocument({ id: actorId })

    await expect(readDocument('account', actorId)).resolves.toMatchObject({
      id: `account:${actorId}`,
      documentText:
        'zqindex zqindex@acct.test @zqindex@acct.test Index Name About Index',
      actorId,
      visibility: null,
      entityCreatedAt: 1,
      discoverable: true,
      postCount: null,
      lastPostAt: null
    })
    await expect(readDocument('account', neighbourId)).resolves.toMatchObject({
      documentText: 'stale',
      discoverable: false
    })
  })

  it('goes with the actor, and only its account document', async () => {
    const goneId = actorIdOf('zqgone')
    const neighbourId = await addActor('zqgone-neighbour')
    for (const entityType of ['account', 'status', 'hashtag'] as const) {
      await database.upsertSearchDocument({
        entityType,
        entityId: goneId,
        documentText: 'zqgone'
      })
    }

    await database.indexActorSearchDocument({ id: goneId })

    await expect(readDocument('account', goneId)).resolves.toBeUndefined()
    await expect(readDocument('status', goneId)).resolves.toBeDefined()
    await expect(readDocument('hashtag', goneId)).resolves.toBeDefined()
    await expect(readDocument('account', neighbourId)).resolves.toBeDefined()

    await database.upsertSearchDocument({
      entityType: 'account',
      entityId: goneId,
      documentText: 'zqgone'
    })
    await database.deleteActorSearchDocument({ id: goneId })
    await expect(readDocument('account', goneId)).resolves.toBeUndefined()
    await expect(readDocument('status', goneId)).resolves.toBeDefined()
    await expect(readDocument('hashtag', goneId)).resolves.toBeDefined()
    await expect(readDocument('account', neighbourId)).resolves.toBeDefined()
  })

  it('is discoverable unless the actor opts out, is being deleted or is the internal actor', async () => {
    const ownerId = getLocalActorId({
      domain: 'acct.test',
      username: 'zqdisc-owner'
    })
    await database.createAccount({
      email: 'zqdisc-owner@acct.test',
      username: 'zqdisc-owner',
      passwordHash: 'password-hash',
      domain: 'acct.test',
      privateKey: 'private-key',
      publicKey: 'public-key'
    })
    const cases: [string, Updateable<Actors>, boolean][] = [
      ['zqdisc-plain', {}, true],
      [
        'zqdisc-noindex',
        { settings: JSON.stringify({ noindex: true }) },
        false
      ],
      [
        'zqdisc-indexed',
        { settings: JSON.stringify({ noindex: false }) },
        true
      ],
      ['zqdisc-deleting', { deletionStatus: 'deleting' }, false],
      [
        'zqdisc-internal',
        { type: 'Service', username: '__instance__4' },
        false
      ],
      ['zqdisc-service', { type: 'Service', username: 'zqdisc-service' }, true],
      [
        'zqdisc-person',
        { type: 'Person', username: '__instance__person' },
        true
      ]
    ]
    for (const [username, values, expected] of cases) {
      const id = await addActor(username)
      if (Object.keys(values).length > 0) await patchActor(id, values)
      await database.indexActorSearchDocument({ id })
      await expect(readDocument('account', id)).resolves.toMatchObject({
        discoverable: expected
      })
    }

    await patchActor(ownerId, {
      type: 'Service',
      username: '__instance__owned'
    })
    await database.indexActorSearchDocument({ id: ownerId })
    await expect(readDocument('account', ownerId)).resolves.toMatchObject({
      discoverable: true
    })
  })
})

describe('reindexSearchAccounts', () => {
  it('walks actors in id order from the cursor and leaves the rest alone', async () => {
    const reindexDb = createTestDatabase({ isolated: true })
    const { database: reindexDatabase } = reindexDb

    try {
      await reindexDb.prepare()
      await reindexDatabase.migrate()
      const ids: string[] = []
      for (const username of ['e', 'a', 'd', 'b', 'c']) {
        const id = actorIdOf(`zqre-${username}`)
        await createSearchActor(reindexDatabase, {
          id,
          username: `zqre-${username}`
        })
        ids.push(id)
      }
      ids.sort()
      await reindexDatabase.upsertSearchDocument({
        entityType: 'status',
        entityId: ids[0],
        documentText: 'status document of the same entity id'
      })
      const accountDocuments = () =>
        reindexDb.db
          .selectFrom('search_documents')
          .select(['entityId', 'documentText'])
          .where('entityType', '=', 'account')
          .orderBy('entityId')
          .execute()
      await reindexDb.db
        .updateTable('search_documents')
        .set({ documentText: 'stale' })
        .where('entityType', '=', 'account')
        .execute()

      await expect(
        reindexDatabase.reindexSearchAccounts({ limit: 2 })
      ).resolves.toEqual({ indexed: 2, nextCursor: ids[1] })
      expect(
        (await accountDocuments()).map((row) => row.documentText === 'stale')
      ).toEqual([false, false, true, true, true])

      await expect(
        reindexDatabase.reindexSearchAccounts({ afterId: ids[1], limit: 2 })
      ).resolves.toEqual({ indexed: 2, nextCursor: ids[3] })
      expect(
        (await accountDocuments()).map((row) => row.documentText === 'stale')
      ).toEqual([false, false, false, false, true])

      await expect(
        reindexDatabase.reindexSearchAccounts({ afterId: ids[3], limit: 2 })
      ).resolves.toEqual({ indexed: 1, nextCursor: null })
      await expect(
        reindexDatabase.reindexSearchAccounts({ afterId: ids[4] })
      ).resolves.toEqual({ indexed: 0, nextCursor: null })
      await expect(accountDocuments()).resolves.toEqual(
        ids.map((id) => ({
          entityId: id,
          documentText: expect.stringContaining('zqre-')
        }))
      )
      await expect(
        reindexDb.db
          .selectFrom('search_documents')
          .select('documentText')
          .where('entityType', '=', 'status')
          .execute()
      ).resolves.toEqual([
        { documentText: 'status document of the same entity id' }
      ])
    } finally {
      await reindexDatabase.destroy()
    }
  })
})
