import crypto from 'crypto'

import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'

describe('ActorDomainBlockDatabase', () => {
  const table = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  afterAll(async () => {
    await Promise.all(table.map((item) => item[1].destroy()))
  })

  describe.each(table)('%s', (_, database) => {
    const uniqueActorId = () =>
      `https://llun.test/users/domain-blocker-${crypto.randomUUID()}`
    const uniqueDomain = () => `blocked-${crypto.randomUUID()}.test`

    it('creates a domain block and reports the domain as blocked', async () => {
      const actorId = uniqueActorId()
      const domain = uniqueDomain()

      const block = await database.createActorDomainBlock({ actorId, domain })

      expect(block).toMatchObject({ actorId, domain })
      expect(block.id).toBeTruthy()
      await expect(
        database.isDomainBlockedByActor({ actorId, domain })
      ).resolves.toBe(true)
    })

    it('returns the existing row when blocking the same domain twice', async () => {
      const actorId = uniqueActorId()
      const domain = uniqueDomain()

      const first = await database.createActorDomainBlock({ actorId, domain })
      const second = await database.createActorDomainBlock({ actorId, domain })

      expect(second.id).toBe(first.id)
      await expect(
        database.getActorDomainBlocks({ actorId })
      ).resolves.toHaveLength(1)
    })

    it('scopes blocks to the blocking actor', async () => {
      const actorId = uniqueActorId()
      const otherActorId = uniqueActorId()
      const domain = uniqueDomain()

      await database.createActorDomainBlock({ actorId, domain })

      await expect(
        database.isDomainBlockedByActor({ actorId: otherActorId, domain })
      ).resolves.toBe(false)
      await expect(
        database.getActorDomainBlocks({ actorId: otherActorId })
      ).resolves.toEqual([])
    })

    it('deletes a domain block and returns the removed row', async () => {
      const actorId = uniqueActorId()
      const domain = uniqueDomain()

      const created = await database.createActorDomainBlock({
        actorId,
        domain
      })
      const deleted = await database.deleteActorDomainBlock({
        actorId,
        domain
      })

      expect(deleted?.id).toBe(created.id)
      await expect(
        database.isDomainBlockedByActor({ actorId, domain })
      ).resolves.toBe(false)
    })

    it('returns null when deleting a domain that is not blocked', async () => {
      await expect(
        database.deleteActorDomainBlock({
          actorId: uniqueActorId(),
          domain: uniqueDomain()
        })
      ).resolves.toBeNull()
    })

    it('lists blocks newest first and paginates with max_id', async () => {
      const actorId = uniqueActorId()
      const domains = ['a.test', 'b.test', 'c.test']
      for (const domain of domains) {
        await database.createActorDomainBlock({ actorId, domain })
      }

      const firstPage = await database.getActorDomainBlocks({
        actorId,
        limit: 2
      })
      expect(firstPage).toHaveLength(2)

      const secondPage = await database.getActorDomainBlocks({
        actorId,
        limit: 2,
        maxId: firstPage[firstPage.length - 1].id
      })
      expect(secondPage).toHaveLength(1)
      expect(
        [...firstPage, ...secondPage].map((block) => block.domain).sort()
      ).toEqual(domains)
    })

    it('returns every block when no limit is given', async () => {
      const actorId = uniqueActorId()
      for (let index = 0; index < 5; index++) {
        await database.createActorDomainBlock({
          actorId,
          domain: `all-${index}.test`
        })
      }

      await expect(
        database.getActorDomainBlocks({ actorId })
      ).resolves.toHaveLength(5)
    })
  })
})
