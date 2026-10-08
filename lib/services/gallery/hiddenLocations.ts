import {
  isPointInsideAnyPrivacyLocation,
  sanitizePrivacyLocationSettings
} from '@/lib/services/fitness-files/privacy'
import { GalleryHiddenLocation } from '@/lib/types/database/gallery'

// Client-safe: the privacy editor and the settings parser both use this.

export type { GalleryHiddenLocation } from '@/lib/types/database/gallery'

// A handful of places (home, a nest site, a relative's garden) is the use; the
// cap keeps the column and the per-point check small.
export const MAX_GALLERY_HIDDEN_LOCATIONS = 50

/**
 * The stored or submitted hidden locations, made safe to use: anything that is
 * not a finite in-range coordinate pair with a positive radius is dropped,
 * radii snap UP to the next Fitness radius option, duplicates collapse, and the
 * list is capped. Never throws, so a corrupt column reads as "no zones" rather
 * than an error — the place precision rules still apply on their own.
 */
export const parseGalleryHiddenLocations = (
  value: unknown
): GalleryHiddenLocation[] =>
  sanitizePrivacyLocationSettings(value).slice(0, MAX_GALLERY_HIDDEN_LOCATIONS)

/** Whether a point lies inside (or on the edge of) any hidden location. */
export const isInGalleryHiddenLocation = (
  latitude: number,
  longitude: number,
  zones: readonly GalleryHiddenLocation[]
): boolean =>
  isPointInsideAnyPrivacyLocation(
    { lat: latitude, lng: longitude },
    zones.map((zone) => ({
      lat: zone.latitude,
      lng: zone.longitude,
      radiusMeters: zone.hideRadiusMeters
    }))
  )
