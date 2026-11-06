/**
 * @vitest-environment jsdom
 */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { stageShareFiles } from './shareTargetDb'
import { useShareTargetIntake } from './useShareTargetIntake'

const replace = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace })
}))

const limits = {
  maxMediaFileSize: 10 * 1024 * 1024,
  maxFitnessFileSize: 50 * 1024 * 1024,
  maxMediaAttachments: 4
}

const file = (name: string, type: string) =>
  new File([new Uint8Array([1, 2, 3])], name, { type })

const setSearch = (search: string) => {
  window.history.replaceState(null, '', `/app${search}`)
}

describe('useShareTargetIntake', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    replace.mockReset()
    setSearch('')
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('does nothing without a share parameter', async () => {
    const { result } = renderHook(() =>
      useShareTargetIntake({ enabled: true, limits })
    )

    await act(async () => {})
    expect(result.current).toEqual({
      seed: null,
      notice: null,
      unavailable: false
    })
  })

  it('seeds the composer with media and consumes the share once', async () => {
    const id = await stageShareFiles([file('photo.jpg', 'image/jpeg')])
    setSearch(`?share=${id}`)

    const { result } = renderHook(() =>
      useShareTargetIntake({ enabled: true, limits })
    )

    await waitFor(() => expect(result.current.seed).not.toBeNull())
    expect(result.current.seed!.media.map((f) => f.name)).toEqual(['photo.jpg'])
    expect(result.current.seed!.fitnessFile).toBeUndefined()
    expect(window.location.search).toBe('')

    // A second mount finds nothing: the record was deleted.
    const second = renderHook(() =>
      useShareTargetIntake({ enabled: true, limits })
    )
    await act(async () => {})
    expect(second.result.current.seed).toBeNull()
  })

  it('seeds the composer with one workout', async () => {
    const id = await stageShareFiles([
      file('run.fit', 'application/vnd.ant.fit')
    ])
    setSearch(`?share=${id}`)

    const { result } = renderHook(() =>
      useShareTargetIntake({ enabled: true, limits })
    )

    await waitFor(() => expect(result.current.seed).not.toBeNull())
    expect(result.current.seed!.fitnessFile?.name).toBe('run.fit')
    expect(result.current.seed!.media).toEqual([])
  })

  it('hands two workouts to the import page without consuming them', async () => {
    const id = await stageShareFiles([
      file('run.fit', 'application/vnd.ant.fit'),
      file('ride.gpx', 'application/gpx+xml')
    ])
    setSearch(`?share=${id}`)

    renderHook(() => useShareTargetIntake({ enabled: true, limits }))

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith(
        `/fitness/files?share=${encodeURIComponent(id!)}`
      )
    )
    expect(window.location.search).toBe('')
  })

  it('reports a share that could not be staged', async () => {
    setSearch('?shareUnavailable=1')

    const { result } = renderHook(() =>
      useShareTargetIntake({ enabled: true, limits })
    )

    await waitFor(() => expect(result.current.unavailable).toBe(true))
    expect(window.location.search).toBe('')
  })

  it('reports an expired or missing share as unavailable', async () => {
    setSearch('?share=missing')

    const { result } = renderHook(() =>
      useShareTargetIntake({ enabled: true, limits })
    )

    await waitFor(() => expect(result.current.unavailable).toBe(true))
  })

  it('reports skipped files', async () => {
    const id = await stageShareFiles([
      file('photo.heic', 'image/heic'),
      file('photo.jpg', 'image/jpeg')
    ])
    setSearch(`?share=${id}`)

    const { result } = renderHook(() =>
      useShareTargetIntake({ enabled: true, limits })
    )

    await waitFor(() => expect(result.current.seed).not.toBeNull())
    expect(result.current.notice).toContain('1 shared file was skipped')
  })

  it('waits until it is enabled', async () => {
    const id = await stageShareFiles([file('photo.jpg', 'image/jpeg')])
    setSearch(`?share=${id}`)

    const { result, rerender } = renderHook(
      ({ enabled }) => useShareTargetIntake({ enabled, limits }),
      { initialProps: { enabled: false } }
    )

    await act(async () => {})
    expect(result.current.seed).toBeNull()
    expect(window.location.search).toBe(`?share=${id}`)

    rerender({ enabled: true })
    await waitFor(() => expect(result.current.seed).not.toBeNull())
  })
})
