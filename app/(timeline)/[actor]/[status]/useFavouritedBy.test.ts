/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from '@testing-library/react'

import { getStatusFavouritedBy } from '@/lib/client'
import { createDeferred } from '@/lib/testing/deferred'
import type { Account as MastodonAccount } from '@/lib/types/mastodon/account'

import { useFavouritedBy } from './useFavouritedBy'

vi.mock('@/lib/client', () => ({
  getStatusFavouritedBy: vi.fn()
}))

const statusId = 'https://activities.local/users/llun/statuses/post-1'

const account = (username: string) =>
  ({
    id: `https://remote.example/users/${username}`,
    username
  }) as MastodonAccount

const page = (usernames: string[], total: number) => ({
  accounts: usernames.map(account),
  total,
  limit: 10,
  offset: 0
})

type Params = Parameters<typeof useFavouritedBy>[0]

describe('useFavouritedBy', () => {
  beforeEach(() => {
    // mockReset (not clearAllMocks) so no unused mock...Once value leaks
    // from one test into the next.
    vi.mocked(getStatusFavouritedBy).mockReset()
  })

  it('does not fetch while disabled', () => {
    const { result } = renderHook(() =>
      useFavouritedBy({ statusId, enabled: false })
    )

    expect(getStatusFavouritedBy).not.toHaveBeenCalled()
    expect(result.current).toEqual({
      accounts: [],
      isLoading: false,
      totalCount: 0
    })
  })

  it('fetches the requested page and exposes accounts and total', async () => {
    ;(getStatusFavouritedBy as jest.Mock).mockResolvedValue(
      page(['alice', 'bob'], 12)
    )

    const { result } = renderHook(() =>
      useFavouritedBy({ statusId, limit: 10, offset: 20, enabled: true })
    )

    await waitFor(() => expect(result.current.accounts).toHaveLength(2))
    expect(getStatusFavouritedBy).toHaveBeenCalledWith({
      statusId,
      limit: 10,
      offset: 20
    })
    expect(result.current.totalCount).toBe(12)
    expect(result.current.isLoading).toBe(false)
  })

  it('reports loading until the request settles', async () => {
    const deferred = createDeferred<ReturnType<typeof page>>()
    ;(getStatusFavouritedBy as jest.Mock).mockReturnValue(deferred.promise)

    const { result } = renderHook(() =>
      useFavouritedBy({ statusId, enabled: true })
    )

    await waitFor(() => expect(result.current.isLoading).toBe(true))

    await act(async () => {
      deferred.resolve(page(['alice'], 1))
    })

    expect(result.current.isLoading).toBe(false)
    expect(result.current.accounts).toHaveLength(1)
  })

  it('fetches once enabled flips to true', async () => {
    ;(getStatusFavouritedBy as jest.Mock).mockResolvedValue(page(['alice'], 1))
    const { result, rerender } = renderHook(
      (props: Params) => useFavouritedBy(props),
      { initialProps: { statusId, enabled: false } as Params }
    )
    expect(getStatusFavouritedBy).not.toHaveBeenCalled()

    rerender({ statusId, enabled: true })

    await waitFor(() => expect(result.current.totalCount).toBe(1))
    expect(getStatusFavouritedBy).toHaveBeenCalledTimes(1)
  })

  it('refetches when the offset changes', async () => {
    ;(getStatusFavouritedBy as jest.Mock)
      .mockResolvedValueOnce(page(['alice'], 2))
      .mockResolvedValueOnce(page(['bob'], 2))
    const { result, rerender } = renderHook(
      (props: Params) => useFavouritedBy(props),
      {
        initialProps: { statusId, limit: 1, offset: 0, enabled: true } as Params
      }
    )
    await waitFor(() =>
      expect(result.current.accounts[0]?.username).toBe('alice')
    )

    rerender({ statusId, limit: 1, offset: 1, enabled: true })

    await waitFor(() =>
      expect(result.current.accounts[0]?.username).toBe('bob')
    )
    expect(getStatusFavouritedBy).toHaveBeenLastCalledWith({
      statusId,
      limit: 1,
      offset: 1
    })
  })

  it('ignores a slow response that was superseded by a newer page', async () => {
    const slow = createDeferred<ReturnType<typeof page>>()
    ;(getStatusFavouritedBy as jest.Mock)
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce(page(['bob'], 2))
    const { result, rerender } = renderHook(
      (props: Params) => useFavouritedBy(props),
      {
        initialProps: { statusId, limit: 1, offset: 0, enabled: true } as Params
      }
    )

    rerender({ statusId, limit: 1, offset: 1, enabled: true })
    await waitFor(() =>
      expect(result.current.accounts[0]?.username).toBe('bob')
    )

    await act(async () => {
      slow.resolve(page(['alice'], 2))
    })

    expect(result.current.accounts.map((a) => a.username)).toEqual(['bob'])
    expect(result.current.isLoading).toBe(false)
  })

  it('keeps the known total when a later page reports zero', async () => {
    ;(getStatusFavouritedBy as jest.Mock)
      .mockResolvedValueOnce(page(['alice'], 5))
      .mockResolvedValueOnce(page([], 0))
    const { result, rerender } = renderHook(
      (props: Params) => useFavouritedBy(props),
      {
        initialProps: { statusId, limit: 1, offset: 0, enabled: true } as Params
      }
    )
    await waitFor(() => expect(result.current.totalCount).toBe(5))

    rerender({ statusId, limit: 1, offset: 50, enabled: true })

    await waitFor(() => expect(result.current.accounts).toEqual([]))
    expect(result.current.totalCount).toBe(5)
  })

  it('updates the total when a later page reports a different non-zero count', async () => {
    ;(getStatusFavouritedBy as jest.Mock)
      .mockResolvedValueOnce(page(['alice'], 5))
      .mockResolvedValueOnce(page(['bob'], 6))
    const { result, rerender } = renderHook(
      (props: Params) => useFavouritedBy(props),
      {
        initialProps: { statusId, limit: 1, offset: 0, enabled: true } as Params
      }
    )
    await waitFor(() => expect(result.current.totalCount).toBe(5))

    rerender({ statusId, limit: 1, offset: 1, enabled: true })

    await waitFor(() => expect(result.current.totalCount).toBe(6))
  })
})
