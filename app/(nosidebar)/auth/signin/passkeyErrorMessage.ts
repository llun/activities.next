// better-auth's passkey client always sets `message` to "Auth cancelled"
// regardless of the real failure and only varies the `code`, so the raw message
// is misleading. Map the meaningful WebAuthn error codes to actionable text, and
// stay silent only when the user genuinely dismissed the system prompt.
export const passkeyErrorMessage = (code?: string): string | null => {
  switch (code) {
    // Genuine user dismissal/timeout: @simplewebauthn maps the browser's
    // NotAllowedError to ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY (not
    // ERROR_CEREMONY_ABORTED, which is only a programmatic abort), and
    // better-auth reports AUTH_CANCELLED when no WebAuthnError is thrown. Stay
    // silent for all of these so dismissing the prompt isn't shown as an error.
    // (AUTH_CANCELLED is also reused for a rare post-ceremony network failure of
    // verify-authentication; we accept staying silent there too.)
    case 'AUTH_CANCELLED':
    case 'ERROR_CEREMONY_ABORTED':
    case 'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY':
      return null
    case 'ERROR_INVALID_RP_ID':
    case 'ERROR_INVALID_DOMAIN':
      return 'This passkey cannot be used on this domain. Please use another sign-in method.'
    default:
      return 'Passkey sign in failed. Please try again.'
  }
}
