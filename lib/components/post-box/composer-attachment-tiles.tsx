import { Camera, Loader2, MapPin, RotateCw, X } from 'lucide-react'
import { FC, useId } from 'react'

import type { MediaDetailsEntity } from '@/lib/services/medias/types'
import { PostBoxAttachment } from '@/lib/types/domain/attachment'
import { cn } from '@/lib/utils'

interface Props {
  attachments: PostBoxAttachment[]
  /** Original file names by attachment id, for labels once the file is gone. */
  fileNames: Record<string, string>
  detailsById: Record<string, MediaDetailsEntity>
  decorativeIds: Record<string, true>
  /**
   * Stable React keys by attachment id. An upload swaps the temporary id for
   * the server's, so the key must outlive that swap or the tile remounts and
   * focus leaves its buttons. Falls back to the id.
   */
  clientKeys?: Record<string, string>
  uploadErrors: Record<string, string>
  /** Ids whose owner details are still being read after the upload. */
  detailsPending: Record<string, true>
  /** True while a submit is in flight: every tile control renders disabled. */
  disabled?: boolean
  onOpen: (id: string) => void
  onRemove: (id: string) => void
  onRetry: (id: string) => void
}

export const getAttachmentLabel = (
  attachment: PostBoxAttachment,
  fileNames: Record<string, string>,
  index: number
) =>
  attachment.file?.name ||
  fileNames[attachment.id] ||
  attachment.name ||
  `${index + 1}`

const TileStatus: FC<{
  attachment: PostBoxAttachment
  details?: MediaDetailsEntity
  decorative: boolean
  error?: string
  reading: boolean
  needsReview: boolean
}> = ({ attachment, details, decorative, error, reading, needsReview }) => {
  // The failure text lives outside the (disabled) tile button; see below.
  if (error) return null
  if (attachment.isLoading || reading) {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        {attachment.isLoading ? 'Uploading…' : 'Reading details…'}
      </span>
    )
  }
  if (needsReview) {
    return <span className="text-xs font-medium text-primary-text">Review</span>
  }
  const hasGear = Boolean(details?.camera || details?.lens || details?.exposure)
  const hasPlace = Boolean(details?.place)
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {attachment.name && !decorative ? (
        <span className="rounded bg-muted px-1 text-[10px] font-semibold">
          ALT
        </span>
      ) : null}
      {hasGear ? <Camera className="size-3" aria-label="Has gear" /> : null}
      {hasPlace ? <MapPin className="size-3" aria-label="Has place" /> : null}
      <span className="text-foreground">Edit</span>
    </span>
  )
}

export const ComposerAttachmentTiles: FC<Props> = ({
  attachments,
  fileNames,
  detailsById,
  decorativeIds,
  clientKeys = {},
  uploadErrors,
  detailsPending,
  disabled = false,
  onOpen,
  onRemove,
  onRetry
}) => {
  const errorId = useId()
  if (attachments.length === 0) return null

  const announcements = attachments.flatMap((item, index) => {
    const label = getAttachmentLabel(item, fileNames, index)
    if (uploadErrors[item.id]) return [`Upload of ${label} failed`]
    if (item.isLoading) return [`Uploading ${label}`]
    if (detailsPending[item.id]) return [`Reading details of ${label}`]
    return []
  })

  return (
    <div>
      <p role="status" aria-live="polite" className="sr-only">
        {announcements.join('. ')}
      </p>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {attachments.map((item, index) => {
          const label = getAttachmentLabel(item, fileNames, index)
          const error = uploadErrors[item.id]
          const decorative = Boolean(decorativeIds[item.id])
          const reading = Boolean(detailsPending[item.id])
          const busy = Boolean(item.isLoading) || reading
          const needsReview =
            !error &&
            !busy &&
            !decorative &&
            (item.name ?? '').trim().length === 0
          return (
            <li key={clientKeys[item.id] ?? item.id} className="relative">
              <button
                type="button"
                data-attachment-tile={item.id}
                disabled={disabled || busy || Boolean(error)}
                onClick={() => onOpen(item.id)}
                className={cn(
                  'block w-full space-y-1.5 rounded-lg border p-1.5 text-left outline-none transition-colors',
                  'focus-visible:ring-[3px] focus-visible:ring-ring/50 enabled:cursor-pointer enabled:hover:bg-accent/50',
                  needsReview && 'border-primary',
                  error && 'border-destructive/60'
                )}
              >
                <span
                  className="relative block aspect-square w-full overflow-hidden rounded-md bg-border bg-cover bg-center"
                  style={{
                    backgroundImage: `url("${item.posterUrl || item.url}")`
                  }}
                >
                  {busy ? (
                    <span className="absolute inset-0 flex items-center justify-center bg-background/50">
                      <Loader2 className="animate-spin text-primary" />
                    </span>
                  ) : null}
                </span>
                <TileStatus
                  attachment={item}
                  details={detailsById[item.id]}
                  decorative={decorative}
                  error={error}
                  reading={reading}
                  needsReview={needsReview}
                />
                {/* The accessible name is the visible status text followed by
                    this (WCAG 2.5.3 Label in Name), e.g. "Edit details of a.png". */}
                {error ? null : ' '}
                <span className="sr-only">
                  {error ? label : `details of ${label}`}
                </span>
              </button>
              {error ? (
                <div className="flex items-center justify-between gap-2 px-1.5 pt-1.5">
                  <span
                    id={`${errorId}-${item.id}`}
                    className="text-xs text-destructive"
                    title={error}
                  >
                    Upload failed
                    <span className="sr-only">: {error}</span>
                  </span>
                  <button
                    type="button"
                    aria-label={`Retry upload of ${label}`}
                    aria-describedby={`${errorId}-${item.id}`}
                    disabled={disabled}
                    onClick={() => onRetry(item.id)}
                    className="flex items-center gap-1 rounded-md border bg-background px-1.5 py-0.5 text-xs font-medium shadow-xs"
                  >
                    <RotateCw className="size-3" />
                    Retry
                  </button>
                </div>
              ) : null}
              <button
                type="button"
                aria-label={`Remove media ${label}`}
                disabled={disabled}
                onClick={() => onRemove(item.id)}
                className="absolute top-0 right-0 flex size-6 translate-x-1/3 -translate-y-1/3 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-xs hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </li>
          )
        })}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">
        Select an item to review its details.
      </p>
    </div>
  )
}
