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
    expect(await storage.getActorFromEmail({ email })).toMatchObject({
      id: 'https://llun.test/users/user',
      preferredUsername: username,
      account: {
        id: expect.toBeString(),
        email
      },
      publicKey,
      privateKey
    })
    expect(await storage.getActorFromUsername({ username })).toMatchObject({
      id: 'https://llun.test/users/user',
      preferredUsername: username,
      account: {
        id: expect.toBeString(),
        email
      },
      publicKey,
      privateKey
    })
    expect(
      await storage.getActorFromId({ id: 'https://llun.test/users/user' })
    ).toMatchObject({
      id: 'https://llun.test/users/user',
      preferredUsername: username,
      account: {
        id: expect.toBeString(),
        email
      },
      publicKey,
      privateKey
    })
  })
})
