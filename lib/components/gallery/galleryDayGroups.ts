import { type SportKey } from '@/lib/services/fitness-files/sportTypes'
import type {
  GalleryDayKey,
  GalleryItemEntity
} from '@/lib/services/gallery/galleryEntities'
import {
  parseGalleryDayKey,
  toGalleryDayKey,
  toUtcDay
} from '@/lib/services/gallery/galleryEntities'
import type { GalleryMediaSort } from '@/lib/types/database/gallery'

import { pluralize } from './galleryCategories'

export interface GalleryDayGroup {
  key: GalleryDayKey
  items: GalleryItemEntity[]
}

/** The key of the day a photo with no parsable date is grouped under. */
export const UNDATED_DAY_KEY = 'undated'

/**
 * The key of one item: see `GalleryDayKey`. A dated photo under a date sort
 * groups by its UTC camera day; a dateless photo under a date sort and every
 * photo under `sort=uploaded` group by its UTC upload day. Null when neither
 * `takenAt` nor `uploadedAt` parses.
 */
export const getGalleryDayKey = (
  item: GalleryItemEntity,
  sort: GalleryMediaSort
): GalleryDayKey | null => {
  if (
    sort !== 'uploaded' &&
    item.takenAt !== null &&
    item.takenAt !== undefined
  ) {
    const day = toUtcDay(item.takenAt)
    if (day) return toGalleryDayKey(day, false)
  }
  const uploadedDay = toUtcDay(item.uploadedAt ?? null)
  return uploadedDay ? toGalleryDayKey(uploadedDay, true) : null
}

/**
 * Groups in first-seen order; an item whose key was seen before joins that
 * group (same calendar day only). Null keys land in one trailing group under
 * `UNDATED_DAY_KEY`.
 */
export const groupGalleryItemsByDay = (
  items: GalleryItemEntity[],
  sort: GalleryMediaSort
): GalleryDayGroup[] => {
  const groups: GalleryDayGroup[] = []
  const groupsByKey = new Map<GalleryDayKey, GalleryDayGroup>()
  let undated: GalleryDayGroup | null = null
  for (const item of items) {
    const key = getGalleryDayKey(item, sort)
    if (key === null) {
      undated ??= { key: UNDATED_DAY_KEY, items: [] }
      undated.items.push(item)
      continue
    }
    let group = groupsByKey.get(key)
    if (!group) {
      group = { key, items: [] }
      groupsByKey.set(key, group)
      groups.push(group)
    }
    group.items.push(item)
  }
  return undated ? [...groups, undated] : groups
}

const DAY_HEADING_FORMATTER = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC'
})

const SHORT_DAY_HEADING_FORMATTER = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC'
})

const formatHeadingParts = (day: string, short: boolean): string => {
  const date = new Date(`${day}T00:00:00.000Z`)
  const parts = (
    short ? SHORT_DAY_HEADING_FORMATTER : DAY_HEADING_FORMATTER
  ).formatToParts(date)
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''
  return short
    ? `${get('weekday')} ${get('day')} ${get('month')}`
    : `${get('weekday')} ${get('day')} ${get('month')} ${get('year')}`
}

/**
 * "Sun 12 Oct 2025" / short "Sun 12 Oct"; "Uploaded Fri 3 Oct 2025" / short
 * "Uploaded Fri 3 Oct"; "No date" for `UNDATED_DAY_KEY`. UTC, en-US, Intl
 * weekday short — never the viewer's zone.
 */
export const formatDayHeading = (
  key: GalleryDayKey,
  options?: { short?: boolean }
): string => {
  if (key === UNDATED_DAY_KEY) return 'No date'
  const parsed = parseGalleryDayKey(key)
  if (!parsed) return key
  const heading = formatHeadingParts(parsed.day, options?.short ?? false)
  return parsed.uploaded ? `Uploaded ${heading}` : heading
}

export interface DayMetaInput {
  placeName: string | null
  count: number
  picked: number
  inAlbum: number
  selecting: boolean
  short?: boolean
}

const formatCount = (count: number, short: boolean): string =>
  short ? count.toLocaleString('en-US') : pluralize(count, 'photo')

