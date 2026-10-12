import crypto from 'crypto'
import type { Insertable } from 'kysely'

import { incrementBucket } from '@/lib/database/kysely/counterBucket'
import type { Accounts, Actors } from '@/lib/database/kysely/db'
import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { Database } from '@/lib/database/types'
import { TEST_DOMAIN, TEST_PASSWORD_HASH } from '@/lib/stub/const'
import { seedDatabase } from '@/lib/stub/database'
import { DatabaseSeed } from '@/lib/stub/scenarios/database'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { generatePublicId, isPublicId } from '@/lib/utils/publicId'

type HashtagRows = Awaited<ReturnType<Database['getAllHashtags']>>['hashtags']

describe('AdminDatabase', () => {
  const { actors } = DatabaseSeed
  const primaryActorId = actors.primary.id
  const table = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  afterAll(async () => {
    await Promise.all(table.map((item) => item[1].destroy()))
  })

  describe.each(table)('%s', (_, database) => {
    beforeAll(async () => {
      await seedDatabase(database as Database)
    })

    describe('getAllHashtags', () => {
      const tagA = `alpha_${Date.now()}`
      const tagB = `beta_${Date.now()}`
      const tagC = `gamma_${Date.now()}`

      beforeAll(async () => {
        // tagA: 3 public posts
        for (let i = 1; i <= 3; i++) {
          const id = `${primaryActorId}/statuses/admin-tag-a-${i}`
          await database.createNote({
            id,
            url: id,
            actorId: primaryActorId,
            to: [ACTIVITY_STREAM_PUBLIC],
            cc: [],
            text: `Post #${tagA} number ${i}`
          })
          await database.createTag({
            statusId: id,
            name: `#${tagA}`,
            value: `https://${actors.primary.domain}/tags/${tagA}`,
            type: 'hashtag'
          })
        }

        // tagB: 1 public post
        const idB = `${primaryActorId}/statuses/admin-tag-b-1`
        await database.createNote({
          id: idB,
          url: idB,
          actorId: primaryActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: `Post #${tagB}`
        })
        await database.createTag({
          statusId: idB,
          name: `#${tagB}`,
          value: `https://${actors.primary.domain}/tags/${tagB}`,
          type: 'hashtag'
        })

        // tagC: 2 public posts and 1 non-public post
        for (let i = 1; i <= 2; i++) {
          const id = `${primaryActorId}/statuses/admin-tag-c-${i}`
          await database.createNote({
            id,
            url: id,
            actorId: primaryActorId,
            to: [ACTIVITY_STREAM_PUBLIC],
            cc: [],
            text: `Post #${tagC} number ${i}`
          })
          await database.createTag({
            statusId: id,
            name: `#${tagC}`,
            value: `https://${actors.primary.domain}/tags/${tagC}`,
            type: 'hashtag'
          })
        }
        // Non-public post for tagC — should not be counted
        const privateId = `${primaryActorId}/statuses/admin-tag-c-private`
        await database.createNote({
          id: privateId,
          url: privateId,
          actorId: primaryActorId,
          to: [`${primaryActorId}/followers`],
          cc: [],
          text: `Private #${tagC}`
        })
        await database.createTag({
          statusId: privateId,
          name: `#${tagC}`,
          value: `https://${actors.primary.domain}/tags/${tagC}`,
          type: 'hashtag'
        })
      })

      it('returns total count of hashtags with public posts only', async () => {
        const { total } = await database.getAllHashtags({
          limit: 100,
          offset: 0,
          sort: 'alphabetical'
        })
        // At least tagA, tagB, tagC must be present (plus any from the seed)
        expect(total).toBeGreaterThanOrEqual(3)
      })

      it('returns postCount reflecting only public posts', async () => {
        const { hashtags } = await database.getAllHashtags({
          limit: 100,
          offset: 0,
          sort: 'alphabetical'
        })
        // name now equals nameNormalized (includes the '#' prefix)
        const a = hashtags.find((h) => h.name === `#${tagA}`)
        const b = hashtags.find((h) => h.name === `#${tagB}`)
        const c = hashtags.find((h) => h.name === `#${tagC}`)

        expect(a?.postCount).toBe(3)
        expect(b?.postCount).toBe(1)
        // tagC has 2 public + 1 private; only public should count
        expect(c?.postCount).toBe(2)
      })

      it.each([
        {
          sort: 'alphabetical' as const,
          read: (hashtags: HashtagRows) => {
            const names = hashtags.map((h) => h.name)
            return { actual: names, expected: [...names].sort() }
          }
        },
        {
          sort: 'count' as const,
          read: (hashtags: HashtagRows) => {
            const counts = hashtags.map((h) => h.postCount)
            return {
              actual: counts,
              expected: [...counts].sort((a, b) => b - a)
            }
          }
        },
        {
          sort: 'recent' as const,
          read: (hashtags: HashtagRows) => {
            const times = hashtags
              .map((h) => h.latestPostAt ?? 0)
              .filter((t) => t > 0)
            return { actual: times, expected: [...times].sort((a, b) => b - a) }
          }
        }
      ])('sorts by $sort', async ({ sort, read }) => {
        const { hashtags } = await database.getAllHashtags({
          limit: 100,
          offset: 0,
          sort
        })
        const { actual, expected } = read(hashtags)
        expect(actual).toEqual(expected)
      })

      it('paginates correctly', async () => {
        const { total } = await database.getAllHashtags({
          limit: 100,
          offset: 0,
          sort: 'count'
        })
        const pageSize = 2
        const { hashtags: page1 } = await database.getAllHashtags({
          limit: pageSize,
          offset: 0,
          sort: 'count'
        })
        const { hashtags: page2 } = await database.getAllHashtags({
          limit: pageSize,
          offset: pageSize,
          sort: 'count'
        })
        expect(page1).toHaveLength(Math.min(pageSize, total))
        // Pages should not overlap
        const page1Names = new Set(page1.map((h) => h.name))
        page2.forEach((h) => expect(page1Names.has(h.name)).toBe(false))
      })

      it('provides latestPostAt timestamp for each hashtag', async () => {
        const { hashtags } = await database.getAllHashtags({
          limit: 100,
          offset: 0,
          sort: 'recent'
        })
        const ourTags = hashtags.filter((h) =>
          [`#${tagA}`, `#${tagB}`, `#${tagC}`].includes(h.name)
        )
        ourTags.forEach((h) => {
          expect(h.latestPostAt).not.toBeNull()
          expect(typeof h.latestPostAt).toBe('number')
        })
      })
    })

    describe('getAccountWithActors', () => {
      it('returns actors with a v7 publicId threaded from the row', async () => {
        const suffix = crypto.randomUUID().slice(0, 8)
        const username = `admin-actor-${suffix}`
        const accountId = await database.createAccount({
          email: `${username}@${TEST_DOMAIN}`,
          username,
          passwordHash: TEST_PASSWORD_HASH,
          domain: TEST_DOMAIN,
          privateKey: `privateKey-${suffix}`,
          publicKey: `publicKey-${suffix}`
        })

        const result = await database.getAccountWithActors({ accountId })

        expect(result?.actors[0]?.publicId).toBeTruthy()
        expect(isPublicId(result?.actors[0]?.publicId as string)).toBe(true)
      })
    })

    describe('domain federation rules', () => {
      it('creates, matches, updates, and deletes domain blocks', async () => {
        const suffix = crypto.randomUUID().slice(0, 8)
        const domain = `blocked-${suffix}.test`
        const block = await database.createDomainBlock({
          domain: `https://${domain}/path`,
          severity: 'suspend',
          rejectMedia: true,
          publicComment: 'spam source',
          obfuscate: true
        })

        expect(block).toMatchObject({
          domain,
          severity: 'suspend',
          rejectMedia: true,
          publicComment: 'spam source',
          obfuscate: true
        })

        await expect(
          database.getDomainBlockForDomain(domain)
        ).resolves.toMatchObject({ id: block.id })
        await expect(
          database.getDomainBlockForDomain(`sub.${domain}`)
        ).resolves.toBeNull()

        const updated = await database.updateDomainBlock({
          id: block.id,
          severity: 'silence',
          rejectMedia: false,
          publicComment: 'limited'
        })
        expect(updated).toMatchObject({
          severity: 'silence',
          rejectMedia: false,
          publicComment: 'limited'
        })

        await expect(
          database.deleteDomainBlock(block.id)
        ).resolves.toMatchObject({
          id: block.id
        })
        await expect(database.getDomainBlockById(block.id)).resolves.toBeNull()
      })

      it('upserts domain blocks by domain and type', async () => {
        const domain = `upsert-${crypto.randomUUID().slice(0, 8)}.test`
        const first = await database.createDomainBlock({
          domain,
          severity: 'suspend',
          publicComment: 'first'
        })
        const second = await database.createDomainBlock({
          domain,
          severity: 'silence',
          publicComment: 'second'
        })

        expect(second.id).toBe(first.id)
        expect(second).toMatchObject({
          domain,
          severity: 'silence',
          publicComment: 'second'
        })
      })

      it('filters domain blocks by severity and counts suspend blocks', async () => {
        const suffix = crypto.randomUUID().slice(0, 8)
        const suspendDomain = `000-suspend-${suffix}.test`
        const silenceDomain = `000-silence-${suffix}.test`
        const noopDomain = `000-noop-${suffix}.test`
        const before = await database.getDomainFederationRuleStats()

        await database.createDomainBlock({
          domain: suspendDomain,
          severity: 'suspend'
        })
        await database.createDomainBlock({
          domain: silenceDomain,
          severity: 'silence'
        })
        await database.createDomainBlock({
          domain: noopDomain,
          severity: 'noop'
        })

        const after = await database.getDomainFederationRuleStats()
        expect(after.blocks).toBe(before.blocks + 3)
        expect(after.suspendBlocks).toBe(before.suspendBlocks + 1)
        expect(after.silenceBlocks).toBe(before.silenceBlocks + 1)

        const suspendBlocks = await database.getDomainBlocks({
          limit: 1000,
          severities: ['suspend']
        })
        const suspendDomains = new Set(
          suspendBlocks.map((block) => block.domain)
        )
        expect(suspendDomains.has(suspendDomain)).toBe(true)
        expect(suspendDomains.has(silenceDomain)).toBe(false)
        expect(suspendDomains.has(noopDomain)).toBe(false)

        // The public instance endpoint lists both user-facing severities.
        const publicBlocks = await database.getDomainBlocks({
          limit: 1000,
          severities: ['silence', 'suspend']
        })
        const publicDomains = new Set(publicBlocks.map((block) => block.domain))
        expect(publicDomains.has(suspendDomain)).toBe(true)
        expect(publicDomains.has(silenceDomain)).toBe(true)
        expect(publicDomains.has(noopDomain)).toBe(false)
      })

      it('matches exact domains before wildcard rules in SQL', async () => {
        const suffix = crypto.randomUUID().slice(0, 8)
        const parentDomain = `parent-${suffix}.test`
        const childDomain = `sub.${parentDomain}`
        const wildcard = await database.createDomainBlock({
          domain: `*.${parentDomain}`,
          severity: 'silence'
        })
        const child = await database.createDomainBlock({
          domain: childDomain,
          severity: 'suspend'
        })

        await expect(
          database.getDomainBlockForDomain(childDomain)
        ).resolves.toMatchObject({ id: child.id })
        await expect(
          database.getDomainBlockForDomain(`deep.${childDomain}`)
        ).resolves.toMatchObject({ id: wildcard.id })
        await expect(
          database.getDomainBlockForDomain(parentDomain)
        ).resolves.toBeNull()
      })

      it('matches domain rules for multiple domains in one batch', async () => {
        const suffix = crypto.randomUUID().slice(0, 8)
        const parentDomain = `batch-parent-${suffix}.test`
        const childDomain = `sub.${parentDomain}`
        const wildcardParent = await database.createDomainBlock({
          domain: `*.${parentDomain}`,
          severity: 'silence'
        })
        const child = await database.createDomainBlock({
          domain: childDomain,
          severity: 'suspend'
        })
        const allowDomain = `batch-allow-${suffix}.test`
        const wildcardAllow = await database.createDomainAllow({
          domain: `*.${allowDomain}`
        })

        const blockMatches = await database.getDomainBlocksForDomains([
          childDomain,
          `deep.${childDomain}`,
          parentDomain,
          `unknown-${suffix}.test`
        ])
        expect(blockMatches[childDomain]).toMatchObject({
          id: child.id
        })
        expect(blockMatches[`deep.${childDomain}`]).toMatchObject({
          id: wildcardParent.id
        })
        expect(blockMatches[parentDomain]).toBeNull()
        expect(blockMatches[`unknown-${suffix}.test`]).toBeNull()

        const allowMatches = await database.getDomainAllowsForDomains([
          `sub.${allowDomain}`,
          allowDomain
        ])
        expect(allowMatches[`sub.${allowDomain}`]).toMatchObject({
          id: wildcardAllow.id
        })
        expect(allowMatches[allowDomain]).toBeNull()
      })

      it('matches domain rules for large domain batches', async () => {
        const suffix = crypto.randomUUID().slice(0, 8)
        const blockDomain = `large-block-${suffix}.test`
        const allowDomain = `large-allow-${suffix}.test`
        const block = await database.createDomainBlock({
          domain: blockDomain,
          severity: 'suspend'
        })
        const allow = await database.createDomainAllow({
          domain: allowDomain
        })
        const domains = [
          blockDomain,
          allowDomain,
          ...Array.from(
            { length: 1100 },
            (_, index) => `large-${index}-${suffix}.test`
          )
        ]

        const blockMatches = await database.getDomainBlocksForDomains(domains)
        const allowMatches = await database.getDomainAllowsForDomains(domains)

        expect(blockMatches[blockDomain]).toMatchObject({ id: block.id })
        expect(allowMatches[allowDomain]).toMatchObject({ id: allow.id })
        expect(blockMatches[domains[2]]).toBeNull()
        expect(allowMatches[domains[2]]).toBeNull()
      })

      it('does not match wildcard rules against the parent domain', async () => {
        const domain = `wild-${crypto.randomUUID().slice(0, 8)}.test`
        const wildcard = await database.createDomainAllow({
          domain: `*.${domain}`
        })

        await expect(
          database.getDomainAllowForDomain(`sub.${domain}`)
        ).resolves.toMatchObject({ id: wildcard.id })
        await expect(
          database.getDomainAllowForDomain(domain)
        ).resolves.toBeNull()
      })

      it('creates and deletes domain allows idempotently', async () => {
        const domain = `allowed-${crypto.randomUUID().slice(0, 8)}.test`

        const first = await database.createDomainAllow({ domain })
        const second = await database.createDomainAllow({
          domain: `https://${domain}/users/a`
        })

        expect(second.id).toBe(first.id)
        await expect(
          database.getDomainAllowForDomain(domain)
        ).resolves.toMatchObject({ id: first.id })
        await expect(
          database.getDomainAllowForDomain(`sub.${domain}`)
        ).resolves.toBeNull()

        await expect(
          database.deleteDomainAllow(first.id)
        ).resolves.toMatchObject({
          id: first.id
        })
        await expect(database.getDomainAllowById(first.id)).resolves.toBeNull()
      })

      it('imports domain blocks with create, update, and skip counts', async () => {
        const suffix = crypto.randomUUID().slice(0, 8)
        const existingDomain = `existing-${suffix}.test`
        const newDomain = `new-${suffix}.test`
        await database.createDomainBlock({
          domain: existingDomain,
          severity: 'silence',
          source: 'manual'
        })

        const result = await database.importDomainBlocks({
          blocks: [
            {
              domain: existingDomain,
              severity: 'suspend',
              source: 'oliphant-tier0'
            },
            {
              domain: newDomain,
              severity: 'suspend',
              source: 'oliphant-tier0'
            },
            {
              domain: '',
              severity: 'suspend',
              source: 'oliphant-tier0'
            }
          ]
        })

        expect(result).toEqual({ created: 1, updated: 1, skipped: 1 })
        await expect(
          database.getDomainBlockForDomain(existingDomain)
        ).resolves.toMatchObject({
          severity: 'suspend',
          source: 'oliphant-tier0'
        })

        await expect(
          database.getDomainFederationRuleStats()
        ).resolves.toMatchObject({
          sourceCounts: expect.objectContaining({
            'oliphant-tier0': expect.any(Number)
          })
        })
      })

      it('imports domain blocks in batches', async () => {
        const suffix = crypto.randomUUID().slice(0, 8)
        const existingDomain = `batch-existing-${suffix}.test`
        await database.createDomainBlock({
          domain: existingDomain,
          severity: 'silence',
          source: 'manual'
        })

        const result = await database.importDomainBlocks({
          blocks: [
            {
              domain: existingDomain,
              severity: 'suspend',
              source: 'oliphant-tier0'
            },
            ...Array.from({ length: 510 }, (_, index) => ({
              domain: `batch-${index}-${suffix}.test`,
              severity: 'suspend' as const,
              source: 'oliphant-tier0'
            }))
          ]
        })

        expect(result).toEqual({ created: 510, updated: 1, skipped: 0 })
        await expect(
          database.getDomainBlockForDomain(existingDomain)
        ).resolves.toMatchObject({
          severity: 'suspend',
          source: 'oliphant-tier0'
        })
      })
    })
  })
})

