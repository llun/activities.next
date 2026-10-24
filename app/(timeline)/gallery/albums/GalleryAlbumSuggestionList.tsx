'use client'

import { Folder, Sparkles } from 'lucide-react'
import { FC, useMemo } from 'react'

import { Alert } from '@/lib/components/surface/Alert'
import { Button } from '@/lib/components/ui/button'
import type { GalleryAlbumSuggestionEntity } from '@/lib/services/gallery/galleryAlbumSuggestionEntities'
import { cn } from '@/lib/utils'

import { GalleryAlbumThumb } from './GalleryAlbumThumb'
import {
  getAddIntentSuggestions,
  getNonMemberIds,
  getSuggestionMeta
} from './galleryAlbumSuggestionsUi'
import type { GalleryAlbumSuggestionsState } from './useGalleryAlbumSuggestions'

export interface GalleryAlbumSuggestionListProps {
  state: GalleryAlbumSuggestionsState
  onRetry: () => void
  /** The suggestion whose photos are selected now, if any. */
  activeId: string | null
  onUse: (suggestion: GalleryAlbumSuggestionEntity) => void
  disabled?: boolean
  existingIds?: readonly string[]
}

/**
 * The Suggestions tab's list: one row per suggestion with a "Use N" button, and
 * the loading, empty and error states. It only reports a choice; the dialog
 * selects the photos and fills the title, and saves nothing.
 */
export const GalleryAlbumSuggestionList: FC<
  GalleryAlbumSuggestionListProps
> = ({ state, onRetry, activeId, onUse, disabled = false, existingIds }) => {
  const existingSet = useMemo(
    () => (existingIds ? new Set(existingIds) : null),
    [existingIds]
  )

  const suggestions = useMemo(() => {
    if (state.status !== 'ready') return []
    if (!existingSet) return state.suggestions
    return getAddIntentSuggestions(state.suggestions, existingSet)
  }, [state, existingSet])

  if (state.status === 'loading') {
    return (
      <div role="status" aria-busy="true" className="space-y-2">
        <span className="sr-only">Loading suggestions</span>
        {Array.from({ length: 3 }, (_, index) => (
          <div
            key={index}
            aria-hidden="true"
            className="skeleton h-[4.5rem] rounded-lg"
          />
        ))}
      </div>
    )
  }

  if (state.status === 'error') {
    return <Alert title={state.message} onRetry={onRetry} />
  }

  if (suggestions.length === 0) {
    return (
      <div className="bg-muted/40 flex flex-col items-center gap-2 rounded-lg border p-6 text-center">
        <span
          aria-hidden="true"
          className="bg-background flex size-10 items-center justify-center rounded-lg border"
        >
          <Sparkles className="text-muted-foreground size-5" />
        </span>
        <p className="text-sm font-semibold">No suggestions right now</p>
        <p className="text-muted-foreground text-sm">
          Trips, species you have photographed five times and days with a
          recorded activity show up here once you have enough photos. Use From
          gallery to pick photos yourself.
        </p>
      </div>
    )
  }

  return (
    <ul className="space-y-2" aria-label="Suggested albums">
      {suggestions.map((suggestion) => {
        const isActive = suggestion.id === activeId
        const notInAlbum = existingSet
          ? getNonMemberIds(suggestion, existingSet).length
          : undefined
        const count = notInAlbum ?? suggestion.photoCount
        const formattedCount = count.toLocaleString('en-US')
        return (
          <li
            key={suggestion.id}
            className={cn(
              'flex items-center gap-3 rounded-lg border p-2.5',
              isActive && 'border-primary bg-primary/5'
            )}
          >
            <span
              aria-hidden="true"
              className="bg-muted/40 text-muted-foreground flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md border"
            >
              {suggestion.preview ? (
                <GalleryAlbumThumb item={suggestion.preview} />
              ) : (
                <Folder className="size-5" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold break-words">
                {suggestion.title}
              </p>
              <p className="text-muted-foreground text-xs break-words">
                {getSuggestionMeta(suggestion, notInAlbum)}
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant={isActive ? 'default' : 'outline'}
              disabled={disabled}
              onClick={() => onUse(suggestion)}
              // The row in use is marked, but the button is not a toggle: using
              // it again only selects its photos again.
              aria-current={isActive ? 'true' : undefined}
              // Starts with the visible text, so voice control can say it.
              aria-label={`Use ${formattedCount} photos from ${suggestion.title}`}
              className="pointer-coarse:h-10 shrink-0"
            >
              Use {formattedCount}
            </Button>
          </li>
        )
      })}
    </ul>
  )
}
