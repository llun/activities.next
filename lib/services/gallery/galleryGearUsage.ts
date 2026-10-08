import type { GalleryGearUsageRow } from '@/lib/database/sql/galleryMedia'
import type { Database } from '@/lib/database/types'
import {
  type GalleryGearEntity,
  type GalleryGearUsageEntity,
  toGalleryGearEntity
} from '@/lib/services/gallery/galleryEntities'
import { toCountryCode } from '@/lib/services/gallery/publicMediaDetails'

// Reduces `getGalleryGearUsageRows` to what the Gear section shows. Min and max
// are taken here, in JS, over the selected rows: SQLite can hold `takenAt` as
// integer milliseconds or as text, and a SQL MIN over the mix would order them
// by storage class rather than by time.

export interface GalleryGearUsageSource {
  getGalleryGearUsageRows: Database['getGalleryGearUsageRows']
}

export interface GalleryGearPairing {
  gearId: string
  // Gallery photos and videos taken with both pieces of gear.
  count: number
}

const emptyUsage = (): GalleryGearUsageEntity => ({
  photoCount: 0,
  videoCount: 0,
  countryCount: null,
  firstUsedAt: null,
  lastUsedAt: null
})

/**
 * Item count over gallery media only (photos and videos, so it matches the gear
 * page's grid), of which `videoCount` are videos, and the distinct countries
 * among them (null when no media has a country code: the stat is then left out,
 * not 0). The first and last use run over every posted media, in the gallery or
 * not, because the capture date shows real use either way. The upload time
 * stands in for a media without a capture date. Every id asked for gets an
 * entry.
 */
export const reduceGalleryGearUsage = (
  rows: GalleryGearUsageRow[],
  gearIds: string[]
): Map<string, GalleryGearUsageEntity> => {
  const usage = new Map<string, GalleryGearUsageEntity>(
    gearIds.map((gearId) => [gearId, emptyUsage()])
  )

  const countries = new Map<string, Set<string>>()

  for (const row of rows) {
    const entry = usage.get(row.gearId)
    if (!entry) continue

    if (row.inGallery) {
      entry.photoCount += 1
      if (row.originalMimeType.startsWith('video/')) entry.videoCount += 1
      // Owner-only rows, so the stored code; a media with no lookup adds none.
      const code = toCountryCode(row.placeCountryCode)
      if (code) {
        const seen = countries.get(row.gearId) ?? new Set<string>()
        seen.add(code)
        countries.set(row.gearId, seen)
      }
    }
    const usedAt = row.takenAt ?? row.createdAt
    if (!Number.isFinite(usedAt) || usedAt <= 0) continue
    if (entry.firstUsedAt === null || usedAt < entry.firstUsedAt) {
      entry.firstUsedAt = usedAt
    }
    if (entry.lastUsedAt === null || usedAt > entry.lastUsedAt) {
      entry.lastUsedAt = usedAt
    }
  }

  for (const [gearId, seen] of countries) {
    const entry = usage.get(gearId)
    if (entry) entry.countryCount = seen.size
  }

  return usage
}

/**
 * The other gear used on the same gallery media as `gearId` (a camera's lenses,
 * a lens's cameras), most shared first. Rows carry one (gear, media) pair each,
 * so a media with a camera and a lens shows up once under each.
 */
export const getMostUsedWith = (
  rows: GalleryGearUsageRow[],
  gearId: string,
  limit = 5
): GalleryGearPairing[] => {
  const mediaIds = new Set(
    rows
      .filter((row) => row.gearId === gearId && row.inGallery)
      .map((row) => row.mediaId)
  )

  const counts = new Map<string, number>()
  for (const row of rows) {
    if (row.gearId === gearId || !row.inGallery) continue
    if (!mediaIds.has(row.mediaId)) continue
    counts.set(row.gearId, (counts.get(row.gearId) ?? 0) + 1)
  }

  return [...counts.entries()]
    .map(([pairedId, count]) => ({ gearId: pairedId, count }))
    .toSorted(
      (left, right) =>
        right.count - left.count || left.gearId.localeCompare(right.gearId)
    )
    .slice(0, limit)
}

export const getGalleryGearUsage = async ({
  database,
  actorId,
  gearIds
}: {
  database: GalleryGearUsageSource
  actorId: string
  gearIds: string[]
}): Promise<Map<string, GalleryGearUsageEntity>> => {
  const rows = await database.getGalleryGearUsageRows({ actorId, gearIds })
  return reduceGalleryGearUsage(rows, gearIds)
}

export interface GalleryGearOverview {
  usage: GalleryGearUsageEntity
  // Names resolved, most shared first.
  mostUsedWith: { gear: GalleryGearEntity; count: number }[]
}

/**
 * One gear's usage and the gear most often used with it. The pairing needs the
 * rows of every other gear on the same media, so one read covers all of the
 * actor's (non-deleted) gear.
 */
export const getGalleryGearOverview = async ({
  database,
  actorId,
  gearId,
  limit = 5
}: {
  database: GalleryGearUsageSource & Pick<Database, 'getGalleryGearsByActor'>
  actorId: string
  gearId: string
  limit?: number
}): Promise<GalleryGearOverview> => {
  const gears = await database.getGalleryGearsByActor({ actorId })
  const gearIds = gears.map((gear) => gear.id)
  if (!gearIds.includes(gearId)) gearIds.push(gearId)

  const rows = await database.getGalleryGearUsageRows({ actorId, gearIds })
  const byId = new Map(gears.map((gear) => [gear.id, gear]))

  return {
    usage: reduceGalleryGearUsage(rows, [gearId]).get(gearId) ?? emptyUsage(),
    mostUsedWith: getMostUsedWith(rows, gearId, limit).flatMap(
      ({ gearId: pairedId, count }) => {
        const paired = byId.get(pairedId)
        return paired ? [{ gear: toGalleryGearEntity(paired), count }] : []
      }
    )
  }
}
