import { deliverTo, isFollowerId } from '.'
import { Note } from '../activities/entities/note'
import { compact } from '../jsonld'
import { ACTIVITY_STREAM_PUBLIC } from '../jsonld/activitystream'
import { Actor } from '../models/actor'
import { MockMastodonNote } from '../stub/note'
import { seedActor1 } from '../stub/seed/actor1'
import { seedStorage } from '../stub/storage'
import { Sqlite3Storage } from './sqlite3'

jest.mock('../config', () => ({
  __esModule: true,
  getConfig: jest.fn().mockReturnValue({
    host: 'llun.test'
  })
}))

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
      username: seedActor1.username
    })
  })

  it('concats to and cc to single list', async () => {
    if (!actor1) fail('Actor1 is required')

    const note = MockMastodonNote({
      content: 'Hello',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [actor1.id],
      withContext: true
    })
    const compactedNote = (await compact(note)) as Note
    expect(await deliverTo({ note: compactedNote, storage })).toEqual([
      'as:Public',
      actor1?.id
    ])
  })

  it('remove non-existing users from the list except public', async () => {
    if (!actor1) fail('Actor1 is required')

    const note = MockMastodonNote({
      content: 'Hello',
      to: [ACTIVITY_STREAM_PUBLIC, actor1?.id],
      cc: [
        'https://llun.test/users/non-existing',
        'https://other.federate/users/someone'
      ],
      withContext: true
    })
    const compactedNote = (await compact(note)) as Note
    expect(await deliverTo({ note: compactedNote, storage })).toEqual([
      'as:Public',
      actor1.id
    ])
  })
  it('spread the followers and returns only users that exists in the system', async () => {
    const note = MockMastodonNote({
      content: 'Hello',
      to: [ACTIVITY_STREAM_PUBLIC, 'https://llun.dev/users/test1'],
      cc: ['https://llun.dev/users/test1/followers'],
      withContext: true
    })
    const compactedNote = (await compact(note)) as Note
    expect(await deliverTo({ note: compactedNote, storage })).toEqual([
      'as:Public',
      actor1?.id
    ])
  })
})
