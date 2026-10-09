'use client'

import { Folder, Sparkles } from 'lucide-react'
import { FC } from 'react'

import { Button } from '@/lib/components/ui/button'
import type { GalleryAlbumSuggestionEntity } from '@/lib/services/gallery/galleryAlbumSuggestionEntities'
import { cn } from '@/lib/utils'

import { GalleryAlbumThumb } from './GalleryAlbumThumb'
import { getSuggestionMeta } from './galleryAlbumSuggestionsUi'
import type { GalleryAlbumSuggestionsState } from './useGalleryAlbumSuggestions'

interface Props {
  state: GalleryAlbumSuggestionsState
  onRetry: () => void
  /** The suggestion whose photos are selected now, if any. */
  activeId: string | null
  onUse: (suggestion: GalleryAlbumSuggestionEntity) => void
  disabled?: boolean
}

/**
 * The Suggestions tab's list: one row per suggestion with a "Use N" button, and
 * the loading, empty and error states. It only reports a choice; the dialog
 * selects the photos and fills the title, and saves nothing.
 */
export const GalleryAlbumSuggestionList: FC<Props> = ({
  state,
  onRetry,
  activeId,
  onUse,
  disabled = false
}) => {
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
    return (
      <div className="space-y-2">
        <p role="alert" className="text-destructive text-sm">
          {state.message}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="pointer-coarse:h-10"
          onClick={onRetry}
        >
          Try again
        </Button>
      </div>
    )
  }

  if (state.suggestions.length === 0) {
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
      {state.suggestions.map((suggestion) => {
        const isActive = suggestion.id === activeId
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
                {getSuggestionMeta(suggestion)}
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
              aria-label={`Use ${suggestion.photoCount.toLocaleString('en-US')} photos from ${suggestion.title}`}
              className="pointer-coarse:h-10 shrink-0"
            >
              Use {suggestion.photoCount.toLocaleString('en-US')}
            </Button>
          </li>
        )
      })}
    </ul>
  )
}
