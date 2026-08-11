import {
  internalTypeToMastodon,
  mastodonTypeToInternal,
  mastodonTypesToInternal
} from './notificationTypeMapping'

describe('mastodonTypeToInternal', () => {
  it('maps favourite to like', () => {
    expect(mastodonTypeToInternal('favourite')).toEqual(['like'])
  })

  it('maps reblog to reblog', () => {
    expect(mastodonTypeToInternal('reblog')).toEqual(['reblog'])
  })

  it('maps status to every internal type that serializes as status', () => {
    // Both come back so `types[]=status` and `exclude_types[]=status` agree
    // with what the serializer emits — a one-way mapping meant a client that
    // excluded `status` still received gear reminders.
    expect(mastodonTypeToInternal('status')).toEqual([
      'activity_import',
      'gear_service_due'
    ])
  })

  it('maps mention to both mention and reply', () => {
    expect(mastodonTypeToInternal('mention')).toEqual(['mention', 'reply'])
  })

  it('maps quote to quote', () => {
    expect(mastodonTypeToInternal('quote')).toEqual(['quote'])
  })

  it('maps quoted_update to quoted_update', () => {
    expect(mastodonTypeToInternal('quoted_update')).toEqual(['quoted_update'])
  })

  it('maps pleroma:emoji_reaction to emoji_reaction', () => {
    expect(mastodonTypeToInternal('pleroma:emoji_reaction')).toEqual([
      'emoji_reaction'
    ])
  })

  it('passes unknown types through unchanged', () => {
    expect(mastodonTypeToInternal('follow')).toEqual(['follow'])
    expect(mastodonTypeToInternal('follow_request')).toEqual(['follow_request'])
    expect(mastodonTypeToInternal('poll')).toEqual(['poll'])
  })
})

describe('internalTypeToMastodon', () => {
  it('maps quote to quote', () => {
    expect(internalTypeToMastodon('quote')).toBe('quote')
  })

  it('maps emoji_reaction to pleroma:emoji_reaction', () => {
    expect(internalTypeToMastodon('emoji_reaction')).toBe(
      'pleroma:emoji_reaction'
    )
  })

  it('maps quoted_update to quoted_update', () => {
    expect(internalTypeToMastodon('quoted_update')).toBe('quoted_update')
  })
})

describe('mastodonTypesToInternal', () => {
  it('returns undefined when input is undefined', () => {
    expect(mastodonTypesToInternal(undefined)).toBeUndefined()
  })

  it('expands mention to mention and reply', () => {
    expect(mastodonTypesToInternal(['mention'])).toEqual(['mention', 'reply'])
  })

  it('deduplicates when mention appears multiple times', () => {
    expect(mastodonTypesToInternal(['mention', 'mention'])).toEqual([
      'mention',
      'reply'
    ])
  })

  it('maps multiple types correctly', () => {
    expect(mastodonTypesToInternal(['favourite', 'mention', 'reblog'])).toEqual(
      ['like', 'mention', 'reply', 'reblog']
    )
  })
})