/**
 * "Box Hill, Surrey · 14 photos · 2 picked" (short: "Box Hill, Surrey · 14 ·
 * 2 picked"); "all picked" when every pickable photo is picked; "8 in album"
 * when some are members; parts with 0 are left out.
 */
export const formatDayMeta = (input: DayMetaInput): string => {
  const parts: string[] = []
  if (input.placeName) parts.push(input.placeName)
  parts.push(formatCount(input.count, input.short ?? false))
  const pickable = input.count - input.inAlbum
  if (input.selecting && input.picked > 0) {
    parts.push(
      input.picked >= pickable
        ? 'all picked'
        : `${input.picked.toLocaleString('en-US')} picked`
    )
  }
  if (input.inAlbum > 0) {
    parts.push(`${input.inAlbum.toLocaleString('en-US')} in album`)
  }
  return parts.join(' · ')
}

export interface SelectDayInput {
  count: number
  inAlbum: number
  picked: number
  /** Null: no capacity (All media). */
  room: number | null
  hasAlbum: boolean
}

export interface SelectDayAction {
  kind: 'select' | 'deselect'
  label: string
  short: string
  disabled: boolean
  take: number
}

/**
 * The Select day button's state, in this order (pickable = count − inAlbum,
 * remaining = pickable − picked):
 * 1. `pickable === 0 && hasAlbum` → disabled "All in album"
 * 2. `remaining <= 0 && picked > 0` → "Deselect day"
 * 3. `room === 0` → disabled "Album full"
 * 4. `room !== null && room < remaining` → "Select N (room left)", take N
 * 5. `picked === 0` → "Select day", take remaining
 * 6. else → "Select N more", take remaining
 * `count === 0` is rule 1 when `hasAlbum`, else a disabled "Select day".
 */
export const getSelectDayAction = (input: SelectDayInput): SelectDayAction => {
  const formatNumber = (value: number) => value.toLocaleString('en-US')
  if (input.count === 0 && !input.hasAlbum) {
    return {
      kind: 'select',
      label: 'Select day',
      short: 'Select day',
      disabled: true,
      take: 0
    }
  }
  const pickable = Math.max(input.count - input.inAlbum, 0)
  const remaining = pickable - input.picked
  if (pickable === 0 && input.hasAlbum) {
    return {
      kind: 'select',
      label: 'All in album',
      short: 'All in album',
      disabled: true,
      take: 0
    }
  }
  if (remaining <= 0 && input.picked > 0) {
    return {
      kind: 'deselect',
      label: 'Deselect day',
      short: 'Deselect day',
      disabled: false,
      take: 0
    }
  }
  if (input.room === 0) {
    return {
      kind: 'select',
      label: 'Album full',
      short: 'Album full',
      disabled: true,
      take: 0
    }
  }
  if (input.room !== null && input.room < remaining) {
    return {
      kind: 'select',
      label: `Select ${formatNumber(input.room)} (room left)`,
      short: `Select ${formatNumber(input.room)}`,
      disabled: false,
      take: input.room
    }
  }
  if (input.picked === 0) {
    return {
      kind: 'select',
      label: 'Select day',
      short: 'Select day',
      disabled: false,
      take: remaining
    }
  }
  return {
    kind: 'select',
    label: `Select ${formatNumber(remaining)} more`,
    short: `Select ${formatNumber(remaining)}`,
    disabled: false,
    take: remaining
  }
}

export const SPORT_EMOJI: Partial<Record<SportKey, string>> = {
  ride: '🚴',
  gravel_ride: '🚴',
  mountain_bike_ride: '🚴',
  ebike_ride: '🚴',
  virtual_ride: '🚴',
  run: '🏃',
  trail_run: '🏃',
  walk: '🚶',
  hike: '🥾'
}

/**
 * The day phrase of the Select day toast: "from Sat 4 Oct 2025" for a dated
 * day, "uploaded Sat 24 Oct 2026" for an upload-day group (its heading already
 * says "Uploaded", which would read as "from Uploaded …").
 */
export const formatDayToastPhrase = (key: GalleryDayKey): string => {
  const parsed = parseGalleryDayKey(key)
  if (parsed?.uploaded) {
    return `uploaded ${formatHeadingParts(parsed.day, false)}`
  }
  return `from ${formatDayHeading(key)}`
}
