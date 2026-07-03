/**
 * Feature-detect whether the current client can complete a platform passkey
 * (WebAuthn) sign-in ceremony.
 *
 * Returns `false` in environments that lack the WebAuthn API or expose no
 * user-verifying platform authenticator — notably in-app browsers such as an
 * iOS `WKWebView`, the Schrift app's OAuth login dialog, and similar embedded
 * webviews, where the passkey sign-in button would only ever fail. The sign-in
 * button is gated on this so it never appears where passkeys can't be used.
 */
export const isPlatformPasskeyAvailable = async (): Promise<boolean> => {
  if (typeof window === 'undefined') return false

  const publicKeyCredential = window.PublicKeyCredential
  if (
    !publicKeyCredential ||
    typeof publicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable !==
      'function'
  ) {
    return false
  }

  try {
    return await publicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
  } catch {
    return false
  }
}