// Each test starts from an empty, migrated database on the backend under test.
const withFreshDatabase = async (
  test: (database: Database) => Promise<void>
) => {
  const testDb = createTestDatabase()
  await testDb.prepare()
  await testDb.database.migrate()
  try {
    await test(testDb.database)
  } finally {
    await testDb.destroy()
  }
}

describe('domain rule cursor pagination', () => {
  it('pages domain blocks forward with maxId and back with minId/sinceId', async () => {
    await withFreshDatabase(async (database) => {
      const domains = ['a.cursor.test', 'b.cursor.test', 'c.cursor.test']
      for (const domain of domains) {
        await database.createDomainBlock({ domain })
      }

      const firstPage = await database.getDomainBlocks({ limit: 2 })
      expect(firstPage.map((block) => block.domain)).toEqual([
        'a.cursor.test',
        'b.cursor.test'
      ])

      const nextPage = await database.getDomainBlocks({
        limit: 2,
        maxId: firstPage[1].id
      })
      expect(nextPage.map((block) => block.domain)).toEqual(['c.cursor.test'])

      const prevPage = await database.getDomainBlocks({
        limit: 2,
        minId: nextPage[0].id
      })
      expect(prevPage.map((block) => block.domain)).toEqual([
        'a.cursor.test',
        'b.cursor.test'
      ])

      const sincePage = await database.getDomainBlocks({
        limit: 1,
        sinceId: nextPage[0].id
      })
      expect(sincePage.map((block) => block.domain)).toEqual(['a.cursor.test'])
    })
  })

  it('pages domain allows with maxId, minId, and sinceId cursors', async () => {
    await withFreshDatabase(async (database) => {
      const domains = ['a.allow.test', 'b.allow.test', 'c.allow.test']
      for (const domain of domains) {
        await database.createDomainAllow({ domain })
      }
      const firstPage = await database.getDomainAllows({ limit: 2 })
      expect(firstPage.map((allow) => allow.domain)).toEqual([
        'a.allow.test',
        'b.allow.test'
      ])

      const nextPage = await database.getDomainAllows({
        limit: 2,
        maxId: firstPage[1].id
      })
      expect(nextPage.map((allow) => allow.domain)).toEqual(['c.allow.test'])

      // minId returns the page before the cursor in domain-ascending order
      // (the branch orders desc then reverses — a dropped reverse would surface).
      const prevPage = await database.getDomainAllows({
        limit: 2,
        minId: nextPage[0].id
      })
      expect(prevPage.map((allow) => allow.domain)).toEqual([
        'a.allow.test',
        'b.allow.test'
      ])

      const sincePage = await database.getDomainAllows({
        limit: 1,
        sinceId: nextPage[0].id
      })
      expect(sincePage.map((allow) => allow.domain)).toEqual(['a.allow.test'])
    })
  })
})

