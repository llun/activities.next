'use client'

import { FolderPlus, X } from 'lucide-react'
import { FC } from 'react'

import { Button } from '@/lib/components/ui/button'

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
}) => (
  <div
    role="region"
    aria-label="Selection"
    className="bg-card sticky bottom-3 z-20 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-3 py-2.5 shadow-lg max-sm:bottom-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] sm:px-4"
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
        className="pointer-coarse:h-10"
        onClick={onSelectAllLoaded}
        disabled={loadedCount === 0 || count >= loadedCount}
      >
        Select all loaded
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="pointer-coarse:h-10"
        onClick={onClear}
        disabled={count === 0}
      >
        <X aria-hidden="true" />
        Clear
      </Button>
      <Button
        type="button"
        size="sm"
        className="pointer-coarse:h-10"
        onClick={onAddToAlbum}
        disabled={count === 0}
      >
        <FolderPlus aria-hidden="true" />
        Add to album
      </Button>
    </div>
  </div>
)
