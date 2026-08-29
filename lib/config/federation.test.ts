import { isInboxForwardingEnabled } from './federation'

describe('isInboxForwardingEnabled', () => {
  const originalEnv = process.env.ACTIVITIES_ENABLE_INBOX_FORWARDING

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.ACTIVITIES_ENABLE_INBOX_FORWARDING
    } else {
      process.env.ACTIVITIES_ENABLE_INBOX_FORWARDING = originalEnv
    }
  })

  it('returns false when environment variable is unset', () => {
    delete process.env.ACTIVITIES_ENABLE_INBOX_FORWARDING
    expect(isInboxForwardingEnabled()).toBe(false)
  })

  it('returns false when set to false or any other string', () => {
    process.env.ACTIVITIES_ENABLE_INBOX_FORWARDING = 'false'
    expect(isInboxForwardingEnabled()).toBe(false)

    process.env.ACTIVITIES_ENABLE_INBOX_FORWARDING = '0'
    expect(isInboxForwardingEnabled()).toBe(false)

    process.env.ACTIVITIES_ENABLE_INBOX_FORWARDING = ''
    expect(isInboxForwardingEnabled()).toBe(false)
  })

  it('returns true when set to true', () => {
    process.env.ACTIVITIES_ENABLE_INBOX_FORWARDING = 'true'
    expect(isInboxForwardingEnabled()).toBe(true)
  })
})
