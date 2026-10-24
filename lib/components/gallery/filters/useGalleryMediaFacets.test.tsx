/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getGalleryMediaFacets } from '@/lib/client'
import { useGalleryMediaFacets } from '@/lib/components/gallery/filters/useGalleryMediaFacets'
import type { GalleryMediaFacetsResponse } from '@/lib/services/gallery/galleryEntities'
import { createDeferred } from '@/lib/testing/deferred'

vi.mock('@/lib/client', () => ({ getGalleryMediaFacets: vi.fn() }))

const facets = (total: number): GalleryMediaFacetsResponse => ({
  total,
  species: [],
  places: [],
  noPlaceCount: 0,
  months: [],
  activities: [],
  notFromActivityCount: 0
})

describe('useGalleryMediaFacets', () => {
  beforeEach(() => {
    vi.mocked(getGalleryMediaFacets).mockReset()
  })

  it('loads the facets for the show', async () => {
    vi.mocked(getGalleryMediaFacets).mockResolvedValue(facets(5))

    const { result } = renderHook(() => useGalleryMediaFacets('in_gallery'))
    expect(result.current).toEqual({ facets: null, error: null })

    await waitFor(() => expect(result.current.facets).toEqual(facets(5)))
    expect(getGalleryMediaFacets).toHaveBeenCalledWith({ show: 'in_gallery' })
  })

  it('drops an answer for a show that is no longer asked for', async () => {
    const first = createDeferred<GalleryMediaFacetsResponse>()
    vi.mocked(getGalleryMediaFacets)
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(facets(2))

    const { result, rerender } = renderHook(
      ({ show }: { show: 'all' | 'hidden' }) => useGalleryMediaFacets(show),
      { initialProps: { show: 'all' } }
    )
    rerender({ show: 'hidden' })
    await waitFor(() => expect(result.current.facets).toEqual(facets(2)))

    await act(async () => {
      first.resolve(facets(99))
    })

    expect(result.current.facets).toEqual(facets(2))
  })

  it('refetches when reloadKey changes', async () => {
    vi.mocked(getGalleryMediaFacets)
      .mockResolvedValueOnce(facets(1))
      .mockResolvedValueOnce(facets(3))

    const { result, rerender } = renderHook(
      ({ key }: { key: number }) => useGalleryMediaFacets('all', key),
      { initialProps: { key: 0 } }
    )
    await waitFor(() => expect(result.current.facets).toEqual(facets(1)))
    rerender({ key: 1 })

    expect(result.current.facets).toBeNull()
    await waitFor(() => expect(result.current.facets).toEqual(facets(3)))
  })

  it('reports a rejected request as an error', async () => {
    vi.mocked(getGalleryMediaFacets).mockRejectedValue(new Error('nope'))

    const { result } = renderHook(() => useGalleryMediaFacets('all'))

    await waitFor(() => expect(result.current.error).toBe('nope'))
    expect(result.current.facets).toBeNull()
  })
})
