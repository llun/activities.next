import { toLoggableUrl } from '@/lib/utils/loggableUrl'

describe('toLoggableUrl', () => {
  it('keeps the scheme, host and path only', () => {
    expect(
      toLoggableUrl('https://user:pass@remote.test:8443/users/a?token=x#frag')
    ).toBe('https://remote.test:8443/users/a')
  })

  it('returns null for text that is not a URL', () => {
    expect(toLoggableUrl('alice@remote.test?token=x')).toBeNull()
    expect(toLoggableUrl(undefined)).toBeNull()
  })

  it('caps a long path', () => {
    expect(
      toLoggableUrl(`https://remote.test/${'a'.repeat(1000)}`)
    ).toHaveLength(512)
  })
})
