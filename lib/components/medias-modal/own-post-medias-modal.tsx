'use client'

import { ComponentProps, FC, useMemo, useState } from 'react'

import { GalleryEditDetailsDialog } from '@/lib/components/gallery/GalleryEditDetailsDialog'
import { toPostEditItem } from '@/lib/components/gallery/galleryItemEdit'
import { MediasModal } from '@/lib/components/medias-modal/medias-modal'
import type { Attachment } from '@/lib/types/domain/attachment'

type Props = Omit<ComponentProps<typeof MediasModal>, 'onEdit' | 'canEdit'> & {
  /** Called after an Edit details save, for a page that can refresh its post. */
  onAltTextSaved?: () => void
}

/**
 * The photo viewer for posts in a timeline, a profile or a thread. When the
 * signed-in actor wrote the post (`albumsOwnerId`, see `getAlbumsOwnerId`), the
 * top bar offers Edit beside Details: the same Edit details dialog the Gallery
 * uses, for the photo on screen. Alt text is saved as an edit of the post, so
 * the viewer shows the new text straight away.
 *
 * Edit is offered only for photos whose actor is `albumsOwnerId` (a local
 * author), never for another account's photos or a remote post. The dialog sits
 * beside the viewer, not inside it, so its clicks are not the viewer's.
 */
export const OwnPostMediasModal: FC<Props> = ({
  medias,
  albumsOwnerId,
  onClosed,
  onAltTextSaved,
  ...rest
}) => {
  // Alt text as the owner's saves left it, by media id, with the alt text the
  // photo had when it was saved. Kept for as long as the component lives so a
  // viewer opened again shows it too, but only while the photo still has that
  // alt text: a later edit of the post (or a refreshed feed) brings its own.
  const [altTextById, setAltTextById] = useState<
    Record<string, { name: string; base: string }>
  >({})
  const [editingMediaId, setEditingMediaId] = useState<string | null>(null)

  const shown = useMemo(
    () =>
      medias && Object.keys(altTextById).length > 0
        ? medias.map((media) =>
            media.mediaId &&
            altTextById[media.mediaId] !== undefined &&
            (media.name ?? '') === altTextById[media.mediaId].base
              ? { ...media, name: altTextById[media.mediaId].name }
              : media
          )
        : medias,
    [medias, altTextById]
  )
  const editing = useMemo(() => {
    const media = shown?.find((entry) => entry.mediaId === editingMediaId)
    return media ? toPostEditItem(media) : null
  }, [shown, editingMediaId])

  const canEdit = (media: Attachment) =>
    Boolean(albumsOwnerId) && media.actorId === albumsOwnerId

  return (
    <>
      <MediasModal
        {...rest}
        medias={shown}
        albumsOwnerId={albumsOwnerId}
        onEdit={
          albumsOwnerId
            ? (index) => setEditingMediaId(shown?.[index]?.mediaId ?? null)
            : undefined
        }
        canEdit={canEdit}
        onClosed={() => {
          setEditingMediaId(null)
          onClosed()
        }}
      />
      {albumsOwnerId && editing ? (
        <GalleryEditDetailsDialog
          items={[editing]}
          initialMediaId={editing.mediaId}
          ownerId={albumsOwnerId}
          onClose={() => setEditingMediaId(null)}
          onSaved={(saved) => {
            onAltTextSaved?.()
            setAltTextById((current) => ({
              ...current,
              ...Object.fromEntries(
                saved.map((item) => [
                  item.mediaId,
                  {
                    name: item.attachment.name ?? '',
                    // What the post itself says now, whatever an earlier save
                    // of this viewer showed over it.
                    base:
                      medias?.find((media) => media.mediaId === item.mediaId)
                        ?.name ?? ''
                  }
                ])
              )
            }))
          }}
        />
      ) : null}
    </>
  )
}
