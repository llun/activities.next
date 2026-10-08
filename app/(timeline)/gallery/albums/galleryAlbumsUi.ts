import { pluralize } from '@/lib/components/gallery/galleryCategories'
import { formatCountryCount } from '@/lib/components/gallery/galleryTaxonomy'
import type {
  GalleryAlbumCardEntity,
  GalleryAlbumFacts
} from '@/lib/services/gallery/galleryAlbumEntities'
import type { GalleryAlbumSort } from '@/lib/types/database/galleryAlbums'

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec'
]

interface Day {
  year: number
  month: number
  day: number
}

// Dates are read in UTC from the ISO string, with a fixed month table, so the
// server render and the hydrating client agree whatever the locale or zone.
const toDay = (iso: string | null): Day | null => {
  if (!iso) return null
  const time = new Date(iso).getTime()
  if (Number.isNaN(time)) return null
  const date = new Date(time)
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth(),
    day: date.getUTCDate()
  }
}

/**
 * "12 – 19 Sep 2026" for one month, "28 Aug – 3 Sep 2026" across months,
 * "28 Dec 2025 – 3 Jan 2026" across years and "12 Sep 2026" for a single day.
 * Empty when the album has no dated photo.
 */
export const formatAlbumDateRange = (
  firstAt: string | null,
  lastAt: string | null
): string => {
  const start = toDay(firstAt) ?? toDay(lastAt)
  const end = toDay(lastAt) ?? start
  if (!start || !end) return ''
  const full = ({ day, month, year }: Day) => `${day} ${MONTHS[month]} ${year}`
  if (start.year === end.year && start.month === end.month) {
    return start.day === end.day
      ? full(start)
      : `${start.day} – ${end.day} ${MONTHS[end.month]} ${end.year}`
  }
  if (start.year === end.year) {
    return `${start.day} ${MONTHS[start.month]} – ${full(end)}`
  }
  return `${full(start)} – ${full(end)}`
}

/** "12 photos · 12 – 19 Sep 2026". */
export const getAlbumCardMeta = (album: GalleryAlbumCardEntity): string =>
  [
    pluralize(album.itemCount, 'photo'),
    formatAlbumDateRange(album.firstAt, album.lastAt)
  ]
    .filter(Boolean)
    .join(' · ')

/** The facts line: "12 photos · 4 species · 3 places · 1 country · 7 days". */
export const getAlbumFactsParts = (facts: GalleryAlbumFacts): string[] => {
  const parts = [pluralize(facts.photoCount, 'photo')]
  if (facts.speciesCount > 0) {
    parts.push(pluralize(facts.speciesCount, 'species', 'species'))
  }
  if (facts.placeCount > 0) {
    parts.push(
      facts.countryCount > 0
        ? `${pluralize(facts.placeCount, 'place')} · ${formatCountryCount(facts.countryCount)}`
        : pluralize(facts.placeCount, 'place')
    )
  }
  if (facts.dayCount > 0) parts.push(pluralize(facts.dayCount, 'day'))
  return parts
}

/** "1 place hidden" / "3 places hidden". */
export const getHiddenPlacesLabel = (count: number): string =>
  `${pluralize(count, 'place')} hidden (threatened species)`

export const ALBUM_SORT_LABELS: Record<GalleryAlbumSort, string> = {
  taken_desc: 'Taken: newest first',
  taken_asc: 'Taken: oldest first',
  added_desc: 'Recently added'
}

/** The public page of an album; the page itself arrives with the visitor view. */
export const getAlbumShareUrl = (actorUrl: string, albumId: string): string =>
  `${actorUrl}/albums/${encodeURIComponent(albumId)}`
