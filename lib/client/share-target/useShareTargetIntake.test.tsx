/**
 * @vitest-environment jsdom
 */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  deleteStagedShare,
  peekStagedShare,
  stageShareFiles
} from './shareTargetDb'
import { useShareTargetIntake } from './useShareTargetIntake'

const replace = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace })
}))

const limits = {
  maxMediaFileSize: 10 * 1024 * 1024,
  maxFitnessFileSize: 50 * 1024 * 1024,
  maxMediaAttachments: 4,
  isMediaUploadEnabled: true
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
    expect(result.current).toMatchObject({
      seed: null,
      pending: null,
      notice: null,
      unavailable: false,
      expired: false
    })
  })

  // Any site can submit a share to this origin: nothing reaches the composer
  // (and so nothing uploads) until the reader confirms it.
  it('asks before using a share, then consumes it once on accept', async () => {
    const id = await stageShareFiles([file('photo.jpg', 'image/jpeg')])
    setSearch(`?share=${id}`)

    const { result } = renderHook(() =>
      useShareTargetIntake({ enabled: true, limits })
    )

    await waitFor(() => expect(result.current.pending).not.toBeNull())
    expect(result.current.seed).toBeNull()
    expect(result.current.pending!.summary).toBe('1 photo was shared')
    expect(result.current.pending!.media.map((f) => f.name)).toEqual([
      'photo.jpg'
    ])
    // Kept until the reader decides, so a reload asks again.
    expect(window.location.search).toBe(`?share=${id}`)
    expect(await peekStagedShare(id!)).not.toBeNull()

    await act(async () => {
      await result.current.accept()
    })

    expect(result.current.seed!.media.map((f) => f.name)).toEqual(['photo.jpg'])
    expect(result.current.seed!.fitnessFile).toBeUndefined()
    expect(result.current.pending).toBeNull()
    expect(window.location.search).toBe('')
    expect(await peekStagedShare(id!)).toBeNull()
  })

  // The manifest's title/text/url params let Android offer the app for a
  // plain link share: it is confirmed like files, then seeds the text.
  it('asks before using a shared link, then seeds it as text', async () => {
    const id = await stageShareFiles([], {
      title: 'A trail',
      url: 'https://example.com/trail'
    })
    setSearch(`?share=${id}`)

    const { result } = renderHook(() =>
      useShareTargetIntake({ enabled: true, limits })
    )

    await waitFor(() => expect(result.current.pending).not.toBeNull())
    expect(result.current.pending!.summary).toBe('Some text was shared')
    expect(result.current.pending!.text).toBe(
      'A trail\nhttps://example.com/trail'
    )
    expect(result.current.seed).toBeNull()

    await act(async () => {
      await result.current.accept()
    })

    expect(result.current.seed).toEqual({
      media: [],
      fitnessFile: undefined,
      text: 'A trail\nhttps://example.com/trail'
    })
  })

  it('names a bare link share as a link', async () => {
    const id = await stageShareFiles([], { url: 'https://example.com/a' })
    setSearch(`?share=${id}`)

    const { result } = renderHook(() =>
      useShareTargetIntake({ enabled: true, limits })
    )

    await waitFor(() => expect(result.current.pending).not.toBeNull())
    expect(result.current.pending!.summary).toBe('A link was shared')
  })

  it('offers text only, for a text share', async () => {
    const id = await stageShareFiles([], { text: 'Felt strong today' })
    setSearch(`?share=${id}`)

    const { result } = renderHook(() =>
      useShareTargetIntake({ enabled: true, limits })
    )

    await waitFor(() => expect(result.current.pending).not.toBeNull())
    expect(result.current.pending!.text).toBe('Felt strong today')
    expect(result.current.pending!.media).toEqual([])
  })

  it('carries text alongside shared files', async () => {
    const id = await stageShareFiles([file('photo.jpg', 'image/jpeg')], {
      text: 'Summit',
      url: 'https://example.com/s'
    })
    setSearch(`?share=${id}`)

    const { result } = renderHook(() =>
      useShareTargetIntake({ enabled: true, limits })
    )

    await waitFor(() => expect(result.current.pending).not.toBeNull())
    expect(result.current.pending!.summary).toBe(
      '1 photo and some text were shared'
    )
    await act(async () => {
      await result.current.accept()
    })
    expect(result.current.seed!.media.map((f) => f.name)).toEqual(['photo.jpg'])
    expect(result.current.seed!.text).toBe('Summit\nhttps://example.com/s')
  })

  // StagedShare.skipped: files the worker refused (over 20, or the budget).
  it('names the files the worker could not keep', async () => {
    const id = await stageShareFiles([file('photo.jpg', 'image/jpeg')], {
      skipped: 3
    })
    setSearch(`?share=${id}`)

    const { result } = renderHook(() =>
      useShareTargetIntake({ enabled: true, limits })
    )

    await waitFor(() => expect(result.current.pending).not.toBeNull())
    expect(result.current.notice).toContain('3 files were past the share limit')
  })

  it('asks again after a reload until the reader decides', async () => {
    const id = await stageShareFiles([file('photo.jpg', 'image/jpeg')])
    setSearch(`?share=${id}`)

    const first = renderHook(() =>
      useShareTargetIntake({ enabled: true, limits })
    )
    await waitFor(() => expect(first.result.current.pending).not.toBeNull())
    first.unmount()

    const second = renderHook(() =>
      useShareTargetIntake({ enabled: true, limits })
    )
    await waitFor(() => expect(second.result.current.pending).not.toBeNull())
    expect(second.result.current.pending!.id).toBe(id)
  })

  it('deletes a discarded share without seeding the composer', async () => {
    const id = await stageShareFiles([file('photo.jpg', 'image/jpeg')])
    setSearch(`?share=${id}`)

    const { result } = renderHook(() =>
      useShareTargetIntake({ enabled: true, limits })
    )
    await waitFor(() => expect(result.current.pending).not.toBeNull())

    await act(async () => {
      await result.current.discard()
    })

    expect(result.current.seed).toBeNull()
    expect(result.current.pending).toBeNull()
    expect(window.location.search).toBe('')
    expect(await peekStagedShare(id!)).toBeNull()
  })

  it('offers one workout for the composer', async () => {
    const id = await stageShareFiles([
      file('run.fit', 'application/vnd.ant.fit')
    ])
    setSearch(`?share=${id}`)

    const { result } = renderHook(() =>
      useShareTargetIntake({ enabled: true, limits })
    )

    await waitFor(() => expect(result.current.pending).not.toBeNull())
    expect(result.current.pending!.summary).toBe('1 workout was shared')
    await act(async () => {
      await result.current.accept()
    })
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

  it('reports an expired or missing share as expired, not unavailable', async () => {
    setSearch('?share=missing')

    const { result } = renderHook(() =>
      useShareTargetIntake({ enabled: true, limits })
    )

    await waitFor(() => expect(result.current.expired).toBe(true))
    expect(result.current.unavailable).toBe(false)
  })

  // The record can expire or be evicted while the prompt is on screen.
  it('reports a share gone by the time Add to post is pressed as expired', async () => {
    const id = await stageShareFiles([file('photo.jpg', 'image/jpeg')])
    setSearch(`?share=${id}`)
    const { result } = renderHook(() =>
      useShareTargetIntake({ enabled: true, limits })
    )
    await waitFor(() => expect(result.current.pending).not.toBeNull())
    await deleteStagedShare(id!)

    await act(async () => {
      await result.current.accept()
    })

    expect(result.current.expired).toBe(true)
    expect(result.current.unavailable).toBe(false)
    expect(result.current.seed).toBeNull()
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

    await waitFor(() => expect(result.current.pending).not.toBeNull())
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
    expect(result.current.pending).toBeNull()
    expect(window.location.search).toBe(`?share=${id}`)

    rerender({ enabled: true })
    await waitFor(() => expect(result.current.pending).not.toBeNull())
  })
})
