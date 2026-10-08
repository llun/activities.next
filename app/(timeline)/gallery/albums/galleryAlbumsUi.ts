import { pluralize } from '@/lib/components/gallery/galleryCategories'
import { formatCountryCount } from '@/lib/components/gallery/galleryTaxonomy'
import type {
  GalleryAlbumCardEntity,
  GalleryAlbumFacts
} from '@/lib/services/gallery/galleryAlbumEntities'
import type { GalleryItemEntity } from '@/lib/services/gallery/galleryEntities'
import type { GalleryAlbumSort } from '@/lib/types/database/galleryAlbums'
import { cn } from '@/lib/utils'

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

/**
 * Widens a small control's touch target to 40px without changing how big it
 * looks: an invisible band above and below a 32px bordered chip. An absolute
 * pseudo-element is placed from the padding edge, 1px inside the border, so 5px
 * (not 4px) makes up the 4px each side.
 */
export const TOUCH_BAND_CLASS =
  "relative before:absolute before:inset-x-0 before:-inset-y-1.25 before:content-['']"

/** The same for a 28px round or pill button that sits over a photo (6px each side). */
export const TOUCH_BUTTON_CLASS =
  "before:absolute before:-inset-1.5 before:content-['']"

/** A filter chip: a pill with a count, active when it is the current filter. */
export const getAlbumChipClassName = (isActive: boolean): string =>
  cn(
    'focus-visible:ring-ring/50 inline-flex h-8 min-w-0 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-sm font-medium outline-none focus-visible:ring-[3px]',
    TOUCH_BAND_CLASS,
    isActive
      ? 'border-primary bg-primary/10 text-primary-text'
      : 'bg-background text-muted-foreground hover:bg-muted hover:text-foreground'
  )

/**
 * The accessible name of one photo in a grid: its name, then its place in the
 * list, so photos of the same species or with the same alt text still read
 * differently ("Common kingfisher, photo 3").
 */
export const getAlbumTileLabel = (
  item: Pick<GalleryItemEntity, 'attachment' | 'subject'>,
  index: number
): string => {
  const name = item.attachment.name?.trim() || item.subject?.name
  return name ? `${name}, photo ${index + 1}` : `Photo ${index + 1}`
}
