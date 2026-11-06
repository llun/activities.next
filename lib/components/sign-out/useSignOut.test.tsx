/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react'

import { clearStagedShares } from '@/lib/client/share-target/shareTargetDb'
import { authClient } from '@/lib/services/auth/auth-client'

import { useSignOut } from './useSignOut'

vi.mock('@/lib/services/auth/auth-client', () => ({
  authClient: { signOut: vi.fn() }
}))
vi.mock('@/lib/client/offline', () => ({
  clearAllOfflineData: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('@/lib/client/share-target/shareTargetDb', () => ({
  clearStagedShares: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('@/lib/client/drafts', () => ({
  purgeAccountDrafts: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('@/lib/client/drafts/pendingPurgeMarker', () => ({
  markPurgePending: vi.fn()
}))
vi.mock('@/lib/client/drafts/draftsChannel', () => ({
  postDraftsMessage: vi.fn()
}))
vi.mock('@/lib/components/drafts/DraftsProvider', () => ({
  useDrafts: () => ({ accountId: 'acct-1' })
}))

type SignOutOptions = {
  fetchOptions: { onSuccess: () => void | Promise<void>; onError: () => void }
}

describe('useSignOut', () => {
  beforeEach(() => {
    vi.mocked(authClient.signOut).mockReset()
    vi.mocked(clearStagedShares).mockClear()
  })

  // A shared device: the next account must not pick up the files the previous
  // reader shared and never added or discarded.
  it('clears the staged shares once the server has signed out', async () => {
    vi.mocked(authClient.signOut).mockImplementation((async (
      options: SignOutOptions
    ) => {
      await options.fetchOptions.onSuccess()
    }) as never)
    const { result } = renderHook(() => useSignOut())

    await act(async () => {
      await result.current.signOut()
    })

    expect(clearStagedShares).toHaveBeenCalledTimes(1)
  })

  it('keeps the staged shares when the sign-out fails', async () => {
    vi.mocked(authClient.signOut).mockImplementation((async (
      options: SignOutOptions
    ) => {
      options.fetchOptions.onError()
    }) as never)
    const { result } = renderHook(() => useSignOut())

    await act(async () => {
      await result.current.signOut()
    })

    expect(clearStagedShares).not.toHaveBeenCalled()
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
