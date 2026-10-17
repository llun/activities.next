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

describe('ActorDatabase profile field verification', () => {
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
      const username = `verify-${crypto.randomUUID().slice(0, 8)}`
      await createSigningAccount(database, username)
      return `https://${TEST_DOMAIN}/users/${username}`
    }

    it('keeps verifiedAt of an unchanged value and clears a changed one', async () => {
      const actorId = await newActor()
      await database.updateActor({
        actorId,
        fields: [
          { name: 'Blog', value: 'https://blog.example' },
          { name: 'Site', value: 'https://site.example' }
        ]
      })
      await database.markActorProfileFieldsVerified({
        actorId,
        values: ['https://blog.example', 'https://site.example'],
        verifiedAt: 1700000000000
      })

      await database.updateActor({
        actorId,
        fields: [
          { name: 'Blog', value: 'https://blog.example' },
          { name: 'Site', value: 'https://changed.example' }
        ]
      })

      const actor = await database.getActorFromId({ id: actorId })
      expect(actor?.fields).toEqual([
        {
          name: 'Blog',
          value: 'https://blog.example',
          verifiedAt: 1700000000000
        },
        { name: 'Site', value: 'https://changed.example' }
      ])
    })

    it('stamps only the checked values and not the updatedAt clock', async () => {
      const actorId = await newActor()
      await database.updateActor({
        actorId,
        fields: [
          { name: 'A', value: 'https://a.example' },
          { name: 'B', value: 'https://b.example' }
        ]
      })
      const before = await database.getActorFromId({ id: actorId })

      await database.markActorProfileFieldsVerified({
        actorId,
        values: ['https://a.example', 'https://gone.example'],
        verifiedAt: 1700000000000
      })

      const after = await database.getActorFromId({ id: actorId })
      expect(after?.fields).toEqual([
        { name: 'A', value: 'https://a.example', verifiedAt: 1700000000000 },
        { name: 'B', value: 'https://b.example' }
      ])
      expect(after?.updatedAt).toBe(before?.updatedAt)
    })

    it('emits verified_at as an ISO time in the Account and its source', async () => {
      const actorId = await newActor()
      await database.updateActor({
        actorId,
        fields: [
          { name: 'Blog', value: 'https://blog.example' },
          { name: 'Pronouns', value: 'they/them' }
        ]
      })
      await database.markActorProfileFieldsVerified({
        actorId,
        values: ['https://blog.example'],
        verifiedAt: Date.UTC(2026, 9, 17, 12, 30, 0)
      })

      const account = await database.getMastodonActorFromId({ id: actorId })

      expect(account?.fields.map((field) => field.verified_at)).toEqual([
        '2026-10-17T12:30:00.000Z',
        null
      ])
      expect(account?.source.fields.map((field) => field.verified_at)).toEqual([
        '2026-10-17T12:30:00.000Z',
        null
      ])
    })
  })
})
