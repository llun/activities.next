'use client'

import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { getGallerySettings, getMedia } from '@/lib/client'
import {
  applySavedToItem,
  toMediaDetailsDialogItem
} from '@/lib/components/gallery/galleryItemEdit'
import {
  MediaDetailsDialog,
  type MediaDetailsSavedItem
} from '@/lib/components/media-details/media-details-dialog'
import type {
  GalleryItemEntity,
  GallerySettingsEntity
} from '@/lib/services/gallery/galleryEntities'
import type {
  MediaDetailsEntity,
  MediaStorageSaveFileOutput
} from '@/lib/services/medias/types'

interface Props {
  /** The posted photos to edit, in the order the dialog steps through them. */
  items: GalleryItemEntity[]
  /** The photo the dialog opens on. */
  initialMediaId: string
  /** The signed-in owner's actor id. */
  ownerId: string
  onClose: () => void
  /** The tiles as they are after a save, for the items that changed. */
  onSaved: (items: GalleryItemEntity[]) => void
}

// How many owner details are read at once when several photos are edited.
const DETAILS_CONCURRENCY = 4

/**
 * Edit details for posted gallery photos: the media details dialog the composer
 * uses, loaded with the owner's own details for each photo. The photo it opens
 * on is read first; a photo's details that have not arrived yet do not block
 * the dialog (they fill in when they do, and a field nobody touched is never
 * sent back). A posted photo's alt text is saved as an edit of its post.
 */
export const GalleryEditDetailsDialog: FC<Props> = ({
  items,
  initialMediaId,
  ownerId,
  onClose,
  onSaved
}) => {
  const [settings, setSettings] = useState<GallerySettingsEntity | null>(null)
  const [details, setDetails] = useState<Record<string, MediaDetailsEntity>>({})
  // The tiles as the dialog last saw them, so a save maps onto them.
  const itemsRef = useRef(items)
  // The tile each save produced. The next save is applied on top of it: a retry
  // after a partial failure sends only what is still unsaved, and its answer
  // must not put the tile back to how it was when the dialog opened.
  const producedRef = useRef(new Map<string, GalleryItemEntity>())
  useEffect(() => {
    itemsRef.current = items
  }, [items])

  useEffect(() => {
    let active = true
    getGallerySettings().then(
      (result) => {
        if (active) setSettings(result)
      },
      () => {
        // The dialog works without them (defaults apply).
      }
    )
    return () => {
      active = false
    }
  }, [])

  // Read the opening photo first, then the rest, a few at a time.
  const ids = useMemo(() => {
    const all = items.map((item) => item.mediaId)
    return [initialMediaId, ...all.filter((id) => id !== initialMediaId)]
    // The set of photos is fixed for the life of the dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    let active = true
    let next = 0
    const worker = async () => {
      while (active && next < ids.length) {
        const id = ids[next++]
        try {
          const media = await getMedia(id)
          if (active && media.details) {
            const loaded = media.details
            setDetails((current) =>
              current[id] ? current : { ...current, [id]: loaded }
            )
          }
        } catch {
          // This photo's details stay unloaded; the dialog still opens and
          // only sends what the owner changes.
        }
      }
    }
    for (let i = 0; i < Math.min(DETAILS_CONCURRENCY, ids.length); i += 1) {
      void worker()
    }
    return () => {
      active = false
    }
  }, [ids])

  const dialogItems = useMemo(
    () =>
      items.map((item) =>
        toMediaDetailsDialogItem(item, details[item.mediaId] ?? null, ownerId)
      ),
    [items, details, ownerId]
  )

  const handleSaved = useCallback(
    (saved: MediaDetailsSavedItem[]) => {
      setDetails((current) => {
        const next = { ...current }
        for (const entry of saved) {
          if (entry.details) next[entry.id] = entry.details
        }
        return next
      })
      const byId = new Map(saved.map((entry) => [entry.id, entry]))
      onSaved(
        itemsRef.current.flatMap((item) => {
          const entry = byId.get(item.mediaId)
          if (!entry) return []
          const next = applySavedToItem(
            producedRef.current.get(item.mediaId) ?? item,
            entry
          )
          producedRef.current.set(item.mediaId, next)
          return [next]
        })
      )
    },
    [onSaved]
  )

  // The photo editor saved or reverted a photo: the tile shows the new file
  // (url, size, BlurHash) and the details that came with it.
  const handleMediaEdited = useCallback(
    (id: string, media: MediaStorageSaveFileOutput) => {
      if (media.details) {
        const edited = media.details
        setDetails((current) => ({ ...current, [id]: edited }))
      }
      const item = itemsRef.current.find((entry) => entry.mediaId === id)
      if (!item) return
      const base = producedRef.current.get(id) ?? item
      const next: GalleryItemEntity = {
        ...base,
        attachment: {
          ...base.attachment,
          url: media.url,
          width: media.meta.original.width ?? base.attachment.width,
          height: media.meta.original.height ?? base.attachment.height,
          blurhash: media.blurhash ?? base.attachment.blurhash,
          thumbnailUrl: media.preview_url ?? media.url
        }
      }
      producedRef.current.set(id, next)
      onSaved([next])
    },
    [onSaved]
  )

  const handleDetailsRefreshed = useCallback(
    (
      id: string,
      patch: Partial<MediaDetailsEntity>,
      value: MediaDetailsEntity
    ) =>
      // The patch is what the dialog's read is authoritative for; the whole
      // entity only stands in for details this dialog holds none of yet.
      setDetails((current) => ({
        ...current,
        [id]: current[id] ? { ...current[id], ...patch } : value
      })),
    []
  )

  return (
    <MediaDetailsDialog
      context="gallery"
      items={dialogItems}
      initialId={initialMediaId}
      settings={settings}
      ownerId={ownerId}
      onClose={onClose}
      onSaved={handleSaved}
      onMediaEdited={handleMediaEdited}
      onDetailsRefreshed={handleDetailsRefreshed}
    />
  )
}
