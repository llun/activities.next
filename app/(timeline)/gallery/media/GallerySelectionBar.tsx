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
  /** How many of the currently loaded photos are in the selection. */
  loadedSelectedCount: number
  /** The action set when some selected photos are not hydrated yet. */
  actionCount?: number
  /** At least one selected id has no hydrated item yet. */
  selectionIncomplete?: boolean
  hydrationPending?: boolean
  hydrationMessage?: string
  onRetryLoading?: () => void
  /** The host may place this bar in a sticky stack with feedback above it. */
  sticky?: boolean
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
 * "N selected" with the Edit details, Add to album, Post and Delete actions.
 * It is a toolbar region, so a screen reader can find it, and the count is a
 * polite live region so every tick of a tile is spoken.
 */
export const GallerySelectionBar: FC<Props> = ({
  count,
  loadedCount,
  onSelectAllLoaded,
  onClear,
  onAddToAlbum,
  onEditDetails,
  loadedSelectedCount = 0,
  actionCount = count,
  selectionIncomplete = false,
  hydrationPending = false,
  hydrationMessage,
  onRetryLoading,
  sticky = true,
  allUnposted = false,
  maxPostAttachments = Number.POSITIVE_INFINITY,
  onPost,
  onDelete
}) => {
  const allSelected = loadedCount === 0 || loadedSelectedCount >= loadedCount
  const canEdit = actionCount <= MAX_EDIT_DETAILS_PHOTOS
  const editHint = canEdit
    ? null
    : `Edit up to ${MAX_EDIT_DETAILS_PHOTOS} at a time`
  // Post and Delete are for photos added in Gallery that no post uses yet.
  const unpostedOnly = actionCount > 0 && !allUnposted
  const canPost =
    actionCount > 0 && allUnposted && actionCount <= maxPostAttachments
  const canDelete = actionCount > 0 && allUnposted
  const unpostedHint = unpostedOnly ? 'Only photos you haven’t posted' : null
  const postLimitHint =
    actionCount > maxPostAttachments && allUnposted
      ? `Up to ${maxPostAttachments} per post`
      : null
  const hydrationHintId = `${GALLERY_SELECTION_BAR_ID}-hydration-hint`
  const descriptions = (...ids: (string | null)[]) =>
    ids.filter(Boolean).join(' ') || undefined
  const editDescription = descriptions(
    selectionIncomplete && hydrationMessage ? hydrationHintId : null,
    editHint ? `${GALLERY_SELECTION_BAR_ID}-hint` : null
  )
  const postDescription = descriptions(
    selectionIncomplete && hydrationMessage ? hydrationHintId : null,
    unpostedHint || postLimitHint ? `${GALLERY_SELECTION_BAR_ID}-hint` : null
  )
  const deleteDescription = descriptions(
    selectionIncomplete && hydrationMessage ? hydrationHintId : null,
    unpostedHint ? `${GALLERY_SELECTION_BAR_ID}-hint` : null
  )
  return (
    <div
      id={GALLERY_SELECTION_BAR_ID}
      role="region"
      aria-label="Selection"
      tabIndex={-1}
      className={cn(
        'bg-card focus-visible:ring-ring/50 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-3 py-2.5 shadow-lg outline-none focus-visible:ring-[3px] sm:px-4',
        sticky
          ? 'sticky bottom-3 z-20 max-sm:bottom-[calc(env(safe-area-inset-bottom,0px)+0.75rem)]'
          : 'relative'
      )}
    >
      <p
        role="status"
        aria-live="polite"
        className="min-w-0 flex-1 text-sm font-medium tabular-nums"
      >
        {count.toLocaleString('en-US')} selected
        {hydrationMessage ? (
          <span
            id={hydrationHintId}
            className="text-muted-foreground block text-xs font-normal"
          >
            {hydrationMessage}
          </span>
        ) : null}
        {editHint || unpostedHint || postLimitHint ? (
          <span
            id={`${GALLERY_SELECTION_BAR_ID}-hint`}
            className="text-muted-foreground block text-xs font-normal"
          >
            {[editHint, unpostedHint, postLimitHint].filter(Boolean).join(' ')}
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
        {selectionIncomplete && !hydrationPending && onRetryLoading ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn('pointer-coarse:h-10', DISABLED_CLASS)}
            onClick={onRetryLoading}
          >
            Retry loading
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={cn('pointer-coarse:h-10', DISABLED_CLASS)}
          onClick={() => {
            if (!selectionIncomplete && actionCount > 0 && canEdit)
              onEditDetails()
          }}
          aria-disabled={
            selectionIncomplete || actionCount === 0 || !canEdit || undefined
          }
          aria-describedby={editDescription}
        >
          <Pencil aria-hidden="true" />
          Edit details
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={cn('pointer-coarse:h-10', DISABLED_CLASS)}
          onClick={() => {
            if (count > 0) onAddToAlbum()
          }}
          aria-disabled={count === 0 || undefined}
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
              if (!selectionIncomplete && canPost) onPost()
            }}
            aria-disabled={selectionIncomplete || !canPost || undefined}
            aria-describedby={postDescription}
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
              if (!selectionIncomplete && canDelete) onDelete()
            }}
            aria-disabled={selectionIncomplete || !canDelete || undefined}
            aria-describedby={deleteDescription}
          >
            <Trash2 aria-hidden="true" />
            Delete
          </Button>
        ) : null}
      </div>
    </div>
  )
}
