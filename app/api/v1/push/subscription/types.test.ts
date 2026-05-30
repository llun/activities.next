import {
  parseAlertsInput,
  parsePolicyInput,
  parseSubscribeInput
} from './types'

const endpoint = 'https://push.example.com/endpoint/test'
const p256dh =
  'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8'
const auth = 'tBHItJI5svbpez7KI4CCXg'

describe('parseSubscribeInput', () => {
  it('parses a nested JSON body', () => {
    const parsed = parseSubscribeInput({
      subscription: { endpoint, keys: { p256dh, auth }, standard: true },
      data: { alerts: { mention: true, follow: false }, policy: 'followed' }
    })
    expect(parsed).not.toBeNull()
    expect(parsed?.endpoint).toBe(endpoint)
    expect(parsed?.p256dh).toBe(p256dh)
    expect(parsed?.auth).toBe(auth)
    expect(parsed?.standard).toBe(true)
    expect(parsed?.policy).toBe('followed')
    expect(parsed?.alerts.mention).toBe(true)
    expect(parsed?.alerts.follow).toBe(false)
  })

  it('parses bracketed form keys', () => {
    const parsed = parseSubscribeInput({
      'subscription[endpoint]': endpoint,
      'subscription[keys][p256dh]': p256dh,
      'subscription[keys][auth]': auth,
      'subscription[standard]': 'true',
      'data[alerts][mention]': 'true',
      'data[alerts][favourite]': '1',
      'data[policy]': 'follower'
    })
    expect(parsed).not.toBeNull()
    expect(parsed?.endpoint).toBe(endpoint)
    expect(parsed?.p256dh).toBe(p256dh)
    expect(parsed?.auth).toBe(auth)
    expect(parsed?.standard).toBe(true)
    expect(parsed?.policy).toBe('follower')
    expect(parsed?.alerts.mention).toBe(true)
    expect(parsed?.alerts.favourite).toBe(true)
  })

  it('returns null when required keys are missing', () => {
    expect(parseSubscribeInput({ subscription: { endpoint } })).toBeNull()
    expect(parseSubscribeInput({})).toBeNull()
  })

  it('returns null when the endpoint is not a valid URL', () => {
    expect(
      parseSubscribeInput({
        subscription: { endpoint: 'not-a-url', keys: { p256dh, auth } }
      })
    ).toBeNull()
  })

  it('returns null for malformed or truncated web push keys', () => {
    expect(
      parseSubscribeInput({
        subscription: { endpoint, keys: { p256dh: 'too-short', auth } }
      })
    ).toBeNull()
    expect(
      parseSubscribeInput({
        subscription: { endpoint, keys: { p256dh, auth: 'short' } }
      })
    ).toBeNull()
    expect(
      parseSubscribeInput({
        subscription: {
          endpoint,
          keys: { p256dh: `${p256dh}!!not base64!!`, auth }
        }
      })
    ).toBeNull()
  })

  it('reads the top-level policy field for updates', () => {
    expect(parsePolicyInput({ policy: 'none' })).toBe('none')
  })
})

describe('parseAlertsInput', () => {
  it('only includes alert keys that are present', () => {
    const alerts = parseAlertsInput({
      data: { alerts: { mention: true, reblog: false } }
    })
    expect(alerts).toEqual({ mention: true, reblog: false })
  })

  it('reads bracketed alert keys including admin alerts', () => {
    const alerts = parseAlertsInput({
      'data[alerts][admin.sign_up]': 'true',
      'data[alerts][admin.report]': 'false'
    })
    expect(alerts['admin.sign_up']).toBe(true)
    expect(alerts['admin.report']).toBe(false)
  })
})

describe('parsePolicyInput', () => {
  it('accepts valid policies', () => {
    expect(parsePolicyInput({ data: { policy: 'none' } })).toBe('none')
    expect(parsePolicyInput({ 'data[policy]': 'all' })).toBe('all')
  })

  it('ignores invalid policies', () => {
    expect(parsePolicyInput({ data: { policy: 'invalid' } })).toBeUndefined()
    expect(parsePolicyInput({})).toBeUndefined()
  })
})
