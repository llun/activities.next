import { formatActivityTypeLabel } from '@/lib/services/fitness-files/activityPresentation'
import {
  SPORT_LABELS,
  normalizeActivityTypeToSportKey
} from '@/lib/services/fitness-files/sportTypes'
import type { GalleryActivityFacet } from '@/lib/services/gallery/galleryEntities'
import { GALLERY_FILTER_NONE } from '@/lib/types/database/gallery'
import { formatFitnessDistance } from '@/lib/utils/fitness'

/**
 * An activity's distance ("64.2 km"), or null when it has none. Used by
 * the chip title.
 */
export const formatActivityDistance = (
  facet: Pick<GalleryActivityFacet, 'distanceMeters'> | undefined
): string | null =>
  typeof facet?.distanceMeters === 'number' && facet.distanceMeters > 0
    ? formatFitnessDistance(facet.distanceMeters)
    : null

/**
 * An activity's chip title, shared by the filter menus and the day headers.
 * It lives outside `filters/` so the gallery's own components can use it
 * without importing from the filter family.
 */
export const formatActivityTitle = (
  facet:
    Pick<GalleryActivityFacet, 'activityType' | 'distanceMeters'> | undefined,
  activityId: string | null
): string => {
  if (activityId === GALLERY_FILTER_NONE) {
    return 'Not from an activity'
  }
  if (facet) {
    let sportLabel = 'Activity'
    if (facet.activityType) {
      const sportKey = normalizeActivityTypeToSportKey(facet.activityType)
      if (sportKey && SPORT_LABELS[sportKey]) {
        sportLabel = SPORT_LABELS[sportKey]
      } else {
        sportLabel = formatActivityTypeLabel(facet.activityType)
      }
    }

    const distance = formatActivityDistance(facet)

    if (distance) {
      return `${sportLabel} · ${distance}`
    }
    return sportLabel
  }
  if (activityId) {
    return 'Activity'
  }
  return 'Any activity'
}
