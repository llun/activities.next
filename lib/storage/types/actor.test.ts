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

    describe('deprecated actor', () => {
      it('returns actor from id', async () => {
        const id = `https://${TEST_DOMAIN}/users/${TEST_USERNAME}`
        const actor = await storage.getActorFromId({
          id
        })

        expect(actor).toMatchObject({
          id,
          username: TEST_USERNAME,
          domain: TEST_DOMAIN,
          account: {
            id: expect.toBeString(),
            email: TEST_EMAIL
          },
          followersUrl: `${id}/followers`,
          publicKey: expect.toBeString(),
          privateKey: expect.toBeString()
        })
      })

      it('returns actor from username', async () => {
        const actor = await storage.getActorFromUsername({
          username: TEST_USERNAME,
          domain: TEST_DOMAIN
        })

        expect(actor).toMatchObject({
          id: `https://${TEST_DOMAIN}/users/${TEST_USERNAME}`,
          username: TEST_USERNAME,
          domain: TEST_DOMAIN,
          account: {
            id: expect.toBeString(),
            email: TEST_EMAIL
          },
          followersUrl: `https://${TEST_DOMAIN}/users/${TEST_USERNAME}/followers`,
          publicKey: expect.toBeString(),
          privateKey: expect.toBeString()
        })
      })

      it('returns actor from email', async () => {
        const actor = await storage.getActorFromEmail({
          email: TEST_EMAIL
        })

        expect(actor).toMatchObject({
          id: `https://${TEST_DOMAIN}/users/${TEST_USERNAME}`,
          username: TEST_USERNAME,
          domain: TEST_DOMAIN,
          account: {
            id: expect.toBeString(),
            email: TEST_EMAIL
          },
          followersUrl: `https://${TEST_DOMAIN}/users/${TEST_USERNAME}/followers`,
          publicKey: expect.toBeString(),
          privateKey: expect.toBeString()
        })
      })
    })

    describe('mastodon actor', () => {
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

      it('returns mastodon actor from username', async () => {
        const actor = await storage.getMastodonActorFromUsername({
          username: TEST_USERNAME,
          domain: TEST_DOMAIN
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

      it('returns mastodon actor from email', async () => {
        const actor = await storage.getMastodonActorFromEmail({
          email: TEST_EMAIL
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
})
