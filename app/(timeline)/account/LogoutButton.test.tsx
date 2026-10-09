/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

import { authClient } from '@/lib/services/auth/auth-client'

import { LogoutButton } from './LogoutButton'

vi.mock('@/lib/services/auth/auth-client', () => ({
  authClient: { signOut: vi.fn() }
}))

describe('LogoutButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('is described by the hint of the row it sits in', () => {
    render(
      <>
        <p id="hint">You can sign in again at any time.</p>
        <LogoutButton describedBy="hint" />
      </>
    )

    expect(
      screen.getByRole('button', { name: 'Logout' })
    ).toHaveAccessibleDescription('You can sign in again at any time.')
  })

  it('shows an error when sign out fails', () => {
    vi.mocked(authClient.signOut).mockImplementation(((options: {
      fetchOptions?: { onError?: () => void }
    }) => {
      options.fetchOptions?.onError?.()
    }) as unknown as typeof authClient.signOut)
    render(<LogoutButton />)

    fireEvent.click(screen.getByRole('button', { name: 'Logout' }))

    expect(screen.getByText('Sign out failed. Please try again.')).toBeVisible()
  })
})
