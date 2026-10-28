/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getAccountImport } from '@/lib/client/accountImports'
import { ApiRequestError } from '@/lib/client/http'

import { useImportPolling } from './useImportPolling'

const mocks = vi.hoisted(() => ({
  offline: false,
  restored: null as (() => void) | null,
  get: vi.fn()
}))

vi.mock('@/lib/client/accountImports', () => ({
  getAccountImport: mocks.get
}))
vi.mock('@/lib/hooks/useConnectionStatus', () => ({
  useConnectionStatus: () => ({ state: mocks.offline ? 'offline' : 'online' })
}))
vi.mock('@/lib/client/connection', () => ({
  onConnectionRestored: (listener: () => void) => {
    mocks.restored = listener
    return () => {
      mocks.restored = null
    }
  }
}))

const queuedImport = {
  id: 'import-1',
  status: 'queued' as const,
  kind: null,
  phase: null,
  progress: {
    version: 1 as const,
    sourceActorId: null,
    sourceFollowersUrl: null,
    statusOrder: 'newest-first' as const,
    catalogStage: 'statuses' as const,
    catalogIndex: 0,
    totalItems: 0,
    completedItems: 0,
    skippedItems: 0,
    continuationCount: 0
  },
  createdAt: '2026-10-28T10:00:00.000Z',
  startedAt: '2026-10-28T10:00:30.000Z',
  finishedAt: null,
  lastErrorCode: null
}

// A queued row that was never started: an upload waiting for its start, not
// an import the server is moving.
const neverStartedImport = { ...queuedImport, startedAt: null }

beforeEach(() => {
  vi.useFakeTimers()
  mocks.offline = false
  mocks.restored = null
  mocks.get.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('useImportPolling', () => {
  it('polls every three seconds and stops when the import becomes terminal', async () => {
    mocks.get
      .mockResolvedValueOnce({ ...queuedImport, status: 'running' })
      .mockResolvedValueOnce({ ...queuedImport, status: 'done' })
    const { result } = renderHook(() =>
      useImportPolling({ actorId: 'actor-1', initialImport: queuedImport })
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_999)
    })
    expect(getAccountImport).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(getAccountImport).toHaveBeenCalledTimes(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000)
    })
    expect(getAccountImport).toHaveBeenCalledTimes(2)
    expect(result.current.accountImport?.status).toBe('done')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000)
    })
    expect(getAccountImport).toHaveBeenCalledTimes(2)
  })

  it('pauses while offline and refreshes when the connection is restored', async () => {
    mocks.offline = true
    mocks.get.mockResolvedValue({ ...queuedImport, status: 'running' })
    const { result, rerender } = renderHook(() =>
      useImportPolling({ actorId: 'actor-1', initialImport: queuedImport })
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000)
    })
    expect(getAccountImport).not.toHaveBeenCalled()

    mocks.offline = false
    rerender()
    await act(async () => {
      mocks.restored?.()
      await Promise.resolve()
    })
    expect(getAccountImport).toHaveBeenCalledTimes(1)
    expect(result.current.accountImport?.status).toBe('running')
  })

  it('stops polling after a 409 actor mismatch', async () => {
    mocks.get
      .mockRejectedValueOnce(new ApiRequestError('Actor changed', 409))
      .mockResolvedValue({ ...queuedImport, status: 'running' })
    const { result } = renderHook(() =>
      useImportPolling({ actorId: 'actor-1', initialImport: queuedImport })
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000)
    })
    expect(getAccountImport).toHaveBeenCalledTimes(1)
    expect(result.current.actorChanged).toBe(true)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_000)
    })
    expect(getAccountImport).toHaveBeenCalledTimes(1)
  })

  it('clears its polling interval when unmounted', async () => {
    const { unmount } = renderHook(() =>
      useImportPolling({ actorId: 'actor-1', initialImport: queuedImport })
    )
    unmount()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000)
    })
    expect(getAccountImport).not.toHaveBeenCalled()
  })

  it('never polls a queued upload that was not started', async () => {
    mocks.get.mockResolvedValue({ ...queuedImport, status: 'running' })
    renderHook(() =>
      useImportPolling({
        actorId: 'actor-1',
        initialImport: neverStartedImport
      })
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000)
    })
    expect(getAccountImport).not.toHaveBeenCalled()
  })

  it('drops a poll answer that arrives after the state was set', async () => {
    let answerPoll: ((value: unknown) => void) | undefined
    mocks.get.mockImplementation(
      () =>
        new Promise((resolve) => {
          answerPoll = resolve
        })
    )
    const { result } = renderHook(() =>
      useImportPolling({ actorId: 'actor-1', initialImport: queuedImport })
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000)
    })
    expect(getAccountImport).toHaveBeenCalledTimes(1)

    // The user discards the import while the poll is still in flight.
    await act(async () => {
      result.current.setAccountImport(null)
    })
    await act(async () => {
      answerPoll?.({ ...queuedImport, status: 'running' })
      await Promise.resolve()
    })

    expect(result.current.accountImport).toBeNull()
  })
})
