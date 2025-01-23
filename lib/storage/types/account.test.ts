import {
  TEST_DOMAIN,
  TEST_EMAIL2,
  TEST_PASSWORD_HASH,
  TEST_USERNAME2
} from '@/lib/stub/const'

import {
  TestStorageTable,
  getTestStorageTable,
  storageBeforeAll
} from '../utils'

describe('AccountStorage', () => {
  const table: TestStorageTable = getTestStorageTable()

  beforeAll(async () => {
    await storageBeforeAll(table)
  })

  afterAll(async () => {
    await Promise.all(table.map((item) => item[1].destroy()))
  })

  describe.each(table)('%s', (_, storage) => {
    it('returns false when account is not created yet', async () => {
      expect(await storage.isAccountExists({ email: TEST_EMAIL2 })).toBeFalse()
      expect(
        await storage.isUsernameExists({
          username: TEST_USERNAME2,
          domain: TEST_DOMAIN
        })
      ).toBeFalse()
    })

    it('creates account and actor', async () => {
      await storage.createAccount({
        email: TEST_EMAIL2,
        username: TEST_USERNAME2,
        passwordHash: TEST_PASSWORD_HASH,
        domain: TEST_DOMAIN,
        privateKey: 'privateKey2',
        publicKey: 'publicKey2'
      })
      const actor = await storage.getMastodonActorFromUsername({
        username: TEST_USERNAME2,
        domain: TEST_DOMAIN
      })

      expect(await storage.isAccountExists({ email: TEST_EMAIL2 })).toBeTrue()
      expect(
        await storage.isUsernameExists({
          username: TEST_USERNAME2,
          domain: TEST_DOMAIN
        })
      ).toBeTrue()
      expect(actor).toMatchObject({
        id: `https://${TEST_DOMAIN}/users/${TEST_USERNAME2}`,
        username: TEST_USERNAME2,
        acct: `${TEST_USERNAME2}@${TEST_DOMAIN}`,
        url: `https://${TEST_DOMAIN}/users/${TEST_USERNAME2}`,
        display_name: '',
        note: '',
        avatar: '',
        avatar_static: '',
        header: '',
        header_static: '',
        locked: false,
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
  })
})
