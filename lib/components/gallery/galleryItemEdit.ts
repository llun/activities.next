import type {
  MediaDetailsDialogItem,
  MediaDetailsSavedItem
} from '@/lib/components/media-details/media-details-dialog'
import type { GalleryItemEntity } from '@/lib/services/gallery/galleryEntities'
import type { MediaDetailsEntity } from '@/lib/services/medias/types'
import type { Attachment } from '@/lib/types/domain/attachment'
import { getActorMentionPathSegment } from '@/lib/utils/getActorMentionPathSegment'
import { isPublicId } from '@/lib/utils/publicId'
import { idToUrl, urlToId } from '@/lib/utils/urlToId'

/**
 * The page of the post a gallery photo is shown through, for the owner's
 * "Open post" link. Built from the owner's actor id (`https://host/users/name`)
 * and the item's client status id, the same two shapes the status page resolves.
 * Null when the actor id is not a local one.
 */
export const getGalleryPostHref = (
  ownerActorId: string,
  statusId: string
): string | null => {
  let username: string
  let domain: string
  try {
    const url = new URL(ownerActorId)
    const match = url.pathname.match(/^\/users\/([^/]+)\/?$/)
    if (!match) return null
    username = decodeURIComponent(match[1])
    domain = url.host
  } catch {
    return null
  }
  const segment = isPublicId(statusId)
    ? statusId
    : encodeURIComponent(idToUrl(statusId))
  if (!segment) return null
  return `/${getActorMentionPathSegment({ username, domain })}/${segment}`
}

/**
 * The dialog's view of a gallery photo. A photo added in Gallery and not posted
 * yet has no post to link to or to carry its alt text.
 */
export const toMediaDetailsDialogItem = (
  item: GalleryItemEntity,
  details: MediaDetailsEntity | null,
  ownerActorId: string
): MediaDetailsDialogItem => ({
  id: item.mediaId,
  mediaType: item.attachment.mediaType,
  url: item.attachment.url,
  posterUrl: item.attachment.thumbnailUrl ?? undefined,
  width: item.attachment.width ?? 0,
  height: item.attachment.height ?? 0,
  description: item.attachment.name ?? '',
  decorative: false,
  details,
  unposted: item.posted === false || undefined,
  post:
    item.statusId === null
      ? undefined
      : {
          statusId: item.statusId,
          href: getGalleryPostHref(ownerActorId, item.statusId)
        }
})

/**
 * The grid tile after the dialog saved it: the alt text always, and every
 * detail the tile carries when the save answered with fresh ones.
 */
export const applySavedToItem = (
  item: GalleryItemEntity,
  saved: MediaDetailsSavedItem
): GalleryItemEntity => {
  const next: GalleryItemEntity = {
    ...item,
    attachment: { ...item.attachment, name: saved.description }
  }
  const { details } = saved
  if (!details) return next
  return {
    ...next,
    subject: details.subject
      ? {
          name: details.subject.name,
          scientificName: details.subject.scientificName,
          category: details.subject.category,
          taxonKey: details.subject.taxonKey,
          taxonPath: details.subject.taxonPath
        }
      : null,
    takenAt: details.takenAt,
    camera: details.camera
      ? { id: details.camera.id, name: details.camera.name }
      : null,
    lens: details.lens
      ? { id: details.lens.id, name: details.lens.name }
      : null,
    exposure: details.exposure,
    inGallery: details.inGallery,
    place: details.place
      ? {
          name: details.place.name,
          precision: details.place.precision,
          latitude: details.place.latitude,
          longitude: details.place.longitude,
          countryCode: details.place.countryCode
        }
      : null
  }
}

/**
 * A photo of one of the owner's own posts, as the editor takes it. A post's
 * attachment has the post's url as its status id, which the editor wants in the
 * client form (the same one gallery items carry). The details a gallery tile
 * shows are not known here; the editor reads them itself. Null for a file
 * without a media id.
 */
export const toPostEditItem = (
  attachment: Attachment
): GalleryItemEntity | null =>
  attachment.mediaId
    ? {
        mediaId: attachment.mediaId,
        statusId: urlToId(attachment.statusId),
        attachment,
        subject: null,
        takenAt: null,
        camera: null,
        lens: null,
        exposure: null,
        place: null
      }
    : null
