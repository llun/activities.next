import { DEFAULT_TOTP_ISSUER, toTotpIssuer } from './totpIssuer'

describe('toTotpIssuer', () => {
  // The Key URI format separates issuer and account with a colon, so neither
  // may contain one; a control character would garble the authenticator entry.
  it.each([
    { input: 'Run Club', expected: 'Run Club' },
    { input: 'Run: Club', expected: 'Run Club' },
    { input: 'a:b:c', expected: 'a b c' },
    { input: 'Run\nClub', expected: 'Run Club' },
    { input: 'Run\u0000\u0007Club\u007f', expected: 'Run Club' },
    { input: 'Run\u0085Club', expected: 'Run Club' },
    { input: '  Run   Club  ', expected: 'Run Club' },
    { input: 'Café · Paris', expected: 'Café · Paris' }
  ])('turns $input into $expected', ({ input, expected }) => {
    expect(toTotpIssuer(input)).toBe(expected)
  })

  it.each(['', '   ', ':', '\n\t:'])(
    'falls back to the default issuer for %j',
    (input) => {
      expect(toTotpIssuer(input)).toBe(DEFAULT_TOTP_ISSUER)
    }
  )
})
