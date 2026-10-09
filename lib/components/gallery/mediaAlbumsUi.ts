import type { MediaAlbumOptionEntity } from '@/lib/services/gallery/galleryAlbumEntities'

// Pure helpers for the add-to-album menu (the details dialog row, the lightbox
// pill and Recent's multi-select picker): copy and accessible names, so the
// components stay about layout and behaviour.

const pluralPhotos = (count: number) =>
  `${count.toLocaleString('en-US')} ${count === 1 ? 'photo' : 'photos'}`

/**
 * The accessible name of each album's checkbox, in `albums` order. The title
 * alone is not unique (two albums may share one), so a screen reader gets the
 * visibility and the photo count after it, and a number when even that is the
 * same: "Kruger, public album, 14 photos", "Kruger, public album, 14 photos,
 * number 2".
 */
export const getAlbumOptionNames = (
  albums: readonly MediaAlbumOptionEntity[]
): string[] => {
  const described = albums.map(
    (album) =>
      `${album.title}, ${album.visibility} album, ${pluralPhotos(album.itemCount)}`
  )
  const seen = new Map<string, number>()
  const totals = new Map<string, number>()
  for (const name of described) totals.set(name, (totals.get(name) ?? 0) + 1)
  return described.map((name) => {
    if ((totals.get(name) ?? 0) < 2) return name
    const number = (seen.get(name) ?? 0) + 1
    seen.set(name, number)
    return `${name}, number ${number}`
  })
}

/** The lightbox pill's label: "In 2 albums", or the call to action when in none. */
export const getAlbumsPillLabel = (count: number): string =>
  count === 0
    ? 'Add to album'
    : `In ${count} ${count === 1 ? 'album' : 'albums'}`

export const NOT_ADDABLE_HINT =
  'This photo can’t be added to an album until it’s posted and shown in your gallery.'

export const albumAddedMessage = (title: string) => `Added to “${title}”`
export const albumRemovedMessage = (title: string) => `Removed from “${title}”`

/**
 * The id to give the lightbox for the albums pill: the signed-in viewer's own
 * actor id when they wrote the post being viewed, else null (no pill). For a
 * boost, pass the original status, since it is the author's photos that are
 * shown.
 */
export const getAlbumsOwnerId = (
  currentActor: { id: string } | null | undefined,
  status: { actorId: string }
): string | null =>
  currentActor && currentActor.id === status.actorId ? currentActor.id : null
