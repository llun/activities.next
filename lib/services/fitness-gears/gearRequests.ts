import { z } from 'zod'

import {
  SPORT_KEYS,
  SPORT_KIND,
  SportKey,
  USER_CREATABLE_GEAR_KINDS
} from '@/lib/services/fitness-files/sportTypes'
import { FitnessGearKind } from '@/lib/types/database/fitnessGear'

// `name`, `brand`, `model`, `bikeType` and `componentType` all land in
// varchar(255) columns, so the caps are the column widths rather than taste.
const VARCHAR_MAX = 255
const NOTES_MAX = 2000

// 1000 kg of bicycle and 100_000 km of service interval are both absurd; the
// bounds exist to keep a typo out of the column, not to express a real limit.
const MAX_WEIGHT_KILOGRAMS = 1000
const MAX_DISTANCE_METERS = 100_000_000

/**
 * An optional text field that treats an empty or whitespace-only string as an
 * explicit clear.
 *
 * `.nullish()` comes LAST on purpose. Applied before the transform, the effect
 * still runs for a key that is absent from the body and yields `null` — so the
 * update paths, which use presence (`'field' in params`) to decide what to
 * touch, would see every optional field on every request and wipe the columns
 * the caller never mentioned. With the optional wrapper outermost, an absent
 * key short-circuits and stays absent, an explicit `null` clears, and a string
 * is trimmed.
 */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => value || null)
    .nullish()

const optionalPositiveNumber = (max: number) =>
  z.number().positive().max(max).nullish()

/**
 * The largest instant `new Date()` can represent: the ECMA-262 time value range
 * is ±100,000,000 days around the epoch (§21.4.1.1).
 *
 * `.int()` only caps at `Number.MAX_SAFE_INTEGER`, which is a thousand times
 * larger, and everything in between becomes an `Invalid Date` — which
 * PostgreSQL rejects with a throw the route never catches (a 500 for what is
 * plainly bad input), while SQLite stores it as NULL. The NULL is the worse
 * outcome of the two: a null `addedAt` means "installed since the gear's
 * beginning", so the component silently claims every activity ever ridden on
 * that bike.
 */
const MAX_EPOCH_MILLISECONDS = 8_640_000_000_000_000

const optionalEpochMilliseconds = z
  .number()
  .int()
  .positive()
  .max(MAX_EPOCH_MILLISECONDS)
  .nullish()

/**
 * Only the kinds a person may create. `device` is deliberately absent, so
 * `POST /api/v1/fitness/gear` answers a device the same 422 it answers `skis`:
 * device rows are created solely by `resolveDeviceGear`, keyed on the identity
 * the recorded file carried, and one made by hand would match no upload.
 */
export const GearKindSchema = z.enum(USER_CREATABLE_GEAR_KINDS)

/**
 * A device's product page. Only http/https is accepted — the value is rendered
 * as an anchor on the device page, and `javascript:`/`data:` there is a script
 * injection dressed as a link. `new URL` also rejects a bare "garmin.com",
 * which would otherwise render as a same-origin relative link.
 */
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
  // `.nullish()` LAST, for the reason `optionalText` documents above: applied
  // before the transform it would make an absent key arrive as an explicit
  // `null` and clear a column the caller never mentioned.
  .nullish()

export const CreateGearRequest = z.object({
  kind: GearKindSchema,
  name: z.string().trim().min(1).max(VARCHAR_MAX),
  brand: optionalText(VARCHAR_MAX),
  model: optionalText(VARCHAR_MAX),
  bikeType: optionalText(VARCHAR_MAX),
  weightKilograms: optionalPositiveNumber(MAX_WEIGHT_KILOGRAMS),
  defaultSports: z.array(z.enum(SPORT_KEYS)).max(SPORT_KEYS.length).optional(),
  alertDistanceMeters: optionalPositiveNumber(MAX_DISTANCE_METERS),
  notes: optionalText(NOTES_MAX)
})

export const UpdateGearRequest = z.object({
  // `kind` is immutable: it decides which sports and fields are meaningful, and
  // switching it would strand the gear's components and default sports.
  name: z.string().trim().min(1).max(VARCHAR_MAX).optional(),
  brand: optionalText(VARCHAR_MAX),
  model: optionalText(VARCHAR_MAX),
  bikeType: optionalText(VARCHAR_MAX),
  weightKilograms: optionalPositiveNumber(MAX_WEIGHT_KILOGRAMS),
  defaultSports: z.array(z.enum(SPORT_KEYS)).max(SPORT_KEYS.length).optional(),
  alertDistanceMeters: optionalPositiveNumber(MAX_DISTANCE_METERS),
  notes: optionalText(NOTES_MAX),
  productUrl: optionalProductUrl
})

