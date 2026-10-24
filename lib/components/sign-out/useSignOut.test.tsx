/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react'

import { authClient } from '@/lib/services/auth/auth-client'

import { useSignOut } from './useSignOut'

vi.mock('@/lib/services/auth/auth-client', () => ({
  authClient: { signOut: vi.fn() }
}))
vi.mock('@/lib/client/offline', () => ({
  clearAllOfflineData: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('@/lib/client/drafts/draftsChannel', () => ({
  postDraftsMessage: vi.fn()
}))
vi.mock('@/lib/components/drafts/DraftsProvider', () => ({
  useDrafts: () => ({ accountId: 'acct-1' })
}))

type SignOutOptions = {
  fetchOptions: { onSuccess: () => void; onError: () => void }
}

describe('useSignOut', () => {
  beforeEach(() => {
    vi.mocked(authClient.signOut).mockReset()
  })

  it('ignores a second call while one is in flight', async () => {
    // Never settles, so the first call stays in flight.
    vi.mocked(authClient.signOut).mockReturnValue(new Promise(() => {}))
    const { result } = renderHook(() => useSignOut())

    await act(async () => {
      // Both before React re-renders: only the ref can stop the second.
      void result.current.signOut()
      void result.current.signOut()
    })

    expect(authClient.signOut).toHaveBeenCalledTimes(1)
    expect(result.current.signingOut).toBe(true)
  })

  it('allows a retry after a failed sign-out', async () => {
    vi.mocked(authClient.signOut).mockImplementation((async (
      options: SignOutOptions
    ) => {
      options.fetchOptions.onError()
    }) as never)
    const { result } = renderHook(() => useSignOut())

    await act(async () => {
      await result.current.signOut()
    })
    expect(result.current.error).toBe('Sign out failed. Please try again.')
    expect(result.current.signingOut).toBe(false)

    await act(async () => {
      await result.current.signOut()
    })
    expect(authClient.signOut).toHaveBeenCalledTimes(2)
  })
})
