import { Camera, Loader2, MapPin, RotateCw, X } from 'lucide-react'
import { FC, useEffect, useId, useRef } from 'react'

import { getSubjectChoices } from '@/lib/components/media-details/subjectChoices'
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
  /** Ids whose subject suggestions are being asked for; the tile stays usable. */
  suggestionsPending?: Record<string, true>
  /** The author's confidence floor, in percent, for which name is suggested. */
  confidenceThreshold?: number
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

/**
 * The subject line of a tile: the confirmed name once the author saved one,
 * else the model's best guess ("Suggested: Warbling White-eye", or the kind of
 * subject when no species is confident enough). Null when there is neither.
 */
const getSubjectLine = (
  details: MediaDetailsEntity | undefined,
  threshold: number
): { confirmed: boolean; text: string } | null => {
  const name = details?.subject?.name?.trim()
  if (name) return { confirmed: true, text: name }
  const choices = getSubjectChoices(
    details?.subjectSuggestions ?? null,
    threshold
  )
  if (choices.species[0]) {
    return { confirmed: false, text: choices.species[0].name }
  }
  if (choices.group) {
    return { confirmed: false, text: `${choices.group.label}?` }
  }
  return null
}

const TileSubject: FC<{
  line: { confirmed: boolean; text: string } | null
}> = ({ line }) => {
  if (!line) return null
  return line.confirmed ? (
    <span className="block text-[13px] leading-[17px] font-semibold">
      {line.text}
    </span>
  ) : (
    <span className="block text-[13px] leading-[17px]">
      <span className="text-muted-foreground">Suggested:</span>{' '}
      <strong>{line.text}</strong>
    </span>
  )
}

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
      {needsReview ? (
        <span className="ml-auto font-medium text-primary-text">Review</span>
      ) : (
        <span className="ml-auto text-foreground">Edit</span>
      )}
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
  suggestionsPending = {},
  confidenceThreshold = 70,
  disabled = false,
  onOpen,
  onRemove,
  onRetry
}) => {
  const errorId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  // Where focus goes once a removed tile has left the DOM.
  const focusAfterRemoveRef = useRef<string | 'add' | null>(null)

  useEffect(() => {
    const target = focusAfterRemoveRef.current
    if (!target) return
    focusAfterRemoveRef.current = null
    if (target === 'add') {
      document
        .querySelector<HTMLElement>('button[aria-label^="Add media"]')
        ?.focus()
      return
    }
    const root = rootRef.current
    if (!root) return
    const tile = Array.from(
      root.querySelectorAll<HTMLButtonElement>('button[data-attachment-tile]')
    ).find((node) => node.dataset.attachmentTile === target)
    if (tile && !tile.disabled) {
      tile.focus()
      return
    }
    // A busy or failed tile has a disabled main button; use its Remove button.
    Array.from(
      root.querySelectorAll<HTMLButtonElement>('button[data-attachment-remove]')
    )
      .find((node) => node.dataset.attachmentRemove === target)
      ?.focus()
  }, [attachments])

  if (attachments.length === 0) return null

  const handleRemove = (id: string, index: number) => {
    const neighbour = attachments[index + 1] ?? attachments[index - 1]
    focusAfterRemoveRef.current = neighbour ? neighbour.id : 'add'
    onRemove(id)
  }

  const handleRetry = (id: string) => {
    // The Retry button disappears and the tile button is disabled while the
    // upload runs, so park focus on the tile's Remove button.
    Array.from(
      rootRef.current?.querySelectorAll<HTMLButtonElement>(
        'button[data-attachment-remove]'
      ) ?? []
    )
      .find((node) => node.dataset.attachmentRemove === id)
      ?.focus()
    onRetry(id)
  }

  const announcements = attachments.flatMap((item, index) => {
    const label = getAttachmentLabel(item, fileNames, index)
    if (uploadErrors[item.id]) return [`Upload of ${label} failed`]
    if (item.isLoading) return [`Uploading ${label}`]
    if (detailsPending[item.id] || suggestionsPending[item.id]) {
      return [`Reading details of ${label}`]
    }
    return []
  })

  return (
    <div ref={rootRef}>
      <p role="status" aria-live="polite" className="sr-only">
        {announcements.join('. ')}
      </p>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {attachments.map((item, index) => {
          const label = getAttachmentLabel(item, fileNames, index)
          const error = uploadErrors[item.id]
          const decorative = Boolean(decorativeIds[item.id])
          const readingDetails = Boolean(detailsPending[item.id])
          // Suggestions arrive after the details; the tile can be opened
          // meanwhile, so only the details read disables it.
          const suggesting = Boolean(suggestionsPending[item.id])
          const busy = Boolean(item.isLoading) || readingDetails
          const details = detailsById[item.id]
          const subjectLine = getSubjectLine(details, confidenceThreshold)
          const needsReview =
            !error &&
            !busy &&
            ((!decorative && (item.name ?? '').trim().length === 0) ||
              // A suggestion waits for the author's say.
              (subjectLine !== null && !subjectLine.confirmed))
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
                {error || busy ? null : <TileSubject line={subjectLine} />}
                <TileStatus
                  attachment={item}
                  details={details}
                  decorative={decorative}
                  error={error}
                  reading={readingDetails || (suggesting && !subjectLine)}
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
                    onClick={() => handleRetry(item.id)}
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
                data-attachment-remove={item.id}
                disabled={disabled}
                onClick={() => handleRemove(item.id, index)}
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
