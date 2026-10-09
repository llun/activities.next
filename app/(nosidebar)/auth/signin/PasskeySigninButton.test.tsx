/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, render, screen } from '@testing-library/react'

import { PasskeySigninButton } from './PasskeySigninButton'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams('')
}))

vi.mock('@/lib/services/auth/auth-client', () => ({
  authClient: { signIn: { passkey: vi.fn() } }
}))

type WindowWithPasskey = {
  PublicKeyCredential?: unknown
}

const setPlatformAuthenticator = (resolver: () => Promise<boolean>): void => {
  ;(window as unknown as WindowWithPasskey).PublicKeyCredential = {
    isUserVerifyingPlatformAuthenticatorAvailable: resolver
  }
}

const clearWebAuthn = (): void => {
  delete (window as unknown as WindowWithPasskey).PublicKeyCredential
}

// Render inside act(async) so the mount effect's support-detection promise and
// the resulting state update flush before we assert.
const renderButton = async (
  props: { credentialEnabled?: boolean } = {}
): Promise<void> => {
  await act(async () => {
    render(<PasskeySigninButton {...props} />)
  })
}

const passkeyButton = () =>
  screen.queryByRole('button', { name: /sign in with passkey/i })

const unavailableNotice = () =>
  screen.queryByText(/passkeys aren't available in this browser/i)

describe('PasskeySigninButton', () => {
  afterEach(() => {
    clearWebAuthn()
    vi.clearAllMocks()
  })

  // With credential sign-in disabled the passkey button is the only way in. A
  // passkey on a roaming security key (USB/NFC/BLE) works without any platform
  // authenticator, so hiding the button there would lock its owner out.
  const platformAuthenticator = {
    available: () => setPlatformAuthenticator(() => Promise.resolve(true)),
    unavailable: () => setPlatformAuthenticator(() => Promise.resolve(false)),
    rejects: () =>
      setPlatformAuthenticator(() => Promise.reject(new Error('nope'))),
    noWebAuthn: () => clearWebAuthn()
  }

  it.each([
    {
      name: 'a platform authenticator is available',
      setup: platformAuthenticator.available,
      credentialEnabled: true,
      button: true,
      notice: false
    },
    {
      name: 'the WebAuthn API is absent (in-app browser)',
      setup: platformAuthenticator.noWebAuthn,
      credentialEnabled: true,
      button: false,
      notice: false
    },
    {
      name: 'no platform authenticator is available',
      setup: platformAuthenticator.unavailable,
      credentialEnabled: true,
      button: false,
      notice: false
    },
    {
      name: 'the availability check rejects',
      setup: platformAuthenticator.rejects,
      credentialEnabled: true,
      button: false,
      notice: false
    },
    {
      name: 'a roaming security key may exist and credential sign-in is disabled',
      setup: platformAuthenticator.unavailable,
      credentialEnabled: false,
      button: true,
      notice: false
    },
    {
      name: 'the platform check rejects and credential sign-in is disabled',
      setup: platformAuthenticator.rejects,
      credentialEnabled: false,
      button: true,
      notice: false
    },
    {
      name: 'the WebAuthn API is absent and credential sign-in is disabled',
      setup: platformAuthenticator.noWebAuthn,
      credentialEnabled: false,
      button: false,
      notice: true
    },
    {
      name: 'passkeys are supported even if credential sign-in is disabled',
      setup: platformAuthenticator.available,
      credentialEnabled: false,
      button: true,
      notice: false
    },
    {
      name: 'support is still being detected (no flash of the notice)',
      setup: () =>
        setPlatformAuthenticator(() => new Promise<boolean>(() => {})),
      credentialEnabled: false,
      button: false,
      notice: false
    }
  ])(
    'shows button=$button and notice=$notice when $name',
    async ({ setup, credentialEnabled, button, notice }) => {
      setup()
      await renderButton({ credentialEnabled })
      expect(Boolean(passkeyButton())).toBe(button)
      expect(Boolean(unavailableNotice())).toBe(notice)
    }
  )

  it('exposes the notice as a status live region so screen readers announce it when it appears', async () => {
    clearWebAuthn()
    await renderButton({ credentialEnabled: false })
    // The notice is injected after client detection, so it must be a live
    // region to be announced (WCAG 2.1 SC 4.1.3 Status Messages).
    expect(screen.getByRole('status')).toHaveTextContent(
      /passkeys aren't available in this browser/i
    )
  })
})
