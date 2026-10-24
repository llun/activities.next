import { Database } from '@/lib/database/types'
import {
  GalleryActivityFacet,
  GalleryMediaFacetsResponse,
  GalleryMonthFacet,
  GalleryPlaceFacet,
  GallerySpeciesFacet,
  toPlaceKey,
  toSubjectKey
} from '@/lib/services/gallery/galleryEntities'
import { GalleryShow, MediaSubjectCategory } from '@/lib/types/database/gallery'

export const getGalleryMediaFacets = async ({
  database,
  owner,
  show
}: {
  database: Database
  owner: { id: string }
  show?: GalleryShow
}): Promise<GalleryMediaFacetsResponse> => {
  const facetRows = await database.getGalleryMediaFacetRows({
    actorId: owner.id,
    show
  })

  // 1. places & noPlaceCount
  let noPlaceCount = 0
  const placeGroups = new Map<
    string,
    {
      key: string
      count: number
      spellings: Map<string, { count: number; firstSeen: number }>
    }
  >()

  let placeRowIndex = 0
  for (const row of facetRows.places) {
    const key = toPlaceKey(row.placeName)
    if (!key) {
      noPlaceCount += row.count
      continue
    }

    const rawSpelling = row.placeName ? row.placeName.trim() : key
    let group = placeGroups.get(key)
    if (!group) {
      group = {
        key,
        count: 0,
        spellings: new Map()
      }
      placeGroups.set(key, group)
    }
    group.count += row.count

    const existing = group.spellings.get(rawSpelling)
    if (existing) {
      existing.count += row.count
    } else {
      group.spellings.set(rawSpelling, {
        count: row.count,
        firstSeen: placeRowIndex
      })
    }
    placeRowIndex += 1
  }

  const places: GalleryPlaceFacet[] = []
  // The one display spelling per place key, shared with the activities below.
  const placeNameByKey = new Map<string, string>()
  for (const group of placeGroups.values()) {
    let bestSpelling = ''
    let bestCount = -1
    let bestFirstSeen = Infinity
    for (const [spelling, stat] of group.spellings.entries()) {
      if (
        stat.count > bestCount ||
        (stat.count === bestCount && stat.firstSeen < bestFirstSeen)
      ) {
        bestSpelling = spelling
        bestCount = stat.count
        bestFirstSeen = stat.firstSeen
      }
    }
    placeNameByKey.set(group.key, bestSpelling)
    places.push({
      name: bestSpelling,
      count: group.count
    })
  }

  places.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'en'))

  // 2. species
  const speciesGroups = new Map<
    string,
    {
      key: string
      count: number
      candidates: Map<
        string,
        {
          name: string | null
          scientificName: string | null
          category: MediaSubjectCategory | null
          count: number
          firstSeen: number
        }
      >
    }
  >()

  let subjectRowIndex = 0
  for (const row of facetRows.subjects) {
    const key = toSubjectKey({
      name: row.subjectName,
      scientificName: row.subjectScientificName
    })
    if (key === null) {
      continue
    }

    let group = speciesGroups.get(key)
    if (!group) {
      group = {
        key,
        count: 0,
        candidates: new Map()
      }
      speciesGroups.set(key, group)
    }
    group.count += row.count

    const candidateKey = `${row.subjectName}\0${row.subjectScientificName}\0${row.subjectCategory}`
    const existing = group.candidates.get(candidateKey)
    if (existing) {
      existing.count += row.count
    } else {
      group.candidates.set(candidateKey, {
        name: row.subjectName,
        scientificName: row.subjectScientificName,
        category: row.subjectCategory,
        count: row.count,
        firstSeen: subjectRowIndex
      })
    }
    subjectRowIndex += 1
  }

  const species: GallerySpeciesFacet[] = []
  for (const group of speciesGroups.values()) {
    let bestCandidate: {
      name: string | null
      scientificName: string | null
      category: MediaSubjectCategory | null
    } | null = null
    let bestCount = -1
    let bestFirstSeen = Infinity

    for (const candidate of group.candidates.values()) {
      if (
        candidate.count > bestCount ||
        (candidate.count === bestCount && candidate.firstSeen < bestFirstSeen)
      ) {
        bestCandidate = candidate
        bestCount = candidate.count
        bestFirstSeen = candidate.firstSeen
      }
    }

    if (bestCandidate) {
      species.push({
        key: group.key,
        name: bestCandidate.name,
        scientificName: bestCandidate.scientificName,
        category: bestCandidate.category,
        count: group.count
      })
    }
  }

  species.sort(
    (a, b) =>
      b.count - a.count ||
      (a.name ?? a.scientificName ?? '').localeCompare(
        b.name ?? b.scientificName ?? '',
        'en'
      ) ||
      a.key.localeCompare(b.key, 'en')
  )

  // 3. months
  const monthMap = new Map<string, number>()
  for (const row of facetRows.months) {
    if (!row.month) continue
    monthMap.set(row.month, (monthMap.get(row.month) ?? 0) + row.count)
  }
  const months: GalleryMonthFacet[] = Array.from(monthMap.entries()).map(
    ([month, count]) => ({
      month,
      count
    })
  )
  months.sort((a, b) => b.month.localeCompare(a.month))

  // 4. activities & notFromActivityCount
  interface ActivityAccumulator {
    id: string
    activityType: string | null
    activityStartTime: number | null
    totalDistanceMeters: number | null
    mediaPlaceMap: Map<string, string | null>
  }
  const activityMap = new Map<string, ActivityAccumulator>()

  for (const row of facetRows.activityPhotos) {
    let act = activityMap.get(row.fitnessFileId)
    if (!act) {
      act = {
        id: row.fitnessFileId,
        activityType: row.activityType ?? null,
        activityStartTime:
          row.activityStartTime !== null && row.activityStartTime !== undefined
            ? Number(row.activityStartTime)
            : null,
        totalDistanceMeters:
          row.totalDistanceMeters !== null &&
          row.totalDistanceMeters !== undefined
            ? Number(row.totalDistanceMeters)
            : null,
        mediaPlaceMap: new Map()
      }
      activityMap.set(row.fitnessFileId, act)
    } else {
      if (!act.activityType && row.activityType) {
        act.activityType = row.activityType
      }
      if (
        act.activityStartTime === null &&
        row.activityStartTime !== null &&
        row.activityStartTime !== undefined
      ) {
        act.activityStartTime = Number(row.activityStartTime)
      }
      if (
        act.totalDistanceMeters === null &&
        row.totalDistanceMeters !== null &&
        row.totalDistanceMeters !== undefined
      ) {
        act.totalDistanceMeters = Number(row.totalDistanceMeters)
      }
    }

    if (!act.mediaPlaceMap.has(row.mediaId)) {
      act.mediaPlaceMap.set(row.mediaId, row.placeName)
    }
  }

  const activities: GalleryActivityFacet[] = []
  for (const act of activityMap.values()) {
    let activityPlaceName: string | null = null
    const activityPlaceGroups = new Map<
      string,
      {
        key: string
        count: number
        firstSeen: number
      }
    >()

    let placeSeq = 0
    for (const placeName of act.mediaPlaceMap.values()) {
      const key = toPlaceKey(placeName)
      if (!key) continue

      let group = activityPlaceGroups.get(key)
      if (!group) {
        group = {
          key,
          count: 0,
          firstSeen: placeSeq
        }
        activityPlaceGroups.set(key, group)
      }
      group.count += 1
      placeSeq += 1
    }

    if (activityPlaceGroups.size > 0) {
      let bestGroup:
        | (typeof activityPlaceGroups extends Map<string, infer V> ? V : never)
        | null = null
      for (const group of activityPlaceGroups.values()) {
        if (
          !bestGroup ||
          group.count > bestGroup.count ||
          (group.count === bestGroup.count &&
            group.firstSeen < bestGroup.firstSeen)
        ) {
          bestGroup = group
        }
      }

      if (bestGroup) {
        activityPlaceName = placeNameByKey.get(bestGroup.key) || null
      }
    }

    let startTime: string | null = null
    if (act.activityStartTime !== null && act.activityStartTime !== undefined) {
      const d = new Date(act.activityStartTime)
      if (!Number.isNaN(d.getTime())) {
        startTime = d.toISOString()
      }
    }

    activities.push({
      id: act.id,
      activityType: act.activityType,
      startTime,
      distanceMeters: act.totalDistanceMeters,
      placeName: activityPlaceName,
      count: act.mediaPlaceMap.size
    })
  }

  activities.sort((a, b) => {
    if (a.startTime === null && b.startTime === null) {
      return a.id.localeCompare(b.id)
    }
    if (a.startTime === null) return 1
    if (b.startTime === null) return -1
    return b.startTime.localeCompare(a.startTime) || a.id.localeCompare(b.id)
  })

  const notFromActivityCount = Math.max(
    0,
    facetRows.total - facetRows.activityMediaCount
  )

  return {
    total: facetRows.total,
    species,
    places,
    noPlaceCount,
    months,
    activities,
    notFromActivityCount
  }
}
