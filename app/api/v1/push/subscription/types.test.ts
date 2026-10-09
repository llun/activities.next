import {
  hasInvalidPolicy,
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
    expect(parsed).toMatchObject({
      endpoint,
      p256dh,
      auth,
      standard: true,
      policy: 'followed',
      alerts: { mention: true, follow: false }
    })
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
    expect(parsed).toMatchObject({
      endpoint,
      p256dh,
      auth,
      standard: true,
      policy: 'follower',
      alerts: { mention: true, favourite: true }
    })
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

  it('accepts standard base64 keys (with + and /), not only base64url', () => {
    const standardBase64P256dh =
      'BEl62iUYgUivxIkv69yViEuiBIa+Ib9+SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8'
    const parsed = parseSubscribeInput({
      subscription: {
        endpoint,
        keys: { p256dh: standardBase64P256dh, auth: 'tBHItJI5svbpez7KI4CC+g' }
      }
    })
    expect(parsed).not.toBeNull()
    expect(parsed?.p256dh).toBe(standardBase64P256dh)
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

describe('policy input', () => {
  it.each([
    { input: { data: { policy: 'none' } }, policy: 'none', invalid: false },
    { input: { 'data[policy]': 'all' }, policy: 'all', invalid: false },
    { input: { policy: 'none' }, policy: 'none', invalid: false },
    {
      input: { data: { policy: 'followed' } },
      policy: 'followed',
      invalid: false
    },
    { input: {}, policy: undefined, invalid: false },
    { input: { data: { policy: '' } }, policy: undefined, invalid: false },
    {
      input: { data: { policy: 'invalid' } },
      policy: undefined,
      invalid: true
    },
    { input: { policy: 'everyone' }, policy: undefined, invalid: true }
  ])(
    'parses $input as policy $policy (invalid: $invalid)',
    ({ input, policy, invalid }) => {
      expect(parsePolicyInput(input)).toBe(policy)
      expect(hasInvalidPolicy(input)).toBe(invalid)
    }
  )
})
