import type { ActorSettingsField } from '@/lib/types/database/rows'

type FieldInput = { name: string; value: string; verifiedAt?: number | null }
// `verifiedAt` on the input is accepted only so callers can pass stored rows
// through; it is never trusted.

/**
 * The fields to store when a profile is saved: a field keeps the verification
 * of a stored field with the same value (the check is about the link, not the
 * label), and a changed value starts unverified. `verifiedAt` is always read
 * from the stored row, never from the input, so a client cannot mark a link
 * verified; only the verification job writes it.
 */
export const carryOverFieldVerification = (
  next: FieldInput[],
  previous: ActorSettingsField[] | undefined
): ActorSettingsField[] =>
  next.map((field) => {
    const verifiedAt = (previous ?? []).find(
      (stored) => stored.value === field.value && stored.verifiedAt
    )?.verifiedAt
    return verifiedAt
      ? { name: field.name, value: field.value, verifiedAt }
      : { name: field.name, value: field.value }
  })

/**
 * Whether the list of field values differs. Labels do not matter: the check
 * reads the value's page, so renaming a row never needs a new one.
 */
export const profileFieldValuesChanged = (
  before: { value: string }[] | undefined,
  after: { value: string }[]
): boolean => {
  const previous = before ?? []
  return (
    previous.length !== after.length ||
    previous.some((field, index) => field.value !== after[index].value)
  )
}
