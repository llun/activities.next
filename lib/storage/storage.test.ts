import { FollowStatus } from '../models/follow'
import { FirebaseStorage } from './firebase'
import { Sqlite3Storage } from './sqlite3'
import { Storage } from './types'

jest.mock('../config', () => ({
  getConfig: () => ({ host: 'llun.test', secretPhase: 'secret' })
}))

// For testing existing user
const TEST_EMAIL = 'user@llun.dev'
const TEST_USERNAME = 'user'
const TEST_ID = 'https://llun.test/users/user'

// For testing create new account
const TEST_EMAIL2 = 'user2@llun.dev'
const TEST_USERNAME2 = 'user2'

// User that follow other without any followers
const TEST_EMAIL3 = 'user3@llun.dev'
const TEST_USERNAME3 = 'user3'
const TEST_ID3 = 'https://llun.test/users/user3'

// User that get someone follow them
const TEST_EMAIL4 = 'user4@llun.dev'
const TEST_USERNAME4 = 'user4'
const TEST_ID4 = 'https://llun.test/users/user4'

type TestStorage = [string, Storage]

describe('Storage', () => {
  const testTable: TestStorage[] = [
    [
      'sqlite',
      new Sqlite3Storage({
        client: 'sqlite3',
        useNullAsDefault: true,
        connection: {
          filename: ':memory:'
        }
      })
    ],
    // Enable this when run start:firestore emulator and clear the database manually
    [
      'firestore',
      new FirebaseStorage({
        type: 'firebase',
        projectId: 'test'
      })
    ]
  ]

  beforeAll(async () => {
    const sqlItem = testTable.find((value) => value[0] === 'sqlite')
    if (sqlItem) await (sqlItem[1] as Sqlite3Storage).migrate()

    const firestoreItem = testTable.find((value) => value[0] === 'firestore')
    if (firestoreItem)
      await (firestoreItem[1] as FirebaseStorage).connectEmulator()
  })

  afterAll(async () => {
    for (const item of testTable) {
      const storage = item[1]
      await storage.destroy()
    }
  })

  describe.each(testTable)(`%s`, (name, storage) => {
    beforeAll(async () => {
      await storage.createAccount({
        email: TEST_EMAIL,
        username: TEST_USERNAME,
        privateKey: 'privateKey1',
        publicKey: 'publicKey1'
      })
      await storage.createAccount({
        email: TEST_EMAIL3,
        username: TEST_USERNAME3,
        privateKey: 'privateKey3',
        publicKey: 'publicKey3'
      })
      await storage.createAccount({
        email: TEST_EMAIL4,
        username: TEST_USERNAME4,
        privateKey: 'privateKey4',
        publicKey: 'publicKey4'
      })
    })

    describe('accounts', () => {
      it('returns false when account is not created yet', async () => {
        expect(
          await storage.isAccountExists({ email: TEST_EMAIL2 })
        ).toBeFalse()
        expect(
          await storage.isUsernameExists({ username: TEST_USERNAME2 })
        ).toBeFalse()
      })

      it('creates account and actor', async () => {
        await storage.createAccount({
          email: TEST_EMAIL2,
          username: TEST_USERNAME2,
          privateKey: 'privateKey2',
          publicKey: 'publicKey2'
        })
        expect(await storage.isAccountExists({ email: TEST_EMAIL2 })).toBeTrue()
        expect(
          await storage.isUsernameExists({ username: TEST_USERNAME2 })
        ).toBeTrue()
      })

      it('returns actor from getActor methods', async () => {
        const expectedActorAfterCreated = {
          id: TEST_ID,
          preferredUsername: TEST_USERNAME,
          account: {
            id: expect.toBeString(),
            email: TEST_EMAIL
          },
          publicKey: expect.toBeString(),
          privateKey: expect.toBeString()
        }
        expect(
          await storage.getActorFromEmail({ email: TEST_EMAIL })
        ).toMatchObject(expectedActorAfterCreated)
        expect(
          await storage.getActorFromUsername({ username: TEST_USERNAME })
        ).toMatchObject(expectedActorAfterCreated)
        expect(await storage.getActorFromId({ id: TEST_ID })).toMatchObject(
          expectedActorAfterCreated
        )
      })

      it('updates actor information', async () => {
        const currentActor = await storage.getActorFromUsername({
          username: TEST_USERNAME
        })
        if (!currentActor) fail('Current actor must not be null')

        await storage.updateActor({
          actor: {
            ...currentActor,
            name: 'llun',
            summary: 'This is test actor'
          }
        })

        expect(
          await storage.getActorFromUsername({ username: TEST_USERNAME })
        ).toMatchObject({
          name: 'llun',
          summary: 'This is test actor'
        })
      })
    })

    describe('follows', () => {
      it('returns empty followers and following', async () => {
        expect(
          await storage.getActorFollowersCount({ actorId: TEST_ID })
        ).toEqual(0)
        expect(
          await storage.getActorFollowingCount({ actorId: TEST_ID })
        ).toEqual(0)
        expect(
          await storage.getFollowersHosts({ targetActorId: TEST_ID })
        ).toEqual([])
        expect(
          await storage.getFollowersInbox({ targetActorId: TEST_ID })
        ).toEqual([])
      })

      it('following other actor', async () => {
        const targetActorHost = 'llun.dev'
        const targetActorId = 'https://llun.dev/users/null'
        const inbox = `${TEST_ID3}/inbox`
        const sharedInbox = 'https://llun.test/inbox'

        const follow = await storage.createFollow({
          actorId: TEST_ID3,
          targetActorId,
          status: FollowStatus.Requested,
          // Inbox is always for actor, not targetActor
          inbox,
          sharedInbox
        })
        expect(follow).toEqual({
          actorHost: 'llun.test',
          actorId: TEST_ID3,
          createdAt: expect.toBeNumber(),
          id: expect.toBeString(),
          inbox,
          sharedInbox,
          status: FollowStatus.Requested,
          targetActorHost,
          targetActorId,
          updatedAt: expect.toBeNumber()
        })

        expect(
          await storage.getAcceptedOrRequestedFollow({
            actorId: TEST_ID3,
            targetActorId: 'https://llun.dev/users/null'
          })
        ).toEqual({
          actorHost: 'llun.test',
          actorId: TEST_ID3,
          createdAt: expect.toBeNumber(),
          id: follow.id,
          inbox,
          sharedInbox,
          status: FollowStatus.Requested,
          targetActorHost,
          targetActorId,
          updatedAt: expect.toBeNumber()
        })

        expect(
          await storage.getActorFollowingCount({ actorId: TEST_ID3 })
        ).toEqual(0)

        await storage.updateFollowStatus({
          followId: follow.id,
          status: FollowStatus.Rejected
        })
        expect(
          await storage.getAcceptedOrRequestedFollow({
            actorId: TEST_ID3,
            targetActorId
          })
        ).toBeUndefined()

        const secondFollow = await storage.createFollow({
          actorId: TEST_ID3,
          targetActorId,
          status: FollowStatus.Requested,
          inbox,
          sharedInbox
        })
        expect(secondFollow.id).not.toEqual(follow.id)
        expect(
          await storage.getAcceptedOrRequestedFollow({
            actorId: TEST_ID3,
            targetActorId
          })
        ).toEqual({
          actorHost: 'llun.test',
          actorId: TEST_ID3,
          createdAt: expect.toBeNumber(),
          id: secondFollow.id,
          inbox,
          sharedInbox,
          status: FollowStatus.Requested,
          targetActorHost,
          targetActorId,
          updatedAt: expect.toBeNumber()
        })

        await storage.updateFollowStatus({
          followId: secondFollow.id,
          status: FollowStatus.Accepted
        })
        const secondFollowAfterUpdated =
          await storage.getAcceptedOrRequestedFollow({
            actorId: TEST_ID3,
            targetActorId
          })
        expect(secondFollowAfterUpdated).toEqual({
          actorHost: 'llun.test',
          actorId: TEST_ID3,
          createdAt: expect.toBeNumber(),
          id: secondFollow.id,
          inbox,
          sharedInbox,
          status: FollowStatus.Accepted,
          targetActorHost,
          targetActorId,
          updatedAt: expect.toBeNumber()
        })
        expect(secondFollowAfterUpdated?.updatedAt).not.toEqual(
          secondFollow.updatedAt
        )

        expect(
          await storage.getActorFollowingCount({ actorId: TEST_ID3 })
        ).toEqual(1)

        expect(await storage.getFollowersHosts({ targetActorId })).toEqual([
          'llun.test'
        ])
        expect(await storage.getFollowersInbox({ targetActorId })).toEqual([
          sharedInbox
        ])
      })

      it('gets other actor follow (follower)', async () => {
        const actorId = 'https://llun.dev/users/test2'
        const inbox = `${actorId}/inbox`
        const sharedInbox = 'https://llun.dev/inbox'

        await storage.createFollow({
          actorId,
          targetActorId: TEST_ID4,
          status: FollowStatus.Accepted,
          inbox,
          sharedInbox
        })
        expect(
          await storage.getActorFollowersCount({ actorId: TEST_ID4 })
        ).toEqual(1)

        expect(
          await storage.getFollowersHosts({ targetActorId: TEST_ID4 })
        ).toEqual(['llun.dev'])
        expect(
          await storage.getFollowersInbox({ targetActorId: TEST_ID4 })
        ).toEqual([sharedInbox])
      })
    })

    describe('statuses', () => {
      it('creates a new status', async () => {
        const postId = 'post-1'
        const id = `${TEST_ID}/statuses/${postId}`

        const status = await storage.createStatus({
          id,
          url: id,
          actorId: TEST_ID,
          type: 'Note',

          text: 'Test Status',
          to: ['https://www.w3.org/ns/activitystreams#Public'],
          cc: [],
          localRecipients: ['as:Public']
        })
        expect(status).toEqual({
          id,
          url: id,
          actorId: TEST_ID,
          type: 'Note',

          text: 'Test Status',
          summary: '',
          to: ['https://www.w3.org/ns/activitystreams#Public'],
          cc: [],
          localRecipients: ['as:Public'],
          reply: '',
          createdAt: expect.toBeNumber(),
          updatedAt: expect.toBeNumber()
        })
      })
    })
  })
})
