import crypto from 'crypto'

import {
  createSigningAccount,
  seedActorTestDatabase
} from '@/lib/database/domains/actor/actorTestHelpers'
import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import { TEST_DOMAIN } from '@/lib/stub/const'

const WINDOW = 7 * 24 * 60 * 60 * 1000

describe('ActorDatabase inbound Move claim', () => {
  const table = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  afterAll(async () => {
    await Promise.all(table.map((item) => item[1].destroy()))
  })

  describe.each(table)('%s', (_, database) => {
    beforeAll(async () => {
      await seedActorTestDatabase(database)
    })

    const newActor = async () => {
      const username = `move-${crypto.randomUUID().slice(0, 8)}`
      await createSigningAccount(database, username)
      return `https://${TEST_DOMAIN}/users/${username}`
    }

    const TARGET = 'https://newhome.test/users/a'
    const claim = (
      actorId: string,
      activityId: string,
      now: number,
      target = TARGET
    ) =>
      database.claimActorMove({
        actorId,
        activityId,
        target,
        now,
        windowMs: WINDOW
      })

    it('lets one activity claim an actor within the window', async () => {
      const actorId = await newActor()

      expect(await claim(actorId, 'a', 1000)).toBe(true)
      expect(await claim(actorId, 'b', 2000)).toBe(false)
      expect(
        (await database.getActorSettings({ actorId }))?.moveProcessing
      ).toEqual({ at: 1000, activityId: 'a', target: TARGET })
    })

    it('lets the holder claim again without moving the clock', async () => {
      const actorId = await newActor()
      await claim(actorId, 'a', 1000)

      expect(await claim(actorId, 'a', 5000)).toBe(true)
      expect(
        (await database.getActorSettings({ actorId }))?.moveProcessing?.at
      ).toBe(1000)
    })

    it('refuses the same activity id for a different target', async () => {
      const actorId = await newActor()
      await claim(actorId, 'a', 1000)

      expect(
        await claim(actorId, 'a', 2000, 'https://elsewhere.test/users/a')
      ).toBe(false)
      expect(
        (await database.getActorSettings({ actorId }))?.moveProcessing
      ).toEqual({ at: 1000, activityId: 'a', target: TARGET })
      expect(await claim(actorId, 'a', 3000)).toBe(true)
    })

    it('lets exactly one of two parallel claims win', async () => {
      const actorId = await newActor()

      const results = await Promise.all([
        claim(actorId, 'a', 1000),
        claim(actorId, 'b', 1000, 'https://elsewhere.test/users/b')
      ])

      expect(results.filter(Boolean)).toHaveLength(1)
      const held = (await database.getActorSettings({ actorId }))
        ?.moveProcessing
      expect(held?.activityId).toBe(results[0] ? 'a' : 'b')
    })

    it('expires the claim after the window', async () => {
      const actorId = await newActor()
      await claim(actorId, 'a', 1000)

      expect(await claim(actorId, 'b', 1000 + WINDOW - 1)).toBe(false)
      expect(await claim(actorId, 'b', 1000 + WINDOW)).toBe(true)
    })

    it('clears only the claim of the given activity', async () => {
      const actorId = await newActor()
      await claim(actorId, 'a', 1000)

      await database.clearActorMove({ actorId, activityId: 'b' })
      expect(await claim(actorId, 'b', 2000)).toBe(false)

      await database.clearActorMove({ actorId, activityId: 'a' })
      expect(
        (await database.getActorSettings({ actorId }))?.moveProcessing
      ).toBeUndefined()
      expect(await claim(actorId, 'b', 2000)).toBe(true)
    })

    it('does not clear a verified claim', async () => {
      const actorId = await newActor()
      await claim(actorId, 'a', 1000)
      await database.markActorMoveVerified({ actorId, activityId: 'a' })

      await database.clearActorMove({ actorId, activityId: 'a' })

      expect(
        (await database.getActorSettings({ actorId }))?.moveProcessing
      ).toMatchObject({ activityId: 'a', verified: true })
      expect(await claim(actorId, 'b', 2000)).toBe(false)
    })

    it('survives a profile update and does not claim a missing actor', async () => {
      const actorId = await newActor()
      await claim(actorId, 'a', 1000)
      await database.updateActor({ actorId, summary: 'changed' })

      expect(
        (await database.getActorSettings({ actorId }))?.moveProcessing
      ).toEqual({ at: 1000, activityId: 'a', target: TARGET })
      expect(
        await claim(`https://${TEST_DOMAIN}/users/nobody-here`, 'a', 1)
      ).toBe(false)
    })
  })
})
