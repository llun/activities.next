/**
 * Feature-detect whether the current client can complete a platform passkey
 * (WebAuthn) sign-in ceremony.
 *
 * Returns `false` in environments that lack the WebAuthn API or expose no
 * user-verifying platform authenticator — notably in-app browsers such as an
 * iOS `WKWebView`, the Schrift app's OAuth login dialog, and similar embedded
 * webviews, where the passkey sign-in button would only ever fail. The sign-in
 * button is gated on this when another sign-in method exists; when passkeys
 * are the only method it falls back to `isWebAuthnAvailable` instead, because
 * this check cannot see roaming security keys.
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

/**
 * Whether the browser exposes the WebAuthn API at all. A passkey can also live
 * on a roaming authenticator (a USB/NFC/Bluetooth security key), which
 * `isUserVerifyingPlatformAuthenticatorAvailable()` does not detect, so this is
 * the right gate when passkeys are the only way to sign in.
 */
export const isWebAuthnAvailable = (): boolean =>
  typeof window !== 'undefined' && Boolean(window.PublicKeyCredential)
