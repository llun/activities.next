'use client'

import { formatDistance } from 'date-fns/formatDistance'
import { Check, Copy, Film, Pencil, Quote, Reply, Trash2 } from 'lucide-react'
import { FC, useEffect, useState } from 'react'

import {
  DraftConflictError,
  type DraftRecord,
  announceDraftsChanged,
  deleteDraftAndOwnedMedia,
  getDraftBlob
} from '@/lib/client/drafts'
import { ConfirmDialog } from '@/lib/components/photo-editor/ConfirmDialog'
import { Button } from '@/lib/components/ui/button'
import { useCopyToClipboard } from '@/lib/hooks/useCopyToClipboard'
import { getMention, getMentionFromActorID } from '@/lib/types/domain/actor'
import type { Status } from '@/lib/types/domain/status'
import type { MastodonVisibility } from '@/lib/utils/getVisibility'

const MAX_THUMBNAILS = 4

const VISIBILITY_LABELS: Record<MastodonVisibility, string> = {
  public: 'Public',
  unlisted: 'Unlisted',
  private: 'Followers only',
  direct: 'Direct'
}

interface Thumbnail {
  id: string
  src?: string
  label: string
}

/**
 * Object URLs from the stored bytes (which stay until the draft is deleted),
 * else the server URL once uploaded. Revoked when the row unmounts.
 */
const useThumbnails = (draft: DraftRecord): Thumbnail[] => {
  const [thumbnails, setThumbnails] = useState<Thumbnail[]>([])

  useEffect(() => {
    let cancelled = false
    const objectUrls: string[] = []
    const revokeAll = () =>
      objectUrls.forEach((url) => URL.revokeObjectURL(url))

    const read = async () => {
      const next: Thumbnail[] = []
      for (const attachment of draft.attachments.slice(0, MAX_THUMBNAILS)) {
        let src: string | undefined
        if (attachment.hasBlob) {
          const blob = await getDraftBlob(attachment.localId).catch(
            () => undefined
          )
          const source =
            blob?.poster ??
            (blob?.mimeType.startsWith('image/') ? blob : undefined)
          if (source) {
            src = URL.createObjectURL(
              new Blob([source.bytes], { type: source.mimeType })
            )
            objectUrls.push(src)
          }
        }
        src ??=
          attachment.posterUrl ??
          (attachment.mediaType.startsWith('image/')
            ? attachment.url
            : undefined)
        next.push({
          id: attachment.localId,
          src,
          label: attachment.description || attachment.fileName
        })
      }
      if (cancelled) revokeAll()
      else setThumbnails(next)
    }
    void read()

    return () => {
      cancelled = true
      revokeAll()
    }
  }, [draft])

  return thumbnails
}

const mentionOf = (status: Status) =>
  status.actor
    ? getMention(status.actor, true)
    : getMentionFromActorID(status.actorId, true)

const plural = (count: number, one: string) =>
  `${count} ${one}${count === 1 ? '' : 's'}`

const describeContent = (draft: DraftRecord): string[] => {
  const photos = draft.attachments.filter((a) =>
    a.mediaType.startsWith('image/')
  ).length
  const videos = draft.attachments.filter((a) =>
    a.mediaType.startsWith('video/')
  ).length
  const other = draft.attachments.length - photos - videos
  return [
    photos > 0 ? plural(photos, 'photo') : null,
    videos > 0 ? plural(videos, 'video') : null,
    other > 0 ? plural(other, 'file') : null,
    draft.fitnessFile ? 'FIT file' : null,
    draft.poll ? 'Poll' : null
  ].filter((part): part is string => part !== null)
}

interface Props {
  draft: DraftRecord
  currentTime: number
  onEdit: () => void
  /** The draft changed in another tab: read it again before a retry. */
  onConflict: () => void
  /**
   * A failed delete, for the list to show above its box (`retry` when the
   * delete can simply be repeated), or null once a delete went through.
   */
  onDeleteError: (message: string | null, retry?: () => void) => void
}

export const DraftRow: FC<Props> = ({
  draft,
  currentTime,
  onEdit,
  onConflict,
  onDeleteError
}) => {
  const thumbnails = useThumbnails(draft)
  const { copied, copy } = useCopyToClipboard()
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const contextStatus = draft.replyTo ?? draft.quoteOf
  const ContextIcon = draft.replyTo ? Reply : Quote
  const meta = [
    VISIBILITY_LABELS[draft.visibility],
    ...describeContent(draft),
    `Saved ${formatDistance(draft.updatedAt, currentTime)} ago`
  ].join(' · ')

  const onDelete = async () => {
    setConfirmingDelete(false)
    try {
      await deleteDraftAndOwnedMedia(draft)
      onDeleteError(null)
      // Nothing else announces a delete from this page: the sidebar count and
      // other tabs listen for this.
      announceDraftsChanged(draft.accountId, draft.actorId, draft.id)
    } catch (error) {
      if (error instanceof DraftConflictError) {
        // Another tab saved this draft since it was read: nothing was deleted.
        // The list re-reads it, so Delete retries against the newest save.
        onDeleteError(
          'This draft changed in another tab. Review it, then delete again.'
        )
        onConflict()
      } else {
        onDeleteError('Something went wrong on this device. Try again.', () => {
          void onDelete()
        })
      }
    }
  }

  return (
    <div data-slot="draft-row" className="space-y-2">
      {contextStatus ? (
        <p className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
          <ContextIcon aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate">
            {draft.replyTo ? 'Replying to' : 'Quoting'}{' '}
            {mentionOf(contextStatus)}
          </span>
        </p>
      ) : null}

      {draft.text ? (
        <p className="line-clamp-3 text-sm break-words whitespace-pre-wrap">
          {draft.text}
        </p>
      ) : (
        <p className="text-muted-foreground text-sm italic">No text</p>
      )}

      {thumbnails.length > 0 ? (
        <ul className="flex gap-2" aria-label="Attachments">
          {thumbnails.map(({ id, src, label }) => (
            <li
              key={id}
              className="bg-muted flex size-14 items-center justify-center overflow-hidden rounded-md border"
            >
              {src ? (
                <img src={src} alt={label} className="size-full object-cover" />
              ) : (
                <Film
                  aria-label={label}
                  role="img"
                  className="text-muted-foreground size-5"
                />
              )}
            </li>
          ))}
        </ul>
      ) : null}

      <p className="text-muted-foreground text-xs">{meta}</p>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button type="button" variant="outline" size="sm" onClick={onEdit}>
          <Pencil aria-hidden />
          Edit
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void copy(draft.text)}
        >
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setConfirmingDelete(true)}
        >
          <Trash2 aria-hidden />
          Delete
        </Button>
      </div>

      <ConfirmDialog
        open={confirmingDelete}
        title="Delete this draft?"
        description="It is removed from this device, along with any photos only it uploaded."
        cancelLabel="Keep draft"
        confirmLabel="Delete"
        destructive
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={() => void onDelete()}
      />
    </div>
  )
}
