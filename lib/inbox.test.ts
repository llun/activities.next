import { Note } from './activities/entities/note'
import { deliverTo, isLocalFollowerId } from './inbox'
import { compact } from './jsonld'
import {
  GetActorFromIdParams,
  GetLocalFollowersForActorIdParams
} from './storage/types'
import { MockActor } from './stub/actor'
import { MockMastodonNote } from './stub/note'

jest.mock('./config', () => ({
  __esModule: true,
  getConfig: jest.fn().mockReturnValue({
    host: 'llun.test'
  })
}))

const mockStorage = {
  getActorFromId: jest.fn(async ({ id }: GetActorFromIdParams) => {
    if (['https://llun.dev/users/null'].includes(id)) return MockActor({ id })
  }),
  getLocalFollowersForActorId: jest.fn(
    async ({ targetActorId }: GetLocalFollowersForActorIdParams) => {
      if (targetActorId === 'https://mastodon.in.th/users/friend') {
        return ['https://llun.dev/users/null']
      }
      return []
    }
  )
} as any

describe('#isLocalFollowerId', () => {
  it('returns true when id starts with config host and ends with followers', () => {
    expect(
      isLocalFollowerId('https://llun.test/users/null/followers')
    ).toBeTruthy()
  })

  it('returns false when id is not followers', () => {
    expect(isLocalFollowerId('https://llun.test/users/null')).toBeFalsy()
  })

  it('returns false when id is not starts with the config host', () => {
    expect(
      isLocalFollowerId('https://somethingelse.tld/users/null')
    ).toBeFalsy()
  })
})

describe('#deliverTo', () => {
  it('concats to and cc to single list', async () => {
    const note = MockMastodonNote({
      content: 'Hello',
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: ['https://llun.dev/users/null'],
      withContext: true
    })
    const compactedNote = (await compact(note)) as Note
    expect(
      await deliverTo({ note: compactedNote, storage: mockStorage })
    ).toEqual(['as:Public', 'https://llun.dev/users/null'])
  })

  it('remove non-existing users from the list except public', async () => {
    const note = MockMastodonNote({
      content: 'Hello',
      to: [
        'https://www.w3.org/ns/activitystreams#Public',
        'https://llun.dev/users/null'
      ],
      cc: [
        'https://llun.dev/users/non-existing',
        'https://other.federate/users/someone'
      ],
      withContext: true
    })
    const compactedNote = (await compact(note)) as Note
    expect(
      await deliverTo({ note: compactedNote, storage: mockStorage })
    ).toEqual(['as:Public', 'https://llun.dev/users/null'])
  })
  it.only('spread the followers and returns only users that exists in the system', async () => {
    const note = MockMastodonNote({
      content: 'Hello',
      to: [
        'https://www.w3.org/ns/activitystreams#Public',
        'https://mastodon.in.th/users/friend'
      ],
      cc: ['https://mastodon.in.th/users/friend/followers'],
      withContext: true
    })
    const compactedNote = (await compact(note)) as Note
    expect(
      await deliverTo({ note: compactedNote, storage: mockStorage })
    ).toEqual(['as:Public', 'https://llun.dev/users/null'])
  })
})
