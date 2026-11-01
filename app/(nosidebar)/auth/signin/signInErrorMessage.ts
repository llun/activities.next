export const EXPIRED_SIGN_IN_LINK_MESSAGE =
  'This sign-in link has expired. Go back to the app and start signing in again.'

export const REFRESHED_SIGN_IN_LINK_MESSAGE =
  'This sign-in link expired, so we refreshed it. Please sign in again.'

export const isInvalidSignatureError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false
  return Reflect.get(error, 'error') === 'invalid_signature'
}

export const signInErrorMessage = (
  error: { message?: string } | null | undefined
): string => {
  if (isInvalidSignatureError(error)) {
    return EXPIRED_SIGN_IN_LINK_MESSAGE
  }
  if (error?.message) {
    return error.message
  }
  return 'Sign in failed'
}
