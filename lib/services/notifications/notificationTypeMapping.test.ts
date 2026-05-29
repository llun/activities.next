import {
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

  it('maps status to activity_import', () => {
    expect(mastodonTypeToInternal('status')).toEqual(['activity_import'])
  })

  it('maps mention to both mention and reply', () => {
    expect(mastodonTypeToInternal('mention')).toEqual(['mention', 'reply'])
  })

  it('passes unknown types through unchanged', () => {
    expect(mastodonTypeToInternal('follow')).toEqual(['follow'])
    expect(mastodonTypeToInternal('follow_request')).toEqual(['follow_request'])
    expect(mastodonTypeToInternal('poll')).toEqual(['poll'])
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
