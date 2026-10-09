import { getBaseURL } from '@/lib/config'

// Where an album lives for visitors: `/@user@domain/albums/<id>`, nested under
// the actor route. `[actor]` is a dynamic segment, so a static `albums` child
// cannot clash with `[actor]/[status]` (a status path is a single segment, an
// album path has two), and the proxy's ActivityPub rewrites only match
// `/@user` and `/@user/<id>`.

/** The path of an album's public page. */
export const getGalleryAlbumPublicPath = ({
  username,
  domain,
  albumId
}: {
  username: string
  domain: string
  albumId: string
}): string => `/@${username}@${domain}/albums/${encodeURIComponent(albumId)}`

/**
 * The absolute address of an album's public page, on the actor's own domain
 * (the one its handle names), falling back to the instance's base URL.
 */
export const getGalleryAlbumPublicUrl = ({
  actor,
  albumId
}: {
  actor: { id: string; username: string; domain: string }
  albumId: string
}): string => {
  let origin: string
  try {
    origin = new URL(actor.id).origin
  } catch {
    origin = getBaseURL()
  }
  return `${origin}${getGalleryAlbumPublicPath({
    username: actor.username,
    domain: actor.domain,
    albumId
  })}`
}
