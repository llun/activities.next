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

  it('validates a standard announce activity', () => {
    const result = Announce.safeParse(baseAnnounce)
    expect(result.success).toBe(true)
  })

  it('accepts announce when cc is omitted', () => {
    const { cc: _cc, ...withoutCc } = baseAnnounce
    const result = Announce.safeParse(withoutCc)
    expect(result.success).toBe(true)
  })

  it('accepts announce when to is omitted', () => {
    const { to: _to, ...withoutTo } = baseAnnounce
    const result = Announce.safeParse(withoutTo)
    expect(result.success).toBe(true)
  })

  it('accepts announce when to and cc are null', () => {
    const result = Announce.safeParse({
      ...baseAnnounce,
      to: null,
      cc: null
    })
    expect(result.success).toBe(true)
  })
})
