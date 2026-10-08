import {
  GalleryGear,
  GalleryGearKind,
  GallerySettings,
  MediaPlacePrecision,
  MediaSubjectCategory
} from '@/lib/types/database/gallery'

// Entities the gallery routes send and `lib/client/gallery.ts` consumes. This
// module has no server-only imports: client components import these types.

/** A camera or lens as the web client consumes it. */
export interface GalleryGearEntity {
  id: string
  kind: GalleryGearKind
  name: string
  brand: string | null
  model: string | null
  productUrl: string | null
  retiredAt: number | null
  createdAt: number
}

export const toGalleryGearEntity = (gear: GalleryGear): GalleryGearEntity => ({
  id: gear.id,
  kind: gear.kind,
  name: gear.name,
  brand: gear.brand ?? null,
  model: gear.model ?? null,
  productUrl: gear.productUrl ?? null,
  retiredAt: gear.retiredAt ?? null,
  createdAt: gear.createdAt
})

/**
 * `GET/PUT /api/v1/gallery/settings`: the stored settings, flat, plus whether
 * the instance has alt text generation configured at all (which decides if the
 * auto-describe toggle and a Regenerate button can do anything).
 */
export type GallerySettingsEntity = GallerySettings & {
  altTextAvailable: boolean
}

/**
 * `GET /api/v1/gallery/media/:mediaId/details` — what anyone who may see the
 * post may learn about a photo. Never carries exact coordinates unless the
 * owner chose `exact` precision, and never carries gear unless the owner
 * shows it.
 */
export interface MediaPublicDetails {
  subject: {
    name: string | null
    scientificName: string | null
    category: MediaSubjectCategory | null
  } | null
  takenAt: string | null
  camera: { name: string } | null
  lens: { name: string } | null
  exposure: {
    focalLengthMm: number | null
    aperture: number | null
    exposureTime: string | null
    iso: number | null
  } | null
  place: {
    name: string | null
    precision: MediaPlacePrecision | null
    // Absent for `country`, `hidden` and a place with no precision; rounded to
    // a ~5 km grid for `area`; exact only for `exact`.
    latitude?: number
    longitude?: number
  } | null
}
