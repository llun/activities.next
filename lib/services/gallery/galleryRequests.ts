import { z } from 'zod'

import { MAX_FITNESS_PRIVACY_RADIUS_METERS } from '@/lib/services/fitness-files/privacy'
import {
  MAX_GALLERY_HIDDEN_LOCATIONS,
  parseGalleryHiddenLocations
} from '@/lib/services/gallery/hiddenLocations'
import {
  GALLERY_DEFAULTS,
  GALLERY_GEAR_KINDS,
  MAX_SUBJECT_CONFIDENCE_THRESHOLD,
  MEDIA_PLACE_PRECISIONS,
  MIN_SUBJECT_CONFIDENCE_THRESHOLD,
  SUBJECT_CONFIDENCE_THRESHOLD_STEP
} from '@/lib/types/database/gallery'

// `name`, `brand`, `model` and `productUrl` are varchar(255).
const VARCHAR_MAX = 255

/**
 * An optional text field that treats an empty or whitespace-only string as an
 * explicit clear. `.nullish()` comes LAST so an absent key stays absent (see
 * `optionalText` in gearRequests.ts for why order matters).
 */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => value || null)
    .nullish()

const optionalProductUrl = z
  .string()
  .trim()
  .max(VARCHAR_MAX)
  .transform((value) => value || null)
  .refine(
    (value) => {
      if (value === null) return true
      try {
        const url = new URL(value)
        return url.protocol === 'http:' || url.protocol === 'https:'
      } catch {
        return false
      }
    },
    { message: 'productUrl must be an http(s) URL' }
  )
  .nullish()

export const CreateGalleryGearRequest = z.object({
  kind: z.enum(GALLERY_GEAR_KINDS),
  name: z.string().trim().min(1).max(VARCHAR_MAX),
  brand: optionalText(VARCHAR_MAX),
  model: optionalText(VARCHAR_MAX),
  productUrl: optionalProductUrl
})
export type CreateGalleryGearRequest = z.infer<typeof CreateGalleryGearRequest>

// Every field is optional: an absent key leaves the setting alone.
export const UpdateGallerySettingsRequest = z.object({
  autoDescribe: z.boolean().optional(),
  allowEmptyDescription: z.boolean().optional(),
  subjectHashtags: z.boolean().optional(),
  galleryDefault: z.enum(GALLERY_DEFAULTS).optional(),
  defaultPlacePrecision: z.enum(MEDIA_PLACE_PRECISIONS).optional(),
  showGear: z.boolean().optional(),
  mapPublic: z.boolean().optional(),
  lifeListPublic: z.boolean().optional(),
  // The same shape as Fitness privacy locations. A strict object, so a typo'd
  // key is a 422 rather than a zone silently saved without its radius. The
  // transform snaps each radius up to a supported option and drops duplicates,
  // so what is written is exactly what `parseSQLGallerySettings` reads back.
  hiddenLocations: z
    .array(
      z
        .object({
          latitude: z.number().min(-90).max(90),
          longitude: z.number().min(-180).max(180),
          hideRadiusMeters: z
            .number()
            .positive()
            .max(MAX_FITNESS_PRIVACY_RADIUS_METERS)
        })
        .strict()
    )
    .max(MAX_GALLERY_HIDDEN_LOCATIONS)
    .transform(parseGalleryHiddenLocations)
    .optional(),
  hideThreatenedPlaces: z.boolean().optional(),
  // `classifier` is reserved for a species classifier no instance can
  // configure yet, so it is refused rather than stored.
  subjectSuggestionMode: z.enum(['model', 'off']).optional(),
  subjectConfidenceThreshold: z
    .number()
    .int()
    .min(MIN_SUBJECT_CONFIDENCE_THRESHOLD)
    .max(MAX_SUBJECT_CONFIDENCE_THRESHOLD)
    .multipleOf(SUBJECT_CONFIDENCE_THRESHOLD_STEP)
    .optional()
})
export type UpdateGallerySettingsRequest = z.infer<
  typeof UpdateGallerySettingsRequest
>

// The most non-deleted gear rows one actor may hold. GET returns every row
// unpaginated and each one is shown in the gear pickers.
export const MAX_GALLERY_GEAR_PER_ACTOR = 500

// Every field is optional: an absent key leaves the gear alone, and a blank
// brand, model or product url clears it. `kind` is not editable.
export const UpdateGalleryGearRequest = z
  .object({
    name: z.string().trim().min(1).max(VARCHAR_MAX).optional(),
    brand: optionalText(VARCHAR_MAX),
    model: optionalText(VARCHAR_MAX),
    productUrl: optionalProductUrl
  })
  .refine(
    (value) => Object.values(value).some((field) => field !== undefined),
    {
      message: 'At least one field is required'
    }
  )
export type UpdateGalleryGearRequest = z.infer<typeof UpdateGalleryGearRequest>

export const RetireGalleryGearRequest = z.object({ retired: z.boolean() })
export type RetireGalleryGearRequest = z.infer<typeof RetireGalleryGearRequest>

// Media kept in one Add to gallery step. The dialog adds what one drop or pick
// holds, and edits at most this many together (`MAX_EDIT_DETAILS_PHOTOS`), so
// a request past it is a runaway client's and is refused.
export const MAX_ADD_TO_GALLERY_MEDIA = 40

// `POST /api/v1/gallery/media`: a media id on the wire is the decimal
// `medias.id`; repeats are harmless (they are de-duplicated).
export const AddGalleryMediaRequest = z.object({
  media_ids: z
    .array(z.string().trim().regex(/^\d+$/).max(10))
    .min(1)
    .max(MAX_ADD_TO_GALLERY_MEDIA)
})
export type AddGalleryMediaRequest = z.infer<typeof AddGalleryMediaRequest>
