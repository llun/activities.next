/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  type FitnessRouteDataResponse,
  getFitnessRouteData
} from '@/lib/client'

import {
  ROUTE_DATA_ERROR_MESSAGE,
  useActivityRouteData
} from './useActivityRouteData'

vi.mock('@/lib/client', () => ({
  getFitnessRouteData: vi.fn()
}))

const mockGetFitnessRouteData = vi.mocked(getFitnessRouteData)

const sampleRouteData = (duration: number): FitnessRouteDataResponse => ({
  samples: [{ lat: 13.7, lng: 100.5, elapsedSeconds: 0 }],
  totalDurationSeconds: duration
})

describe('useActivityRouteData', () => {
  beforeEach(() => {
    mockGetFitnessRouteData.mockReset()
  })

  it('re-fetches the current file when retry is called after a failure', async () => {
    mockGetFitnessRouteData.mockRejectedValueOnce(new Error('network error'))

    const { result } = renderHook(() => useActivityRouteData('fit-1'))

    expect(result.current.isLoading).toBe(true)
    expect(result.current.error).toBeNull()
    expect(result.current.data).toBeNull()

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })
    expect(result.current.error).toBe(ROUTE_DATA_ERROR_MESSAGE)
    expect(result.current.data).toBeNull()
    expect(mockGetFitnessRouteData).toHaveBeenCalledTimes(1)
    expect(mockGetFitnessRouteData).toHaveBeenLastCalledWith('fit-1')

    let resolveRetry!: (value: FitnessRouteDataResponse) => void
    mockGetFitnessRouteData.mockImplementationOnce(
      () =>
        new Promise<FitnessRouteDataResponse>((resolve) => {
          resolveRetry = resolve
        })
    )

    act(() => {
      result.current.retry()
    })

    expect(result.current.isLoading).toBe(true)
    expect(result.current.error).toBeNull()
    expect(result.current.data).toBeNull()
    expect(mockGetFitnessRouteData).toHaveBeenCalledTimes(2)
    expect(mockGetFitnessRouteData).toHaveBeenLastCalledWith('fit-1')

    const payload = sampleRouteData(1800)
    await act(async () => {
      resolveRetry(payload)
    })

    expect(result.current.isLoading).toBe(false)
    expect(result.current.error).toBeNull()
    expect(result.current.data).toEqual(payload)
  })

  it('drops a late response from an earlier file, and retries the current file', async () => {
    let resolveFileA!: (value: FitnessRouteDataResponse) => void
    let resolveFileB!: (value: FitnessRouteDataResponse) => void

    mockGetFitnessRouteData
      .mockImplementationOnce(
        () =>
          new Promise<FitnessRouteDataResponse>((resolve) => {
            resolveFileA = resolve
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise<FitnessRouteDataResponse>((resolve) => {
            resolveFileB = resolve
          })
      )

    const { result, rerender } = renderHook(
      ({ fileId }: { fileId: string | null }) => useActivityRouteData(fileId),
      { initialProps: { fileId: 'fit-a' } }
    )

    expect(mockGetFitnessRouteData).toHaveBeenCalledWith('fit-a')

    // Switch to file B before file A resolves.
    rerender({ fileId: 'fit-b' })
    expect(mockGetFitnessRouteData).toHaveBeenCalledWith('fit-b')

    const payloadA = sampleRouteData(1200)
    const payloadB = sampleRouteData(2400)

    await act(async () => {
      resolveFileA(payloadA)
    })

    // File A's late response is dropped; file B is still loading.
    expect(result.current.isLoading).toBe(true)
    expect(result.current.data).toBeNull()

    await act(async () => {
      resolveFileB(payloadB)
    })

    expect(result.current.isLoading).toBe(false)
    expect(result.current.data).toEqual(payloadB)

    // Retrying now re-fetches file B, never file A.
    const refreshedB = sampleRouteData(2500)
    mockGetFitnessRouteData.mockResolvedValueOnce(refreshedB)

    act(() => {
      result.current.retry()
    })

    expect(mockGetFitnessRouteData).toHaveBeenLastCalledWith('fit-b')
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })
    expect(result.current.data).toEqual(refreshedB)
  })
})
