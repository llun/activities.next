'use client'

import { useEffect, useState } from 'react'

import { getGalleryMediaFacets } from '@/lib/client'
import type { GalleryMediaFacetsResponse } from '@/lib/services/gallery/galleryEntities'
import type { GalleryShow } from '@/lib/types/database/gallery'

interface FacetsResult {
  show: GalleryShow
  reloadKey: number
  facets: GalleryMediaFacetsResponse | null
  error: string | null
}

/**
 * The owner's filter-menu values for photos in `show`. `facets` is null while
 * loading (and after `show` or `reloadKey` changes, until the new answer
 * lands); an answer for an earlier `show` is dropped. Bump `reloadKey` to
 * refetch after the photos change.
 */
export const useGalleryMediaFacets = (
  show: GalleryShow,
  reloadKey = 0
): { facets: GalleryMediaFacetsResponse | null; error: string | null } => {
  const [result, setResult] = useState<FacetsResult | null>(null)

  useEffect(() => {
    let current = true
    // Inside a promise so a missing client export rejects here instead of
    // throwing during render.
    Promise.resolve()
      .then(() => getGalleryMediaFacets({ show }))
      .then(
        (facets) => {
          if (current) setResult({ show, reloadKey, facets, error: null })
        },
        (error: unknown) => {
          if (!current) return
          setResult({
            show,
            reloadKey,
            facets: null,
            error:
              error instanceof Error
                ? error.message
                : 'Failed to load the photo filters.'
          })
        }
      )
    return () => {
      current = false
    }
  }, [show, reloadKey])

  if (!result || result.show !== show || result.reloadKey !== reloadKey) {
    return { facets: null, error: null }
  }
  return { facets: result.facets, error: result.error }
}
