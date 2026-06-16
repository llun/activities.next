import { FeaturedTagWithStats } from '@/lib/types/database/operations'

import { getMastodonFeaturedTag } from './getMastodonFeaturedTag'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn().mockReturnValue({ host: 'llun.test' })
}))

const baseTag: FeaturedTagWithStats = {
  id: 'tag-1',
  actorId: 'https://llun.test/users/alice',
  name: 'Running',
  createdAt: 1000,
  statusesCount: 3,
  lastStatusAt: Date.UTC(2024, 0, 15, 12, 0, 0)
}

describe('getMastodonFeaturedTag', () => {
  it('builds a Mastodon FeaturedTag for a local actor', () => {
    const result = getMastodonFeaturedTag({
      host: 'llun.test',
      actor: { username: 'alice', domain: 'llun.test' },
      tag: baseTag
    })
    expect(result).toEqual({
      id: 'tag-1',
      name: 'Running',
      url: 'https://llun.test/@alice/tagged/Running',
      statuses_count: '3',
      last_status_at: '2024-01-15'
    })
  })

  it('qualifies the acct with the domain for a remote actor', () => {
    const result = getMastodonFeaturedTag({
      host: 'llun.test',
      actor: { username: 'bob', domain: 'remote.test' },
      tag: baseTag
    })
    expect(result.url).toBe('https://llun.test/@bob@remote.test/tagged/Running')
  })

  it('uses the request host for the url and encodes the tag name', () => {
    const result = getMastodonFeaturedTag({
      host: 'social.example',
      actor: { username: 'alice', domain: 'llun.test' },
      tag: { ...baseTag, name: 'café' }
    })
    expect(result.url).toBe('https://social.example/@alice/tagged/caf%C3%A9')
  })

  it('serializes last_status_at as null when there are no statuses', () => {
    const result = getMastodonFeaturedTag({
      host: 'llun.test',
      actor: { username: 'alice', domain: 'llun.test' },
      tag: { ...baseTag, statusesCount: 0, lastStatusAt: null }
    })
    expect(result.statuses_count).toBe('0')
    expect(result.last_status_at).toBeNull()
  })
})
