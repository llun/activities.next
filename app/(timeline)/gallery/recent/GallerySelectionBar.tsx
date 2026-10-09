'use client'

import { FolderPlus, X } from 'lucide-react'
import { FC } from 'react'

import { Button } from '@/lib/components/ui/button'
import { cn } from '@/lib/utils'

/** The bar's id, so a skip link can send focus to it. */
export const GALLERY_SELECTION_BAR_ID = 'gallery-selection-bar'

// A button that has nothing to do is `aria-disabled` rather than `disabled`:
// the one just pressed (Select all loaded, Clear) keeps focus instead of
// dropping it to the page.
const DISABLED_CLASS =
  'aria-disabled:pointer-events-none aria-disabled:opacity-50'

interface Props {
  count: number
  /** How many photos are loaded to choose from. */
  loadedCount: number
  onSelectAllLoaded: () => void
  onClear: () => void
  onAddToAlbum: () => void
}

/**
 * The bar that rides the bottom of the page while photos are selected:
 * "N selected" and the Add to album action. It is a toolbar region, so a screen
 * reader can find it, and the count is a polite live region so every tick of a
 * tile is spoken.
 */
export const GallerySelectionBar: FC<Props> = ({
  count,
  loadedCount,
  onSelectAllLoaded,
  onClear,
  onAddToAlbum
}) => {
  const allSelected = loadedCount === 0 || count >= loadedCount
  return (
    <div
      id={GALLERY_SELECTION_BAR_ID}
      role="region"
      aria-label="Selection"
      tabIndex={-1}
      className="bg-card focus-visible:ring-ring/50 sticky bottom-3 z-20 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-3 py-2.5 shadow-lg outline-none focus-visible:ring-[3px] max-sm:bottom-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] sm:px-4"
    >
      <p
        role="status"
        aria-live="polite"
        className="min-w-0 flex-1 text-sm font-medium tabular-nums"
      >
        {count.toLocaleString('en-US')} selected
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn('pointer-coarse:h-10', DISABLED_CLASS)}
          onClick={() => {
            if (!allSelected) onSelectAllLoaded()
          }}
          aria-disabled={allSelected || undefined}
        >
          Select all loaded
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn('pointer-coarse:h-10', DISABLED_CLASS)}
          onClick={() => {
            if (count > 0) onClear()
          }}
          aria-disabled={count === 0 || undefined}
        >
          <X aria-hidden="true" />
          Clear
        </Button>
        <Button
          type="button"
          size="sm"
          className={cn('pointer-coarse:h-10', DISABLED_CLASS)}
          onClick={() => {
            if (count > 0) onAddToAlbum()
          }}
          aria-disabled={count === 0 || undefined}
        >
          <FolderPlus aria-hidden="true" />
          Add to album
        </Button>
      </div>
    </div>
  )
}