export const RetireGearRequest = z.object({
  retired: z.boolean()
})

export const CreateGearComponentRequest = z
  .object({
    componentType: z.string().trim().min(1).max(VARCHAR_MAX),
    brand: optionalText(VARCHAR_MAX),
    model: optionalText(VARCHAR_MAX),
    addedAt: optionalEpochMilliseconds,
    removedAt: optionalEpochMilliseconds,
    serviceDistanceMeters: optionalPositiveNumber(MAX_DISTANCE_METERS)
  })
  .refine(
    (body) => !body.addedAt || !body.removedAt || body.removedAt > body.addedAt,
    { message: 'removedAt must be after addedAt' }
  )

export const UpdateGearComponentRequest = z
  .object({
    componentType: z.string().trim().min(1).max(VARCHAR_MAX).optional(),
    brand: optionalText(VARCHAR_MAX),
    model: optionalText(VARCHAR_MAX),
    addedAt: optionalEpochMilliseconds,
    removedAt: optionalEpochMilliseconds,
    serviceDistanceMeters: optionalPositiveNumber(MAX_DISTANCE_METERS)
  })
  .refine(
    (body) => !body.addedAt || !body.removedAt || body.removedAt > body.addedAt,
    { message: 'removedAt must be after addedAt' }
  )

export const ReplaceGearComponentRequest = z.object({
  brand: optionalText(VARCHAR_MAX),
  model: optionalText(VARCHAR_MAX)
})

/**
 * `null` clears an activity's gear attribution, and an empty or whitespace-only
 * string means the same thing — the normalization is the server's job, not the
 * picker's.
 *
 * Without it, `''` is neither null nor a gear id: `setFitnessFileGear`'s
 * `if (gearId)` ownership lookup does not run, so the empty string is written
 * straight into `fitness_files.gearId` with no check at all, and
 * `assignFitnessFileGearIfUnset`'s `whereNull('gearId')` guard then means the
 * activity can never be auto-assigned again while no rollup ever matches it.
 * The shipped UI happens to send `value || null`; that is a client detail this
 * schema must not depend on.
 */
export const UpdateFitnessFileGearRequest = z.object({
  gearId: z
    .string()
    .trim()
    .max(VARCHAR_MAX)
    .transform((value) => value || null)
    .nullable()
})

/**
 * Bikes and shoes carry different fields, and each sport belongs to exactly one
 * kind. Rejecting a mismatch keeps a shoes row from growing a frame type and
 * stops "Ride" being set as the default sport of a pair of trainers, which the
 * auto-assign lookup would then never satisfy.
 *
 * A device is narrower still: it owns none of those fields, and `productUrl` is
 * the one field only it owns.
 *
 * Returns an error message for the 422 body, or null when the fields fit.
 */
export const getGearKindFieldError = (
  kind: FitnessGearKind,
  fields: {
    bikeType?: string | null
    weightKilograms?: number | null
    alertDistanceMeters?: number | null
    defaultSports?: SportKey[]
    productUrl?: string | null
  }
): string | null => {
  // Checked first and in full: a device shares no field with the other two, so
  // falling through to the bike/shoes rules below would let a device quietly
  // accept a frame type.
  if (kind === 'device') {
    if (fields.bikeType) return 'bikeType is not valid for a device'
    if (
      fields.weightKilograms !== undefined &&
      fields.weightKilograms !== null
    ) {
      return 'weightKilograms is not valid for a device'
    }
    if (
      fields.alertDistanceMeters !== undefined &&
      fields.alertDistanceMeters !== null
    ) {
      return 'alertDistanceMeters is not valid for a device'
    }
    // A device records rides and runs alike, so it can hold no sport of its own
    // without stealing that sport from the bike or shoes that should have it.
    if ((fields.defaultSports ?? []).length > 0) {
      return 'defaultSports is not valid for a device'
    }
    return null
  }

  if (fields.productUrl !== undefined && fields.productUrl !== null) {
    return 'productUrl is only valid for a device'
  }

  if (kind === 'shoes') {
    if (fields.bikeType) return 'bikeType is only valid for a bike'
    if (
      fields.weightKilograms !== undefined &&
      fields.weightKilograms !== null
    ) {
      return 'weightKilograms is only valid for a bike'
    }
  }

  if (
    kind === 'bike' &&
    fields.alertDistanceMeters !== undefined &&
    fields.alertDistanceMeters !== null
  ) {
    return 'alertDistanceMeters is only valid for shoes'
  }

  const mismatched = (fields.defaultSports ?? []).find(
    (sportKey) => SPORT_KIND[sportKey] !== kind
  )
  if (mismatched) {
    return `${mismatched} is not a ${kind} sport`
  }

  return null
}
