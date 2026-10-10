'use client'

import { FolderPlus, Pencil, Send, Trash2, X } from 'lucide-react'
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

/** Edit details opens one dialog and reads every photo's details, so it is capped. */
export const MAX_EDIT_DETAILS_PHOTOS = 40

interface Props {
  count: number
  /** How many photos are loaded to choose from. */
  loadedCount: number
  onSelectAllLoaded: () => void
  onClear: () => void
  onAddToAlbum: () => void
  onEditDetails: () => void
  /** How many of the selected photos are hidden from the gallery (never in an album). */
  hiddenCount?: number
  /**
   * Whether every selected photo was added in Gallery and is not posted yet.
   * Post and Delete only act on those, so they are off for any other selection.
   */
  allUnposted?: boolean
  /** The most photos one post holds on this instance. */
  maxPostAttachments?: number
  onPost?: () => void
  onDelete?: () => void
}

/**
 * The bar that rides the bottom of the page while photos are selected:
 * "N selected" with the Edit details, Add to album, Post and Delete actions. Albums hold only
 * photos shown in the gallery, so Add to album is off while only hidden photos
 * are selected, and says so. It is a toolbar region, so a screen reader can find
 * it, and the count is a polite live region so every tick of a
 * tile is spoken.
 */
export const GallerySelectionBar: FC<Props> = ({
  count,
  loadedCount,
  onSelectAllLoaded,
  onClear,
  onAddToAlbum,
  onEditDetails,
  hiddenCount = 0,
  allUnposted = false,
  maxPostAttachments = Number.POSITIVE_INFINITY,
  onPost,
  onDelete
}) => {
  const allSelected = loadedCount === 0 || count >= loadedCount
  const canAdd = count > hiddenCount
  const canEdit = count <= MAX_EDIT_DETAILS_PHOTOS
  const addHint =
    count > 0 && hiddenCount > 0
      ? canAdd
        ? `${hiddenCount.toLocaleString('en-US')} hidden ${hiddenCount === 1 ? 'photo' : 'photos'} will be skipped: albums hold only photos shown in your gallery.`
        : 'Hidden photos can’t be added to albums. Turn on Show in my gallery first.'
      : null
  const editHint = canEdit
    ? null
    : `Edit up to ${MAX_EDIT_DETAILS_PHOTOS} at a time`
  // Post and Delete are for photos added in Gallery that no post uses yet.
  const unpostedOnly = count > 0 && !allUnposted
  const canPost = count > 0 && allUnposted && count <= maxPostAttachments
  const canDelete = count > 0 && allUnposted
  const unpostedHint = unpostedOnly ? 'Only photos you haven’t posted' : null
  const postLimitHint =
    count > maxPostAttachments && allUnposted
      ? `Up to ${maxPostAttachments} per post`
      : null
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
        {addHint || editHint || unpostedHint || postLimitHint ? (
          <span
            id={`${GALLERY_SELECTION_BAR_ID}-hint`}
            className="text-muted-foreground block text-xs font-normal"
          >
            {[editHint, addHint, unpostedHint, postLimitHint]
              .filter(Boolean)
              .join(' ')}
          </span>
        ) : null}
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
          variant="outline"
          className={cn('pointer-coarse:h-10', DISABLED_CLASS)}
          onClick={() => {
            if (count > 0 && canEdit) onEditDetails()
          }}
          aria-disabled={count === 0 || !canEdit || undefined}
          aria-describedby={
            editHint ? `${GALLERY_SELECTION_BAR_ID}-hint` : undefined
          }
        >
          <Pencil aria-hidden="true" />
          Edit details
        </Button>
        <Button
          type="button"
          size="sm"
          className={cn('pointer-coarse:h-10', DISABLED_CLASS)}
          onClick={() => {
            if (count > 0 && canAdd) onAddToAlbum()
          }}
          aria-disabled={count === 0 || !canAdd || undefined}
          aria-describedby={
            addHint ? `${GALLERY_SELECTION_BAR_ID}-hint` : undefined
          }
        >
          <FolderPlus aria-hidden="true" />
          Add to album
        </Button>
        {onPost ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={cn('pointer-coarse:h-10', DISABLED_CLASS)}
            onClick={() => {
              if (canPost) onPost()
            }}
            aria-disabled={!canPost || undefined}
            aria-describedby={
              unpostedHint || postLimitHint
                ? `${GALLERY_SELECTION_BAR_ID}-hint`
                : undefined
            }
          >
            <Send aria-hidden="true" />
            Post
          </Button>
        ) : null}
        {onDelete ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={cn(
              'text-destructive hover:text-destructive pointer-coarse:h-10',
              DISABLED_CLASS
            )}
            onClick={() => {
              if (canDelete) onDelete()
            }}
            aria-disabled={!canDelete || undefined}
            aria-describedby={
              unpostedHint ? `${GALLERY_SELECTION_BAR_ID}-hint` : undefined
            }
          >
            <Trash2 aria-hidden="true" />
            Delete
          </Button>
        ) : null}
      </div>
    </div>
  )
}
