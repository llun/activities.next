import {
  internalTypeToMastodon,
  mastodonTypeToInternal,
  mastodonTypesToInternal
} from './notificationTypeMapping'

describe('mastodonTypeToInternal', () => {
  it.each([
    { input: 'favourite', expected: ['like'] },
    { input: 'reblog', expected: ['reblog'] },
    // Both come back so `types[]=status` and `exclude_types[]=status` agree
    // with what the serializer emits — a one-way mapping meant a client that
    // excluded `status` still received gear reminders.
    { input: 'status', expected: ['activity_import', 'gear_service_due'] },
    { input: 'mention', expected: ['mention', 'reply'] },
    { input: 'quote', expected: ['quote'] },
    { input: 'quoted_update', expected: ['quoted_update'] },
    { input: 'pleroma:emoji_reaction', expected: ['emoji_reaction'] },
    // Unknown types pass through unchanged.
    { input: 'follow', expected: ['follow'] },
    { input: 'follow_request', expected: ['follow_request'] },
    { input: 'poll', expected: ['poll'] }
  ])('maps $input to $expected', ({ input, expected }) => {
    expect(mastodonTypeToInternal(input)).toEqual(expected)
  })
})

describe('internalTypeToMastodon', () => {
  it.each([
    { input: 'quote', expected: 'quote' },
    { input: 'emoji_reaction', expected: 'pleroma:emoji_reaction' },
    { input: 'quoted_update', expected: 'quoted_update' }
  ] as const)('maps $input to $expected', ({ input, expected }) => {
    expect(internalTypeToMastodon(input)).toBe(expected)
  })
})

describe('mastodonTypesToInternal', () => {
  it('returns undefined when input is undefined', () => {
    expect(mastodonTypesToInternal(undefined)).toBeUndefined()
  })

  it.each([
    {
      description: 'expands mention to mention and reply',
      input: ['mention'],
      expected: ['mention', 'reply']
    },
    {
      description: 'deduplicates when mention appears multiple times',
      input: ['mention', 'mention'],
      expected: ['mention', 'reply']
    },
    {
      description: 'maps multiple types correctly',
      input: ['favourite', 'mention', 'reblog'],
      expected: ['like', 'mention', 'reply', 'reblog']
    }
  ])('$description', ({ input, expected }) => {
    expect(mastodonTypesToInternal(input)).toEqual(expected)
  })
})
