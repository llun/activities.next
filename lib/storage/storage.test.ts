import { FollowStatus } from '../models/follow'
import { generateKeyPair } from '../signature'
import { FirebaseStorage } from './firebase'
import { Sqlite3Storage } from './sqlite3'
import { Storage } from './types'

jest.mock('../config', () => ({
  getConfig: () => ({ host: 'llun.test', secretPhase: 'secret' })
}))

const TEST_EMAIL = 'user@llun.dev'
const TEST_USERNAME = 'user'
const TEST_ID = 'https://llun.test/users/user'

const TEST_EMAIL2 = 'user2@llun.dev'
const TEST_USERNAME2 = 'user2'

const TEST_EMAIL3 = 'user3@llun.dev'
const TEST_USERNAME3 = 'user3'
const TEST_ID3 = 'https://llun.test/users/user3'
const TEST_FOLLOW_ID = 'https://llun.dev/users/null'

describe('Storage', () => {
  const storages: Storage[] = []

  beforeAll(async () => {
    const sqliteStorage = new Sqlite3Storage({
      client: 'sqlite3',
      useNullAsDefault: true,
      connection: {
        filename: ':memory:'
      }
    })
    await sqliteStorage.migrate()
    storages.push(sqliteStorage)

    // const firebaseStorage = new FirebaseStorage({
    //   type: 'firebase',
    //   projectId: 'test'
    // })
    // await firebaseStorage.connectEmulator()
    // storages.push(firebaseStorage)

    for (const storage of storages) {
      const { privateKey: privateKey1, publicKey: publicKey1 } =
        await generateKeyPair()
      await storage.createAccount({
        email: TEST_EMAIL,
        username: TEST_USERNAME,
        privateKey: privateKey1,
        publicKey: publicKey1
      })
      const { privateKey: privateKey2, publicKey: publicKey2 } =
        await generateKeyPair()
      await storage.createAccount({
        email: TEST_EMAIL3,
        username: TEST_USERNAME3,
        privateKey: privateKey2,
        publicKey: publicKey2
      })
    }
  })

  afterAll(async () => {
    const storage = storages[0] as Sqlite3Storage
    await storage.database.destroy()
  })

  describe('accounts', () => {
    it('returns false when account is not created yet', async () => {
      for (const storage of storages) {
        expect(
          await storage.isAccountExists({ email: TEST_EMAIL2 })
        ).toBeFalse()
        expect(
          await storage.isUsernameExists({ username: TEST_USERNAME2 })
        ).toBeFalse()
      }
    })

    it('creates account and actor', async () => {
      for (const storage of storages) {
        const { privateKey, publicKey } = await generateKeyPair()
        await storage.createAccount({
          email: TEST_EMAIL2,
          username: TEST_USERNAME2,
          privateKey,
          publicKey
        })
        expect(await storage.isAccountExists({ email: TEST_EMAIL2 })).toBeTrue()
        expect(
          await storage.isUsernameExists({ username: TEST_USERNAME2 })
        ).toBeTrue()
      }
    })

    it('returns actor from getActor methods', async () => {
      for (const storage of storages) {
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
      }
    })

    it('updates actor information', async () => {
      for (const storage of storages) {
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
      }
    })
  })

  describe('follows', () => {
    it('returns empty followers and following', async () => {
      for (const storage of storages) {
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
      }
    })
  })

  it.skip('runs storage story', async () => {
    const storage = storages[0]
    const email = 'user@llun.dev'
    const username = 'user'
    const id = 'https://llun.test/users/user'
    const targetFollowId = 'https://llun.dev/users/null'

    const currentActor = await storage.getActorFromUsername({ username })
    if (!currentActor) fail('Current actor must not be null')

    const follow = await storage.createFollow({
      actorId: id,
      targetActorId: 'https://llun.dev/users/null',
      status: FollowStatus.Requested,
      inbox: 'https://llun.dev/users/null/inbox',
      sharedInbox: 'https://llun.dev/inbox'
    })
    expect(follow).toEqual({
      actorHost: 'llun.test',
      actorId: 'https://llun.test/users/user',
      createdAt: expect.toBeNumber(),
      id: expect.toBeString(),
      inbox: 'https://llun.dev/users/null/inbox',
      sharedInbox: 'https://llun.dev/inbox',
      status: FollowStatus.Requested,
      targetActorHost: 'llun.dev',
      targetActorId: 'https://llun.dev/users/null',
      updatedAt: expect.toBeNumber()
    })

    expect(await storage.getActorFollowersCount({ actorId: id })).toEqual(0)
    expect(await storage.getActorFollowingCount({ actorId: id })).toEqual(0)
    expect(await storage.getFollowersHosts({ targetActorId: id })).toEqual([])
    expect(await storage.getFollowersInbox({ targetActorId: id })).toEqual([])
    expect(
      await storage.getAcceptedOrRequestedFollow({
        actorId: id,
        targetActorId: 'https://llun.dev/users/null'
      })
    ).toEqual({
      actorHost: 'llun.test',
      actorId: 'https://llun.test/users/user',
      createdAt: expect.toBeNumber(),
      id: expect.toBeString(),
      inbox: 'https://llun.dev/users/null/inbox',
      sharedInbox: 'https://llun.dev/inbox',
      status: FollowStatus.Requested,
      targetActorHost: 'llun.dev',
      targetActorId: 'https://llun.dev/users/null',
      updatedAt: expect.toBeNumber()
    })

    expect(
      await storage.createFollow({
        actorId: id,
        targetActorId: 'https://llun.dev/users/null',
        status: FollowStatus.Requested,
        inbox: 'https://llun.dev/users/null/inbox',
        sharedInbox: 'https://llun.dev/inbox'
      })
    ).toEqual(follow)

    await storage.updateFollowStatus({
      followId: follow.id,
      status: FollowStatus.Rejected
    })

    expect(
      await storage.getActorFollowersCount({ actorId: targetFollowId })
    ).toEqual(0)
    expect(await storage.getActorFollowingCount({ actorId: id })).toEqual(0)
    expect(
      await storage.getFollowersHosts({ targetActorId: targetFollowId })
    ).toEqual([])
    expect(
      await storage.getFollowersInbox({ targetActorId: targetFollowId })
    ).toEqual([])

    await storage.updateFollowStatus({
      followId: follow.id,
      status: FollowStatus.Accepted
    })

    expect(await storage.getActorFollowersCount({ actorId: id })).toEqual(0)
    expect(await storage.getActorFollowingCount({ actorId: id })).toEqual(1)
    expect(
      await storage.getFollowersHosts({ targetActorId: targetFollowId })
    ).toEqual(['llun.test'])
    expect(
      await storage.getFollowersInbox({ targetActorId: targetFollowId })
    ).toEqual(['https://llun.dev/inbox'])

    await storage.createFollow({
      actorId: targetFollowId,
      targetActorId: id,
      status: FollowStatus.Accepted,
      inbox: 'https://llun.test/users/users/inbox',
      sharedInbox: 'https://llun.test/inbox'
    })
    expect(await storage.getActorFollowersCount({ actorId: id })).toEqual(1)
    expect(await storage.getActorFollowingCount({ actorId: id })).toEqual(1)
    expect(await storage.getFollowersHosts({ targetActorId: id })).toEqual([
      'llun.dev'
    ])
    expect(await storage.getFollowersInbox({ targetActorId: id })).toEqual([
      'https://llun.test/inbox'
    ])
  })
})
