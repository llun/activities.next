import {
  TEST_DOMAIN,
  TEST_EMAIL,
  TEST_PASSWORD_HASH,
  TEST_USERNAME
} from '@/lib/stub/const'

import { FirestoreStorage } from '../firestore'
import { SqlStorage } from '../sql'
import { Storage } from '../types'
import { AccountStorage } from './acount'
import { ActorStorage } from './actor'

type AccountAndActorStorage = AccountStorage & ActorStorage
type TestStorage = [string, AccountAndActorStorage]

describe('ActorStorage', () => {
  const testTable: TestStorage[] = [
    [
      'sqlite',
      new SqlStorage({
        client: 'better-sqlite3',
        useNullAsDefault: true,
        connection: {
          filename: ':memory:'
        }
      })
    ],
    // Enable this when run start:firestore emulator and clear the database manually
    [
      'firestore',
      new FirestoreStorage({
        type: 'firebase',
        projectId: 'test',
        host: 'localhost:8080',
        ssl: false
      })
    ]
  ]

  beforeAll(async () => {
    const sqlItem = testTable.find((value) => value[0] === 'sqlite')
    if (sqlItem) await (sqlItem[1] as SqlStorage).migrate()
  })

  afterAll(async () => {
    for (const item of testTable) {
      const storage = item[1] as Storage
      await storage.destroy()
    }
  })

  describe.each(testTable)('%s', (name, storage) => {
    beforeAll(async () => {
      await storage.createAccount({
        email: TEST_EMAIL,
        username: TEST_USERNAME,
        passwordHash: TEST_PASSWORD_HASH,
        domain: TEST_DOMAIN,
        privateKey: 'privateKey1',
        publicKey: 'publicKey1'
      })
    })

    it('returns mastodon actor from id', async () => {
      const actor = await storage.getMastodonActorFromId({
        id: `https://${TEST_DOMAIN}/users/${TEST_USERNAME}`
      })

      expect(actor).toMatchObject({
        id: `https://${TEST_DOMAIN}/users/${TEST_USERNAME}`,
        username: TEST_USERNAME,
        acct: `${TEST_USERNAME}@${TEST_DOMAIN}`,
        url: `https://${TEST_DOMAIN}/@${TEST_USERNAME}`,
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
