import { describe, expect, it } from 'vitest'

import { formatServerSoftware } from './formatServerSoftware'

describe('formatServerSoftware', () => {
  it('formats known software with version', () => {
    expect(formatServerSoftware({ name: 'mastodon', version: '4.3.0' })).toBe(
      'Mastodon/4.3.0'
    )
    expect(formatServerSoftware({ name: 'pixelfed', version: '0.12.9' })).toBe(
      'Pixelfed/0.12.9'
    )
    expect(
      formatServerSoftware({ name: 'gotosocial', version: '0.17.0' })
    ).toBe('GoToSocial/0.17.0')
    expect(formatServerSoftware({ name: 'peertube', version: '6.0.0' })).toBe(
      'PeerTube/6.0.0'
    )
    expect(
      formatServerSoftware({ name: 'activities.next', version: '1.158.3' })
    ).toBe('activities.next/1.158.3')
    expect(
      formatServerSoftware({ name: 'activities-next', version: '1.158.3' })
    ).toBe('activities.next/1.158.3')
  })

  it('omits version slash when version is null or empty', () => {
    expect(formatServerSoftware({ name: 'mastodon', version: null })).toBe(
      'Mastodon'
    )
    expect(formatServerSoftware({ name: 'pixelfed', version: '' })).toBe(
      'Pixelfed'
    )
    expect(formatServerSoftware({ name: 'pixelfed', version: '   ' })).toBe(
      'Pixelfed'
    )
  })

  it('formats unknown software by capitalizing the first letter', () => {
    expect(
      formatServerSoftware({ name: 'unknownengine', version: '1.0.0' })
    ).toBe('Unknownengine/1.0.0')
    expect(
      formatServerSoftware({ name: 'customPlatform', version: null })
    ).toBe('CustomPlatform')
  })

  it('handles empty software name gracefully', () => {
    expect(formatServerSoftware({ name: '', version: '1.0' })).toBe('')
    expect(formatServerSoftware({ name: '   ', version: '1.0' })).toBe('')
  })
})
