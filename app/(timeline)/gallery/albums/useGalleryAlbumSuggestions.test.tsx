/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from '@testing-library/react'

import { useGalleryAlbumSuggestions } from '@/app/(timeline)/gallery/albums/useGalleryAlbumSuggestions'
import { getGalleryAlbumSuggestions } from '@/lib/client'
import { buildSuggestion } from '@/lib/components/gallery/__fixtures__/galleryAlbumSuggestions'

vi.mock('@/lib/client', () => ({
  getGalleryAlbumSuggestions: vi.fn()
}))

const read = vi.mocked(getGalleryAlbumSuggestions)

describe('useGalleryAlbumSuggestions', () => {
  beforeEach(() => {
    read.mockReset()
  })

  it('starts loading, then holds the suggestions', async () => {
    const suggestion = buildSuggestion('trip:2026-09-12')
    read.mockResolvedValue({ suggestions: [suggestion] })
    const { result } = renderHook(() => useGalleryAlbumSuggestions())

    expect(result.current.state).toEqual({ status: 'loading' })
    await waitFor(() =>
      expect(result.current.state).toEqual({
        status: 'ready',
        suggestions: [suggestion]
      })
    )
    expect(read).toHaveBeenCalledWith({ timeZone: expect.any(String) })
  })

  it('holds the message of a failed read, and reads again on reload', async () => {
    read.mockRejectedValueOnce(new Error('Too many requests'))
    const { result } = renderHook(() => useGalleryAlbumSuggestions())

    await waitFor(() =>
      expect(result.current.state).toEqual({
        status: 'error',
        message: 'Too many requests'
      })
    )

    read.mockResolvedValueOnce({ suggestions: [] })
    await act(async () => {
      await result.current.reload()
    })
    expect(result.current.state).toEqual({ status: 'ready', suggestions: [] })
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('uses a plain message for an error that has none', async () => {
    read.mockRejectedValueOnce('boom')
    const { result } = renderHook(() => useGalleryAlbumSuggestions())

    await waitFor(() =>
      expect(result.current.state).toEqual({
        status: 'error',
        message: 'Failed to load suggestions.'
      })
    )
  })

  it('drops the answer of a read that a newer read replaced', async () => {
    let resolveFirst: (value: { suggestions: never[] }) => void = () => {}
    read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve
        })
    )
    const suggestion = buildSuggestion('species:sci:alcedo atthis')
    const { result } = renderHook(() => useGalleryAlbumSuggestions())

    read.mockResolvedValueOnce({ suggestions: [suggestion] })
    await act(async () => {
      await result.current.reload()
    })
    await act(async () => {
      resolveFirst({ suggestions: [] })
    })

    expect(result.current.state).toEqual({
      status: 'ready',
      suggestions: [suggestion]
    })
  })
})
