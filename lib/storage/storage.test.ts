import { FollowStatus } from '../models/follow'
import { generateKeyPair } from '../signature'
import { Sqlite3Storage } from './sqlite3'
import { Storage } from './types'

jest.mock('../config', () => ({
  getConfig: () => ({ host: 'llun.test', secretPhase: 'secret' })
}))

describe('Storage', () => {
  const storages: Storage[] = []

  beforeAll(async () => {
    const sqliteStorage = new Sqlite3Storage({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: {
        filename: ':memory:'
      }
    })
    await sqliteStorage.migrate()
    storages.push(sqliteStorage)
  })

  afterAll(async () => {
    const storage = storages[0] as Sqlite3Storage
    await storage.database.destroy()
  })

  it('runs storage story', async () => {
    const storage = storages[0]
    const email = 'user@llun.dev'
    const username = 'user'
    const id = 'https://llun.test/users/user'
    const targetFollowId = 'https://llun.dev/users/null'

    expect(await storage.isAccountExists({ email })).toBeFalse()
    expect(await storage.isUsernameExists({ username })).toBeFalse()

    const { privateKey, publicKey } = await generateKeyPair()
    await storage.createAccount({
      email,
      username,
      privateKey,
      publicKey
    })
    expect(await storage.isAccountExists({ email })).toBeTrue()
    expect(await storage.isUsernameExists({ username })).toBeTrue()

    const expectedActorAfterCreated = {
      id,
      preferredUsername: username,
      account: {
        id: expect.toBeString(),
        email
      },
      publicKey,
      privateKey
    }
    expect(await storage.getActorFromEmail({ email })).toMatchObject(
      expectedActorAfterCreated
    )
    expect(await storage.getActorFromUsername({ username })).toMatchObject(
      expectedActorAfterCreated
    )
    expect(await storage.getActorFromId({ id })).toMatchObject(
      expectedActorAfterCreated
    )

    const currentActor = await storage.getActorFromUsername({ username })
    if (!currentActor) fail('Current actor must not be null')

    await storage.updateActor({
      actor: {
        ...currentActor,
        name: 'llun',
        summary: 'This is test actor'
      }
    })

    expect(await storage.getActorFromUsername({ username })).toMatchObject({
      name: 'llun',
      summary: 'This is test actor'
    })

    expect(await storage.getActorFollowersCount({ actorId: id })).toEqual(0)
    expect(await storage.getActorFollowingCount({ actorId: id })).toEqual(0)
    expect(await storage.getFollowersHosts({ targetActorId: id })).toEqual([])
    expect(await storage.getFollowersInbox({ targetActorId: id })).toEqual([])

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
