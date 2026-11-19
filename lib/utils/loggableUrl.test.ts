import { toLoggableUrl } from '@/lib/utils/loggableUrl'

describe('toLoggableUrl', () => {
  it('keeps the scheme and host only', () => {
    expect(
      toLoggableUrl('https://user:pass@remote.test:8443/users/a?token=x#frag')
    ).toBe('https://remote.test:8443')
    expect(toLoggableUrl('https://remote.test/u/heatmaps/share-token')).toBe(
      'https://remote.test'
    )
  })

  it('returns null for text that is not an http(s) URL', () => {
    expect(toLoggableUrl('alice@remote.test?token=x')).toBeNull()
    expect(toLoggableUrl(undefined)).toBeNull()
    expect(toLoggableUrl('data:text/plain,secret-token')).toBeNull()
    expect(
      toLoggableUrl('blob:https://user:pass@remote.test/a?token=x')
    ).toBeNull()
  })

  it('caps a long host', () => {
    expect(
      toLoggableUrl(`https://${'a'.repeat(1000)}.remote.test/x`)
    ).toHaveLength(512)
  })
})
