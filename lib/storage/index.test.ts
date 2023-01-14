import { deliverTo, isFollowerId } from '.'
import { Actor } from '../models/actor'
import { seedActor1 } from '../stub/seed/actor1'
import { seedStorage } from '../stub/storage'
import { Sqlite3Storage } from './sqlite3'

jest.mock('../config')

describe('#isFollowerId', () => {
  it('returns true when id ends with followers', () => {
    expect(isFollowerId('https://llun.test/users/null/followers')).toBeTruthy()
  })

  it('returns false when id is not followers', () => {
    expect(isFollowerId('https://llun.test/users/null')).toBeFalsy()
  })
})

describe('#deliverTo', () => {
  const storage = new Sqlite3Storage({
    client: 'sqlite3',
    useNullAsDefault: true,
    connection: {
      filename: ':memory:'
    }
  })
  let actor1: Actor | undefined

  beforeAll(async () => {
    await storage.migrate()
    await seedStorage(storage)
    actor1 = await storage.getActorFromUsername({
      username: seedActor1.username,
      domain: seedActor1.domain
    })
  })

  afterAll(async () => {
    await storage.destroy()
  })

  it('concats to and cc to single list', async () => {
    if (!actor1) fail('Actor1 is required')
    expect(
      await deliverTo({
        from: 'https://llun.dev/users/other-server',
        to: ['as:Public'],
        cc: [actor1.id],
        storage
      })
    ).toEqual(['as:Public', actor1.id])
  })

  it('remove non-existing users from the list except public', async () => {
    if (!actor1) fail('Actor1 is required')
    expect(
      await deliverTo({
        from: 'https://llun.dev/users/other-server',
        to: ['as:Public', actor1?.id],
        cc: [
          'https://llun.test/users/non-existing',
          'https://other.federate/users/someone'
        ],
        storage
      })
    ).toEqual(['as:Public', actor1.id])
  })
  it('spread the followers and returns only users that exists in the system', async () => {
    expect(
      await deliverTo({
        from: 'https://llun.dev/users/other-server',
        to: ['as:Public', 'https://llun.dev/users/test1'],
        cc: ['https://llun.dev/users/test1/followers'],
        storage
      })
    ).toEqual(['as:Public', actor1?.id])
  })

  it('includes from if it is the same network', async () => {
    if (!actor1) fail('Actor1 is required')
    expect(
      await deliverTo({
        from: actor1.id,
        to: ['as:Public', 'https://llun.dev/users/test1'],
        cc: [],
        storage
      })
    ).toContainAllValues(['as:Public', actor1?.id])
  })
})
