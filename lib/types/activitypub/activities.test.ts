import { Announce } from '@/lib/types/activitypub/activities'

describe('ActivityPub activities', () => {
  const baseAnnounce = {
    id: 'https://example.com/activities/1',
    type: 'Announce',
    actor: 'https://example.com/users/alice',
    published: '2026-09-06T10:00:00Z',
    object: 'https://remote.test/statuses/1',
    to: 'https://www.w3.org/ns/activitystreams#Public',
    cc: ['https://example.com/users/alice/followers']
  }

  it.each([
    { description: 'a standard announce activity', input: baseAnnounce },
    {
      description: 'an announce without cc',
      input: (({ cc: _cc, ...rest }) => rest)(baseAnnounce)
    },
    {
      description: 'an announce without to',
      input: (({ to: _to, ...rest }) => rest)(baseAnnounce)
    },
    {
      description: 'an announce with null to and cc',
      input: { ...baseAnnounce, to: null, cc: null }
    }
  ])('accepts $description', ({ input }) => {
    expect(Announce.safeParse(input).success).toBe(true)
  })
})
