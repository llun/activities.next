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
const renderButton = async (): Promise<void> => {
  await act(async () => {
    render(<PasskeySigninButton />)
  })
}

const passkeyButton = () =>
  screen.queryByRole('button', { name: /sign in with passkey/i })

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
})
