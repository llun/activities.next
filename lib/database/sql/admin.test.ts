import crypto from 'crypto'

import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { seedDatabase } from '@/lib/stub/database'
import { DatabaseSeed } from '@/lib/stub/scenarios/database'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

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

      it('sorts alphabetically', async () => {
        const { hashtags } = await database.getAllHashtags({
          limit: 100,
          offset: 0,
          sort: 'alphabetical'
        })
        const names = hashtags.map((h) => h.name)
        expect(names).toEqual([...names].sort())
      })

      it('sorts by count descending', async () => {
        const { hashtags } = await database.getAllHashtags({
          limit: 100,
          offset: 0,
          sort: 'count'
        })
        const counts = hashtags.map((h) => h.postCount)
        expect(counts).toEqual([...counts].sort((a, b) => b - a))
      })

      it('sorts by most recent activity descending', async () => {
        const { hashtags } = await database.getAllHashtags({
          limit: 100,
          offset: 0,
          sort: 'recent'
        })
        const times = hashtags
          .map((h) => h.latestPostAt ?? 0)
          .filter((t) => t > 0)
        expect(times).toEqual([...times].sort((a, b) => b - a))
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
          database.getDomainBlockForDomain(`sub.${domain}`)
        ).resolves.toMatchObject({ id: block.id })

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

      it('matches the most specific domain rule in SQL', async () => {
        const suffix = crypto.randomUUID().slice(0, 8)
        const parentDomain = `parent-${suffix}.test`
        const childDomain = `sub.${parentDomain}`
        const parent = await database.createDomainBlock({
          domain: parentDomain,
          severity: 'silence'
        })
        const child = await database.createDomainBlock({
          domain: childDomain,
          severity: 'suspend'
        })

        await expect(
          database.getDomainBlockForDomain(`deep.${childDomain}`)
        ).resolves.toMatchObject({ id: child.id })
        await expect(
          database.getDomainBlockForDomain(parentDomain)
        ).resolves.toMatchObject({ id: parent.id })
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
          database.getDomainAllowForDomain(`sub.${domain}`)
        ).resolves.toMatchObject({ id: first.id })

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
    })
  })
})
