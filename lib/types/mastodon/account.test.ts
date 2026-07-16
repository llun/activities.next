import { Account } from './account'

const baseAccountInput = {
  id: '1',
  username: 'alice',
  acct: 'alice',
  url: 'https://llun.test/@alice',
  uri: 'https://llun.test/users/alice',
  display_name: 'Alice',
  note: '',
  avatar: '',
  avatar_static: '',
  header: '',
  header_static: '',
  locked: false,
  source: {
    note: '',
    fields: [],
    privacy: 'public' as const,
    sensitive: false,
    language: 'en',
    attribution_domains: [],
    follow_requests_count: 0
  },
  fields: [],
  emojis: [],
  bot: false,
  group: false,
  discoverable: true,
  roles: [],
  indexable: false,
  hide_collections: null,
  created_at: '2026-01-01T00:00:00.000Z',
  last_status_at: null,
  statuses_count: 0,
  followers_count: 0,
  following_count: 0
}

describe('Account', () => {
  it('defaults the 4.6 avatar/header descriptions to empty strings when omitted', () => {
    const parsed = Account.parse(baseAccountInput)

    // Both must be present as strings so they can never be dropped from the
    // serialized JSON, which is what broke grouped notifications for 4.6 clients.
    expect(parsed.avatar_description).toBe('')
    expect(parsed.header_description).toBe('')
  })

  it('preserves supplied avatar/header descriptions', () => {
    const parsed = Account.parse({
      ...baseAccountInput,
      avatar_description: 'A coffee cup',
      header_description: 'Mountains at dawn'
    })

    expect(parsed.avatar_description).toBe('A coffee cup')
    expect(parsed.header_description).toBe('Mountains at dawn')
  })
})
