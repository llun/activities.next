import { passkeyErrorMessage } from './passkeyErrorMessage'

describe('passkeyErrorMessage', () => {
  it.each([
    'AUTH_CANCELLED',
    'ERROR_CEREMONY_ABORTED',
    'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY'
  ])('stays silent for the cancellation code %s', (code) => {
    expect(passkeyErrorMessage(code)).toBeNull()
  })

  it.each(['ERROR_INVALID_RP_ID', 'ERROR_INVALID_DOMAIN'])(
    'returns the domain-mismatch message for %s',
    (code) => {
      expect(passkeyErrorMessage(code)).toBe(
        'This passkey cannot be used on this domain. Please use another sign-in method.'
      )
    }
  )

  it.each([
    ['a WebAuthn error not in the map', 'ERROR_AUTHENTICATOR_GENERAL_ERROR'],
    ['an unknown code', 'SOMETHING_ELSE'],
    ['an undefined code', undefined]
  ])('returns the generic message for %s', (_label, code) => {
    expect(passkeyErrorMessage(code)).toBe(
      'Passkey sign in failed. Please try again.'
    )
  })
})
