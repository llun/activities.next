import { pluralize } from '@/lib/components/gallery/galleryCategories'
import type { GalleryAlbumItemsResult } from '@/lib/services/gallery/galleryAlbumEntities'
import { MAX_GALLERY_ALBUM_ITEMS } from '@/lib/types/database/galleryAlbums'

// Wording for adding a selection from Recent to an album: what the server
// answered, and what to tell the owner when it stopped part way.

type Outcome = Pick<GalleryAlbumItemsResult, 'added' | 'existing' | 'skipped'>

const quoted = (title: string) => `“${title}”`

/** What a finished add did, one sentence per kind of result. */
export const describeAddResult = (title: string, outcome: Outcome): string => {
  const { added, existing, skipped } = outcome
  const parts: string[] = []
  if (added.length > 0) {
    parts.push(`Added ${pluralize(added.length, 'photo')} to ${quoted(title)}.`)
  } else if (existing.length > 0 && skipped.length === 0) {
    parts.push(
      `${existing.length === 1 ? 'That photo was' : `All ${existing.length} photos were`} already in ${quoted(title)}.`
    )
  } else {
    parts.push(`Nothing was added to ${quoted(title)}.`)
  }
  if (added.length > 0 && existing.length > 0) {
    parts.push(
      `${pluralize(existing.length, 'photo')} ${existing.length === 1 ? 'was' : 'were'} already there.`
    )
  }
  if (skipped.length > 0) {
    parts.push(
      `${pluralize(skipped.length, 'photo')} couldn’t be added: ${skipped.length === 1 ? 'it isn’t' : 'they aren’t'} in your gallery any more.`
    )
  }
  return parts.join(' ')
}

/**
 * What to say when an add stopped part way. `earlier` is what the batches
 * before the failing one added (they stay in the album); `requested` is how
 * many photos were asked for.
 */
export const describeAddFailure = ({
  title,
  message,
  isFull,
  earlier,
  requested
}: {
  title: string
  message: string
  isFull: boolean
  earlier: Outcome | null
  requested: number
}): string => {
  const kept = earlier ? earlier.added.length : 0
  const already = earlier ? earlier.existing.length : 0
  const rest = Math.max(
    requested - kept - already - (earlier?.skipped.length ?? 0),
    0
  )
  const head = isFull
    ? `${quoted(title)} is full: an album holds at most ${MAX_GALLERY_ALBUM_ITEMS.toLocaleString('en-US')} photos.`
    : `Couldn’t finish adding to ${quoted(title)}. ${message}`
  if (kept === 0) {
    return `${head} ${isFull ? 'No photos were added.' : 'Nothing was added.'}`
  }
  return `${head} Added ${kept.toLocaleString('en-US')} of ${requested.toLocaleString('en-US')}; the other ${rest.toLocaleString('en-US')} were not added.`
}
