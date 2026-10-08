import { z } from 'zod'

import {
  MEDIA_PLACE_PRECISIONS,
  MEDIA_SUBJECT_CATEGORIES
} from '@/lib/types/database/gallery'
import { Booleanish } from '@/lib/utils/zodBooleanish'

// `subjectName`, `subjectScientificName` and `placeName` are varchar(255).
const VARCHAR_MAX = 255

/**
 * An optional text field where an empty or whitespace-only string (what a
 * cleared form field sends) is an explicit clear.
 *
 * `.optional()` stays OUTERMOST on purpose: applied before the transform, the
 * transform still runs for a key that is absent from the body and yields `null`,
 * and the update path — which uses presence to decide what to touch — would
 * wipe every column the caller never mentioned.
 */
const clearableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((value) => value || null)
    .optional()

// Multipart bodies send every value as a string, JSON bodies send numbers; an
// empty string clears either way.
const clearableNumber = (min: number, max: number) =>
  z
    .preprocess((value) => {
      if (typeof value === 'string') {
        return value.trim() === '' ? null : Number(value)
      }
      return value
    }, z.number().min(min).max(max).nullable())
    .optional()

const clearableEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .preprocess(
      (value) => (value === '' ? null : value),
      z.enum(values).nullable()
    )
    .optional()

/**
 * The media details `PUT/PATCH /api/v1/media/:id` accepts beyond Mastodon's
 * `description`, `focus` and `thumbnail`. Every field is optional: an absent key
 * leaves the column alone, an explicit `null` (or an empty string) clears it.
 */
export const MediaDetailsRequest = z.object({
  subject_name: clearableText(VARCHAR_MAX),
  subject_scientific_name: clearableText(VARCHAR_MAX),
  subject_category: clearableEnum(MEDIA_SUBJECT_CATEGORIES),
  // The GBIF usage key the owner picked. Only the key is taken: the server
  // resolves the taxonomy and IUCN category itself and never trusts a client's.
  subject_taxon_key: z
    .preprocess(
      (value) =>
        typeof value === 'string' && value.trim() === '' ? null : value,
      z
        .string()
        .regex(/^\d{1,12}$/)
        .nullable()
    )
    .optional(),
  camera_gear_id: clearableText(VARCHAR_MAX),
  lens_gear_id: clearableText(VARCHAR_MAX),
  place_name: clearableText(VARCHAR_MAX),
  place_latitude: clearableNumber(-90, 90),
  place_longitude: clearableNumber(-180, 180),
  place_precision: clearableEnum(MEDIA_PLACE_PRECISIONS),
  in_gallery: Booleanish.optional()
})
export type MediaDetailsRequest = z.infer<typeof MediaDetailsRequest>

export const MEDIA_DETAILS_REQUEST_KEYS = Object.keys(
  MediaDetailsRequest.shape
) as (keyof MediaDetailsRequest)[]
