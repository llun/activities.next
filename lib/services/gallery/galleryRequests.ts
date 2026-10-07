import { z } from 'zod'

import {
  GALLERY_DEFAULTS,
  GALLERY_GEAR_KINDS,
  MEDIA_PLACE_PRECISIONS
} from '@/lib/types/database/gallery'

// `name`, `brand`, `model` and `productUrl` are varchar(255).
const VARCHAR_MAX = 255

// The map's hidden locations (a later change) are a small list of areas;
// the cap keeps an arbitrary JSON blob out of the column.
const MAX_HIDDEN_LOCATIONS = 200
const MAX_HIDDEN_LOCATIONS_BYTES = 64 * 1024

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
  hiddenLocations: z
    .array(z.record(z.string(), z.unknown()))
    .max(MAX_HIDDEN_LOCATIONS)
    .refine(
      (value) => JSON.stringify(value).length <= MAX_HIDDEN_LOCATIONS_BYTES,
      { message: 'hiddenLocations is too large' }
    )
    .optional()
})
export type UpdateGallerySettingsRequest = z.infer<
  typeof UpdateGallerySettingsRequest
>
