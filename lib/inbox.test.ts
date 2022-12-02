import { Note } from './activities/entities/note'
import { deliverTo } from './inbox'
import { compact } from './jsonld'
import { GetActorFromIdParams } from './storage/types'
import { MockActor } from './stub/actor'
import { MockMastodonNote } from './stub/note'

const mockStorage = {
  getActorFromId: jest.fn(async ({ id }: GetActorFromIdParams) => {
    if (['https://llun.dev/users/null'].includes(id)) return MockActor({ id })
  })
} as any

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
})
