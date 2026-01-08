import {
  TestDatabaseTable,
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import {
  TEST_DOMAIN,
  TEST_EMAIL2,
  TEST_PASSWORD_HASH,
  TEST_USERNAME2
} from '@/lib/stub/const'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { urlToId } from '@/lib/utils/urlToId'

describe('AccountDatabase', () => {
  const table: TestDatabaseTable = getTestDatabaseTable()

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

    it('returns false when account is not created yet', async () => {
      expect(await database.isAccountExists({ email: TEST_EMAIL2 })).toBeFalse()
      expect(
        await database.isUsernameExists({
          username: TEST_USERNAME2,
          domain: TEST_DOMAIN
        })
      ).toBeFalse()
    })

    it('creates account and actor', async () => {
      await database.createAccount({
        email: TEST_EMAIL2,
        username: TEST_USERNAME2,
        passwordHash: TEST_PASSWORD_HASH,
        domain: TEST_DOMAIN,
        privateKey: 'privateKey2',
        publicKey: 'publicKey2'
      })
      const actor = await database.getMastodonActorFromUsername({
        username: TEST_USERNAME2,
        domain: TEST_DOMAIN
      })

      expect(await database.isAccountExists({ email: TEST_EMAIL2 })).toBeTrue()
      expect(
        await database.isUsernameExists({
          username: TEST_USERNAME2,
          domain: TEST_DOMAIN
        })
      ).toBeTrue()
      expect(actor).toMatchObject({
        id: urlToId(`https://${TEST_DOMAIN}/users/${TEST_USERNAME2}`),
        username: TEST_USERNAME2,
        acct: `${TEST_USERNAME2}@${TEST_DOMAIN}`,
        url: `https://${TEST_DOMAIN}/users/${TEST_USERNAME2}`,
        display_name: '',
        note: '',
        avatar: '',
        avatar_static: '',
        header: '',
        header_static: '',
        locked: true,
        fields: [],
        emojis: [],
        bot: false,
        group: false,
        discoverable: true,
        noindex: false,
        created_at: expect.toBeString(),
        last_status_at: null,
        statuses_count: 0,
        followers_count: 0,
        following_count: 0
      })
    })

    it('returns actor from getActor methods', async () => {
      const actor = await database.getActorFromEmail({ email: TEST_EMAIL2 })
      expect(actor).toMatchObject({
        id: expect.toBeString(),
        username: TEST_USERNAME2,
        domain: TEST_DOMAIN,
        account: {
          id: expect.toBeString(),
          email: TEST_EMAIL2
        },
        followersUrl: expect.toBeString(),
        publicKey: expect.toBeString(),
        privateKey: expect.toBeString()
      })
    })

    it('returns actor from getMastodonActor methods', async () => {
      const actor = await database.getMastodonActorFromId({ id: ACTOR1_ID })
      expect(actor).toMatchObject({
        id: urlToId(ACTOR1_ID),
        username: seedActor1.username,
        acct: `${seedActor1.username}@${seedActor1.domain}`,
        url: `https://${seedActor1.domain}/users/${seedActor1.username}`,
        display_name: '',
        note: '',
        avatar: '',
        avatar_static: '',
        header: '',
        header_static: '',
        locked: true,
        fields: [],
        emojis: [],
        bot: false
      })
    })
  })
})
