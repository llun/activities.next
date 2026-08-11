import { z } from 'zod'

import {
  SPORT_KEYS,
  SPORT_KIND,
  SportKey
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

const optionalEpochMilliseconds = z.number().int().positive().nullish()

export const GearKindSchema = z.enum(['bike', 'shoes'])

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
  notes: optionalText(NOTES_MAX)
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

export const UpdateFitnessFileGearRequest = z.object({
  gearId: z.string().max(VARCHAR_MAX).nullable()
})

/**
 * Bikes and shoes carry different fields, and each sport belongs to exactly one
 * kind. Rejecting a mismatch keeps a shoes row from growing a frame type and
 * stops "Ride" being set as the default sport of a pair of trainers, which the
 * auto-assign lookup would then never satisfy.
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
  }
): string | null => {
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