// The queries below run on a database holding only the rows each test seeds, so
// every expectation is exact and a neighbouring row the query must leave out
// would show up in it.
describe('AdminDatabase queries over seeded rows', () => {
  const testDb = createTestDatabase()
  const at = (seconds: number) =>
    new Date(Date.UTC(2024, 5, 1) + seconds * 1000)

  const insertAccount = (
    id: string,
    overrides: Partial<Insertable<Accounts>> = {}
  ) =>
    testDb.db
      .insertInto('accounts')
      .values({
        id,
        email: `${id}@${TEST_DOMAIN}`,
        passwordHash: TEST_PASSWORD_HASH,
        role: 'user',
        createdAt: at(0),
        updatedAt: at(0),
        ...overrides
      })
      .execute()

  const insertActor = (
    username: string,
    accountId: string | null,
    createdAt: Date,
    overrides: Partial<Insertable<Actors>> = {}
  ) =>
    testDb.db
      .insertInto('actors')
      .values({
        id: `https://${TEST_DOMAIN}/users/${username}`,
        username,
        domain: TEST_DOMAIN,
        accountId,
        publicKey: `public-${username}`,
        privateKey: `private-${username}`,
        publicId: generatePublicId(createdAt.getTime()),
        type: 'Person',
        createdAt,
        updatedAt: createdAt,
        ...overrides
      })
      .execute()

  const insertCounter = (id: string, value: number, bucketHour?: Date) =>
    testDb.db
      .insertInto('counters')
      .values({
        id,
        value,
        bucketHour: bucketHour ?? null,
        createdAt: at(0),
        updatedAt: at(0)
      })
      .execute()

  beforeAll(async () => {
    await testDb.prepare()
    await testDb.database.migrate()
  })

  beforeEach(async () => {
    for (const table of [
      'tags',
      'recipients',
      'statuses',
      'actors',
      'accounts',
      'counters'
    ] as const) {
      await testDb.db.deleteFrom(table).execute()
    }
  })

  afterAll(async () => {
    await testDb.destroy()
  })

  describe('getAllAccounts', () => {
    // createdAt order (c, a, d, b) differs from insertion order (a, b, c, d),
    // id order and updatedAt order (b, d, c, a descending).
    const seedAccounts = async () => {
      await insertAccount('acct-a', { createdAt: at(3), updatedAt: at(1) })
      await insertAccount('acct-b', { createdAt: at(1), updatedAt: at(4) })
      await insertAccount('acct-c', { createdAt: at(4), updatedAt: at(2) })
      await insertAccount('acct-d', { createdAt: at(2), updatedAt: at(3) })
    }

    it('returns no accounts and a zero total when there are none', async () => {
      await expect(
        testDb.database.getAllAccounts({ limit: 10, offset: 0 })
      ).resolves.toEqual({ accounts: [], total: 0 })
    })

    it('lists the newest account first and counts every account', async () => {
      await seedAccounts()

      const { accounts, total } = await testDb.database.getAllAccounts({
        limit: 10,
        offset: 0
      })

      expect(accounts.map((account) => account.id)).toEqual([
        'acct-c',
        'acct-a',
        'acct-d',
        'acct-b'
      ])
      expect(total).toBe(4)
    })

    it.each([
      { limit: 2, offset: 0, expected: ['acct-c', 'acct-a'] },
      { limit: 2, offset: 1, expected: ['acct-a', 'acct-d'] },
      { limit: 3, offset: 2, expected: ['acct-d', 'acct-b'] },
      { limit: 2, offset: 4, expected: [] }
    ])(
      'pages with limit $limit and offset $offset',
      async ({ limit, offset, expected }) => {
        await seedAccounts()

        const { accounts, total } = await testDb.database.getAllAccounts({
          limit,
          offset
        })

        expect(accounts.map((account) => account.id)).toEqual(expected)
        // The total ignores the page.
        expect(total).toBe(4)
      }
    )

    it('maps the account columns the admin views show', async () => {
      await insertAccount('acct-full', {
        email: 'full@example.test',
        name: 'Full Name',
        iconUrl: 'https://example.test/icon.png',
        role: 'admin',
        createdAt: at(10),
        updatedAt: at(20),
        verifiedAt: at(30)
      })
      await insertAccount('acct-bare', {
        email: 'bare@example.test',
        name: null,
        iconUrl: null,
        role: null,
        createdAt: at(5),
        updatedAt: at(5),
        verifiedAt: null
      })

      const { accounts } = await testDb.database.getAllAccounts({
        limit: 10,
        offset: 0
      })

      expect(accounts).toHaveLength(2)
      expect(accounts[0]).toMatchObject({
        id: 'acct-full',
        email: 'full@example.test',
        name: 'Full Name',
        iconUrl: 'https://example.test/icon.png',
        role: 'admin',
        createdAt: at(10).getTime(),
        updatedAt: at(20).getTime(),
        verifiedAt: at(30).getTime()
      })
      expect(accounts[1]).toMatchObject({
        id: 'acct-bare',
        email: 'bare@example.test',
        name: null,
        iconUrl: null,
        role: null,
        verifiedAt: null
      })
      // Columns the listing does not select stay out of the result.
      expect(accounts[0].passwordHash).toBeUndefined()
    })
  })

  describe('getAccountWithActors', () => {
    it('returns null for an account that does not exist', async () => {
      await insertAccount('acct-known')

      await expect(
        testDb.database.getAccountWithActors({ accountId: 'acct-unknown' })
      ).resolves.toBeNull()
    })

    it('returns the account and only its own actors, oldest first', async () => {
      await insertAccount('acct-a', { name: 'Account A' })
      await insertAccount('acct-b', { name: 'Account B' })
      // Inserted newest first, so only the ordering puts them right.
      await insertActor('a-second', 'acct-a', at(20))
      await insertActor('a-first', 'acct-a', at(10))
      await insertActor('a-third', 'acct-a', at(30))
      // Actors the account must not pick up: another account's, and one
      // without an account.
      await insertActor('b-first', 'acct-b', at(5))
      await insertActor('no-account', null, at(1))

      const result = await testDb.database.getAccountWithActors({
        accountId: 'acct-a'
      })

      expect(result?.account).toMatchObject({
        id: 'acct-a',
        name: 'Account A'
      })
      expect(result?.actors.map((actor) => actor.username)).toEqual([
        'a-first',
        'a-second',
        'a-third'
      ])

      const other = await testDb.database.getAccountWithActors({
        accountId: 'acct-b'
      })
      expect(other?.account.id).toBe('acct-b')
      expect(other?.actors.map((actor) => actor.username)).toEqual(['b-first'])
    })

    it('returns an account that has no actors', async () => {
      await insertAccount('acct-empty')

      const result = await testDb.database.getAccountWithActors({
        accountId: 'acct-empty'
      })

      expect(result?.account.id).toBe('acct-empty')
      expect(result?.actors).toEqual([])
    })

    it('maps actor settings and falls back when they are missing', async () => {
      await insertAccount('acct-a')
      await insertActor('configured', 'acct-a', at(10), {
        name: 'Configured',
        summary: 'About me',
        deletionStatus: 'scheduled',
        deletionScheduledAt: at(99),
        settings: JSON.stringify({
          iconUrl: 'https://example.test/icon.png',
          headerImageUrl: 'https://example.test/header.png',
          manuallyApprovesFollowers: false,
          followersUrl: 'https://example.test/followers',
          inboxUrl: 'https://example.test/inbox',
          sharedInboxUrl: 'https://example.test/shared'
        })
      })
      await insertActor('plain', 'acct-a', at(20), {
        name: null,
        summary: null,
        settings: null
      })

      const result = await testDb.database.getAccountWithActors({
        accountId: 'acct-a'
      })
      const [configured, plain] = result?.actors ?? []

      expect(configured).toMatchObject({
        id: `https://${TEST_DOMAIN}/users/configured`,
        username: 'configured',
        domain: TEST_DOMAIN,
        name: 'Configured',
        summary: 'About me',
        iconUrl: 'https://example.test/icon.png',
        headerImageUrl: 'https://example.test/header.png',
        manuallyApprovesFollowers: false,
        followersUrl: 'https://example.test/followers',
        inboxUrl: 'https://example.test/inbox',
        sharedInboxUrl: 'https://example.test/shared',
        publicKey: 'public-configured',
        createdAt: at(10).getTime(),
        updatedAt: at(10).getTime(),
        deletionStatus: 'scheduled',
        deletionScheduledAt: at(99).getTime(),
        followingCount: 0,
        followersCount: 0,
        statusCount: 0,
        lastStatusAt: null
      })
      expect(plain).toMatchObject({
        username: 'plain',
        manuallyApprovesFollowers: true,
        followersUrl: '',
        inboxUrl: '',
        sharedInboxUrl: '',
        deletionStatus: null
      })
      expect(plain.name).toBeUndefined()
      expect(plain.summary).toBeUndefined()
      expect(plain.iconUrl).toBeUndefined()
      expect(plain.deletionScheduledAt).toBeNull()
      // The private key stays out of the admin view.
      expect(configured.privateKey).toBeUndefined()
    })
  })

  describe('getServiceStats', () => {
    it('is all zeros without counters', async () => {
      await expect(testDb.database.getServiceStats()).resolves.toEqual({
        totalAccounts: 0,
        totalActors: 0,
        totalStatuses: 0,
        totalMediaFiles: 0,
        totalMediaBytes: 0,
        totalFitnessFiles: 0,
        totalFitnessBytes: 0
      })
    })

    it('reads the service totals and sums the per-account counters', async () => {
      await insertCounter('servicestat:total-accounts', 7)
      await insertCounter('servicestat:total-actors', 9)
      await insertCounter('servicestat:total-statuses', 13)

      await insertCounter('media-usage:acct-a', 100)
      await insertCounter('media-usage:acct-b', 20)
      await insertCounter('total-media:acct-a', 3)
      await insertCounter('total-media:acct-b', 4)
      await insertCounter('fitness-usage:acct-a', 40)
      await insertCounter('fitness-usage:acct-b', 2)
      await insertCounter('total-fitness:acct-a', 5)
      await insertCounter('total-fitness:acct-b', 6)

      // Rows the sums must leave out: hourly buckets, even under a matching
      // prefix, ids that only contain a prefix, and other counters.
      await insertCounter('media-usage:acct-bucket', 1000, at(0))
      await insertCounter('total-media:acct-bucket', 2000, at(0))
      await insertCounter('fitness-usage:acct-bucket', 3000, at(0))
      await insertCounter('total-fitness:acct-bucket', 4000, at(0))
      await insertCounter('bucket:media-bytes:2024060100', 5000, at(0))
      await insertCounter('x-media-usage:acct-a', 6000)
      await insertCounter('x-total-media:acct-a', 7000)
      await insertCounter('x-fitness-usage:acct-a', 8000)
      await insertCounter('x-total-fitness:acct-a', 9000)
      // Ids that start with a prefix but not with its colon.
      await insertCounter('media-usage-old:acct-a', 12_000)
      await insertCounter('total-media-old:acct-a', 13_000)
      await insertCounter('fitness-usage-old:acct-a', 14_000)
      await insertCounter('total-fitness-old:acct-a', 15_000)
      await insertCounter('total-status:acct-a', 10_000)
      await insertCounter('servicestat:other', 11_000)

      await expect(testDb.database.getServiceStats()).resolves.toEqual({
        totalAccounts: 7,
        totalActors: 9,
        totalStatuses: 13,
        totalMediaBytes: 120,
        totalMediaFiles: 7,
        totalFitnessBytes: 42,
        totalFitnessFiles: 11
      })
    })
  })

  describe('getServiceStatsBuckets', () => {
    it('returns the hours of one counter type inside the window', async () => {
      const hour = (value: number) => Date.UTC(2024, 5, 1, value)
      await incrementBucket(testDb.db, 'accounts', 2, new Date(hour(10) + 900))
      await incrementBucket(testDb.db, 'accounts', 1, new Date(hour(11) + 1))
      await incrementBucket(testDb.db, 'accounts', 3, new Date(hour(12) + 59))
      await incrementBucket(testDb.db, 'accounts', 4, new Date(hour(13)))
      await incrementBucket(testDb.db, 'actors', 5, new Date(hour(11)))

      await expect(
        testDb.database.getServiceStatsBuckets({
          counterType: 'accounts',
          startTime: hour(11),
          endTime: hour(12)
        })
      ).resolves.toEqual([
        { bucketHour: hour(11), value: 1 },
        { bucketHour: hour(12), value: 3 }
      ])
    })
  })

  describe('getAllHashtags', () => {
    const PUBLIC = ACTIVITY_STREAM_PUBLIC
    const FOLLOWERS = `https://${TEST_DOMAIN}/users/someone/followers`

    const insertStatus = async ({
      id,
      type = 'Note',
      seconds,
      recipients,
      tags
    }: {
      id: string
      type?: string
      seconds: number
      recipients: string[]
      tags: { name: string; type?: string }[]
    }) => {
      const statusId = `https://${TEST_DOMAIN}/users/someone/statuses/${id}`
      await testDb.db
        .insertInto('statuses')
        .values({
          id: statusId,
          actorId: `https://${TEST_DOMAIN}/users/someone`,
          type,
          url: statusId,
          content: id,
          createdAt: at(seconds),
          updatedAt: at(seconds)
        })
        .execute()
      for (const [index, actorId] of recipients.entries()) {
        await testDb.db
          .insertInto('recipients')
          .values({
            id: `${id}-recipient-${index}`,
            statusId,
            actorId,
            type: index === 0 ? 'to' : 'cc'
          })
          .execute()
      }
      for (const [index, tag] of tags.entries()) {
        await testDb.db
          .insertInto('tags')
          .values({
            id: `${id}-tag-${index}`,
            statusId,
            type: tag.type ?? 'hashtag',
            name: tag.name,
            nameNormalized: tag.name.toLowerCase(),
            value: `https://${TEST_DOMAIN}/tags/${tag.name}`
          })
          .execute()
      }
    }

    // Public notes and polls: apple 1 post (latest 50s), banana 3 (30s),
    // cherry 2 (40s), date 3 (30s), elder 1 (10s), jam 1 (1s). Counting by
    // name, by posts and by recency give three different orders.
    const seedHashtags = async () => {
      await insertStatus({
        id: 'p1',
        seconds: 50,
        recipients: [PUBLIC],
        tags: [{ name: '#Apple' }]
      })
      await insertStatus({
        id: 'p2',
        seconds: 40,
        recipients: [PUBLIC],
        tags: [{ name: '#Cherry' }]
      })
      // A poll, with a second public recipient row that doubles its joins.
      await insertStatus({
        id: 'p3',
        type: 'Poll',
        seconds: 30,
        recipients: [PUBLIC, PUBLIC],
        tags: [{ name: '#Banana' }, { name: '#Date' }]
      })
      // The same tag twice on one post still counts the post once.
      await insertStatus({
        id: 'p4',
        seconds: 20,
        recipients: [PUBLIC],
        tags: [
          { name: '#Banana' },
          { name: '#Banana' },
          { name: '#Date' },
          { name: '#Cherry' }
        ]
      })
      await insertStatus({
        id: 'p5',
        seconds: 10,
        recipients: [PUBLIC],
        tags: [{ name: '#Banana' }, { name: '#Date' }, { name: '#Elder' }]
      })
      // Public among its recipients, so it counts.
      await insertStatus({
        id: 'p6',
        seconds: 1,
        recipients: [FOLLOWERS, PUBLIC],
        tags: [{ name: '#Jam' }]
      })

      // Posts that must not count, all newer than every public post: not
      // public, a boost, and tags that are not hashtags.
      await insertStatus({
        id: 'x1',
        seconds: 900,
        recipients: [FOLLOWERS],
        tags: [{ name: '#Apple' }, { name: '#Banana' }, { name: '#Fig' }]
      })
      await insertStatus({
        id: 'x2',
        type: 'Announce',
        seconds: 800,
        recipients: [PUBLIC],
        tags: [{ name: '#Cherry' }, { name: '#Grape' }]
      })
      await insertStatus({
        id: 'x3',
        seconds: 700,
        recipients: [PUBLIC],
        tags: [
          { name: '@Honey@example.test', type: 'mention' },
          { name: ':Ice:', type: 'emoji' }
        ]
      })
    }

    const expected = {
      alphabetical: ['#apple', '#banana', '#cherry', '#date', '#elder', '#jam'],
      count: ['#banana', '#date', '#cherry', '#apple', '#elder', '#jam'],
      recent: ['#apple', '#cherry', '#banana', '#date', '#elder', '#jam']
    }

    it('is empty without hashtags', async () => {
      await expect(
        testDb.database.getAllHashtags({
          limit: 10,
          offset: 0,
          sort: 'alphabetical'
        })
      ).resolves.toEqual({ hashtags: [], total: 0 })
    })

    it.each(['alphabetical', 'count', 'recent'] as const)(
      'lists the hashtags of public notes and polls ordered by %s',
      async (sort) => {
        await seedHashtags()

        const { hashtags, total } = await testDb.database.getAllHashtags({
          limit: 10,
          offset: 0,
          sort
        })

        expect(hashtags.map((hashtag) => hashtag.name)).toEqual(expected[sort])
        expect(total).toBe(6)
      }
    )

    it('counts each post once and dates a hashtag by its latest public post', async () => {
      await seedHashtags()

      const { hashtags } = await testDb.database.getAllHashtags({
        limit: 10,
        offset: 0,
        sort: 'alphabetical'
      })

      expect(hashtags).toEqual([
        { name: '#apple', postCount: 1, latestPostAt: at(50).getTime() },
        { name: '#banana', postCount: 3, latestPostAt: at(30).getTime() },
        { name: '#cherry', postCount: 2, latestPostAt: at(40).getTime() },
        { name: '#date', postCount: 3, latestPostAt: at(30).getTime() },
        { name: '#elder', postCount: 1, latestPostAt: at(10).getTime() },
        { name: '#jam', postCount: 1, latestPostAt: at(1).getTime() }
      ])
    })

    it.each(['alphabetical', 'count', 'recent'] as const)(
      'pages the %s order without changing the total',
      async (sort) => {
        await seedHashtags()
        const names = async (limit: number, offset: number) => {
          const { hashtags, total } = await testDb.database.getAllHashtags({
            limit,
            offset,
            sort
          })
          expect(total).toBe(6)
          return hashtags.map((hashtag) => hashtag.name)
        }

        const all = expected[sort]
        expect(await names(2, 0)).toEqual(all.slice(0, 2))
        expect(await names(2, 2)).toEqual(all.slice(2, 4))
        expect(await names(3, 4)).toEqual(all.slice(4))
        expect(await names(10, 5)).toEqual(all.slice(5))
        expect(await names(10, 6)).toEqual([])
      }
    )
  })
})
