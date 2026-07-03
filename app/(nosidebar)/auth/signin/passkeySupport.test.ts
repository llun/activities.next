/**
 * @vitest-environment jsdom
 */
import { isPlatformPasskeyAvailable } from './passkeySupport'

type WindowWithPasskey = {
  PublicKeyCredential?: unknown
}

const setPublicKeyCredential = (value: unknown): void => {
  ;(window as unknown as WindowWithPasskey).PublicKeyCredential = value
}

describe('isPlatformPasskeyAvailable', () => {
  afterEach(() => {
    delete (window as unknown as WindowWithPasskey).PublicKeyCredential
  })

  it('returns false when the WebAuthn API is unavailable (e.g. an in-app WKWebView)', async () => {
    // No window.PublicKeyCredential is defined.
    expect(await isPlatformPasskeyAvailable()).toBe(false)
  })

  it('returns false when isUserVerifyingPlatformAuthenticatorAvailable is not a function', async () => {
    setPublicKeyCredential({})
    expect(await isPlatformPasskeyAvailable()).toBe(false)
  })

  it('returns true when a user-verifying platform authenticator is available', async () => {
    setPublicKeyCredential({
      isUserVerifyingPlatformAuthenticatorAvailable: () => Promise.resolve(true)
    })
    expect(await isPlatformPasskeyAvailable()).toBe(true)
  })

  it('returns false when no user-verifying platform authenticator is available', async () => {
    setPublicKeyCredential({
      isUserVerifyingPlatformAuthenticatorAvailable: () =>
        Promise.resolve(false)
    })
    expect(await isPlatformPasskeyAvailable()).toBe(false)
  })

  it('returns false when the availability check rejects', async () => {
    setPublicKeyCredential({
      isUserVerifyingPlatformAuthenticatorAvailable: () =>
        Promise.reject(new Error('blocked'))
    })
    expect(await isPlatformPasskeyAvailable()).toBe(false)
  })
})
