'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { readViewerTimeZone } from '@/app/(timeline)/fitness/useViewerTimeZone'
import { getGalleryAlbumSuggestions } from '@/lib/client'
import type { GalleryAlbumSuggestionEntity } from '@/lib/services/gallery/galleryAlbumSuggestionEntities'

export type GalleryAlbumSuggestionsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; suggestions: GalleryAlbumSuggestionEntity[] }

/**
 * The owner's album suggestions, read once when the component mounts and again
 * on `reload`. They are computed on the server for every read, so a result is
 * only as fresh as that read. The viewer's time zone goes with it, read after
 * mount so the server's HTML never depends on it.
 */
export const useGalleryAlbumSuggestions = () => {
  const [state, setState] = useState<GalleryAlbumSuggestionsState>({
    status: 'loading'
  })
  // Bumped by every read so a slow answer to an older one is dropped.
  const generation = useRef(0)

  const load = useCallback(async () => {
    const current = ++generation.current
    setState({ status: 'loading' })
    try {
      const response = await getGalleryAlbumSuggestions({
        timeZone: readViewerTimeZone()
      })
      if (current !== generation.current) return
      setState({ status: 'ready', suggestions: response.suggestions })
    } catch (error) {
      if (current !== generation.current) return
      setState({
        status: 'error',
        message:
          error instanceof Error ? error.message : 'Failed to load suggestions.'
      })
    }
  }, [])

  useEffect(() => {
    void load()
    return () => {
      generation.current += 1
    }
  }, [load])

  return { state, reload: load }
}
