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

  it('renders the button when a platform authenticator is available', async () => {
    setPlatformAuthenticator(() => Promise.resolve(true))
    await renderButton()
    expect(passkeyButton()).toBeInTheDocument()
  })

  it('hides the button when the WebAuthn API is absent (in-app browser)', async () => {
    clearWebAuthn()
    await renderButton()
    expect(passkeyButton()).not.toBeInTheDocument()
  })

  it('hides the button when no platform authenticator is available', async () => {
    setPlatformAuthenticator(() => Promise.resolve(false))
    await renderButton()
    expect(passkeyButton()).not.toBeInTheDocument()
  })

  it('hides the button when the availability check rejects', async () => {
    setPlatformAuthenticator(() => Promise.reject(new Error('nope')))
    await renderButton()
    expect(passkeyButton()).not.toBeInTheDocument()
  })

  it('shows an "unavailable" notice when passkeys are unsupported and credential sign-in is disabled', async () => {
    setPlatformAuthenticator(() => Promise.resolve(false))
    await renderButton({ credentialEnabled: false })
    expect(unavailableNotice()).toBeInTheDocument()
    expect(passkeyButton()).not.toBeInTheDocument()
  })

  it('shows the notice when the WebAuthn API is absent and credential sign-in is disabled', async () => {
    clearWebAuthn()
    await renderButton({ credentialEnabled: false })
    expect(unavailableNotice()).toBeInTheDocument()
  })

  it('does not show the notice when credential sign-in is enabled (button just hides)', async () => {
    setPlatformAuthenticator(() => Promise.resolve(false))
    await renderButton({ credentialEnabled: true })
    expect(unavailableNotice()).not.toBeInTheDocument()
    expect(passkeyButton()).not.toBeInTheDocument()
  })

  it('shows the button, not the notice, when passkeys are supported even if credential sign-in is disabled', async () => {
    setPlatformAuthenticator(() => Promise.resolve(true))
    await renderButton({ credentialEnabled: false })
    expect(passkeyButton()).toBeInTheDocument()
    expect(unavailableNotice()).not.toBeInTheDocument()
  })

  it('does not flash the notice while support is still being detected', async () => {
    // A detection promise that never resolves keeps `supported` unknown.
    setPlatformAuthenticator(() => new Promise<boolean>(() => {}))
    await renderButton({ credentialEnabled: false })
    expect(unavailableNotice()).not.toBeInTheDocument()
    expect(passkeyButton()).not.toBeInTheDocument()
  })
})
