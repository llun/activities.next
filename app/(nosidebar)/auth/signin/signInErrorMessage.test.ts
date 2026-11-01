import {
  EXPIRED_SIGN_IN_LINK_MESSAGE,
  isInvalidSignatureError,
  signInErrorMessage
} from './signInErrorMessage'

describe('signInErrorMessage', () => {
  describe('isInvalidSignatureError', () => {
    it('returns true when error property is invalid_signature', () => {
      expect(isInvalidSignatureError({ error: 'invalid_signature' })).toBe(true)
      expect(
        isInvalidSignatureError({
          error: 'invalid_signature',
          status: 400,
          statusText: 'Bad Request'
        })
      ).toBe(true)
    })

    it('returns false for other errors or non-objects', () => {
      expect(isInvalidSignatureError({ error: 'something_else' })).toBe(false)
      expect(isInvalidSignatureError({})).toBe(false)
      expect(isInvalidSignatureError(null)).toBe(false)
      expect(isInvalidSignatureError(undefined)).toBe(false)
      expect(isInvalidSignatureError('invalid_signature')).toBe(false)
      expect(isInvalidSignatureError(123)).toBe(false)
    })
  })

  describe('signInErrorMessage', () => {
    it('returns expired link message when invalid_signature error', () => {
      expect(signInErrorMessage({ error: 'invalid_signature' } as never)).toBe(
        EXPIRED_SIGN_IN_LINK_MESSAGE
      )
      expect(
        signInErrorMessage({
          error: 'invalid_signature',
          message: 'ignored message'
        } as never)
      ).toBe(EXPIRED_SIGN_IN_LINK_MESSAGE)
    })

    it('returns error.message when non-empty message is provided', () => {
      expect(signInErrorMessage({ message: 'Invalid password' })).toBe(
        'Invalid password'
      )
    })

    it('returns fallback "Sign in failed" when message is missing or empty', () => {
      expect(signInErrorMessage({ message: '' })).toBe('Sign in failed')
      expect(signInErrorMessage({})).toBe('Sign in failed')
      expect(signInErrorMessage(null)).toBe('Sign in failed')
      expect(signInErrorMessage(undefined)).toBe('Sign in failed')
    })
  })
})
