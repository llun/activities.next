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

  it.each([
    {
      name: 'the WebAuthn API is unavailable (e.g. an in-app WKWebView)',
      credential: undefined,
      expected: false
    },
    {
      name: 'isUserVerifyingPlatformAuthenticatorAvailable is not a function',
      credential: {},
      expected: false
    },
    {
      name: 'a user-verifying platform authenticator is available',
      credential: {
        isUserVerifyingPlatformAuthenticatorAvailable: () =>
          Promise.resolve(true)
      },
      expected: true
    },
    {
      name: 'no user-verifying platform authenticator is available',
      credential: {
        isUserVerifyingPlatformAuthenticatorAvailable: () =>
          Promise.resolve(false)
      },
      expected: false
    },
    {
      name: 'the availability check rejects',
      credential: {
        isUserVerifyingPlatformAuthenticatorAvailable: () =>
          Promise.reject(new Error('blocked'))
      },
      expected: false
    }
  ])('returns $expected when $name', async ({ credential, expected }) => {
    if (credential !== undefined) setPublicKeyCredential(credential)
    expect(await isPlatformPasskeyAvailable()).toBe(expected)
  })
})
