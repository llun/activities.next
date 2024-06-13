import { FollowStatus } from '@/lib/models/follow'
import {
  TEST_DOMAIN,
  TEST_EMAIL,
  TEST_PASSWORD_HASH,
  TEST_USERNAME,
  TEST_USERNAME2,
  TEST_USERNAME3,
  testUserId
} from '@/lib/stub/const'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR4_ID } from '@/lib/stub/seed/actor4'
import { ACTOR6_ID } from '@/lib/stub/seed/actor6'
import { seedStorage } from '@/lib/stub/storage'

import { FirestoreStorage } from '../firestore'
import { SqlStorage } from '../sql'
import { Storage } from '../types'
import { AccountStorage } from './acount'
import { ActorStorage } from './actor'
import { FollowerStorage } from './follower'

type AccountAndFollowerStorage = AccountStorage & ActorStorage & FollowerStorage
type TestStorage = [string, AccountAndFollowerStorage]

describe('FollowerStorage', () => {
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
      await seedStorage(storage as Storage)
    })

    it('returns empty followers and following for empty actor', async () => {
      const actor = await storage.getMastodonActorFromId({ id: ACTOR6_ID })
      expect(actor).toMatchObject({
        followers_count: 0,
        following_count: 0
      })
      expect(
        await storage.getActorFollowersCount({ actorId: ACTOR6_ID })
      ).toEqual(0)
      expect(
        await storage.getActorFollowingCount({ actorId: ACTOR6_ID })
      ).toEqual(0)
      expect(
        await storage.getFollowersInbox({ targetActorId: ACTOR6_ID })
      ).toEqual([])
    })

    it('returns followers and following count in mastodon actor', async () => {
      const actor = await storage.getMastodonActorFromId({ id: ACTOR1_ID })
      expect(actor).toMatchObject({
        followers_count: 1,
        following_count: 2
      })
      expect(
        await storage.getActorFollowersCount({ actorId: ACTOR1_ID })
      ).toEqual(1)
      expect(
        await storage.getActorFollowingCount({ actorId: ACTOR1_ID })
      ).toEqual(2)
      expect(
        await storage.getFollowersInbox({ targetActorId: ACTOR1_ID })
      ).toEqual(['https://somewhere.test/inbox'])
    })
  })
})
