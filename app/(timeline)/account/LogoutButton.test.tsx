/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { clearAllOfflineData } from '@/lib/client/offline'
import { authClient } from '@/lib/services/auth/auth-client'

import { LogoutButton } from './LogoutButton'

vi.mock('@/lib/services/auth/auth-client', () => ({
  authClient: { signOut: vi.fn() }
}))

vi.mock('@/lib/client/offline', () => ({
  clearAllOfflineData: vi.fn().mockResolvedValue(undefined)
}))

describe('LogoutButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authClient.signOut).mockReset()
    vi.mocked(clearAllOfflineData).mockReset().mockResolvedValue(undefined)
  })

  it('is described by the hint of the row it sits in', () => {
    render(
      <>
        <p id="hint">You can sign in again at any time.</p>
        <LogoutButton describedBy="hint" onError={vi.fn()} />
      </>
    )

    expect(
      screen.getByRole('button', { name: 'Logout' })
    ).toHaveAccessibleDescription('You can sign in again at any time.')
  })

  it('is labelled by the label of the row it sits in', () => {
    render(
      <>
        <span id="label">Sign out of this device</span>
        <LogoutButton labelledBy="label" onError={vi.fn()} />
      </>
    )

    expect(
      screen.getByRole('button', { name: 'Sign out of this device' })
    ).toHaveAttribute('aria-labelledby', 'label')
  })

  it('reports the error when sign out fails', async () => {
    vi.mocked(authClient.signOut).mockImplementation(((options: {
      fetchOptions?: { onError?: () => void }
    }) => {
      options.fetchOptions?.onError?.()
    }) as unknown as typeof authClient.signOut)
    const onError = vi.fn()
    render(<LogoutButton onError={onError} />)

    fireEvent.click(screen.getByRole('button', { name: 'Logout' }))

    await waitFor(() => {
      expect(onError).toHaveBeenLastCalledWith(
        'Sign out failed. Please try again.'
      )
    })
    expect(onError).toHaveBeenNthCalledWith(1, null)
  })

  it('clears all offline data when logout button is clicked', async () => {
    render(<LogoutButton onError={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Logout' }))

    await waitFor(() => {
      expect(clearAllOfflineData).toHaveBeenCalledTimes(1)
    })
  })
})
