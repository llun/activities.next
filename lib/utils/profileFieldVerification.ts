import type { ActorSettingsField } from '@/lib/types/database/rows'

type FieldInput = { name: string; value: string; verifiedAt?: number | null }

/**
 * The fields to store when a profile is saved: a field that arrives without
 * `verifiedAt` keeps the verification of a stored field with the same value
 * (the check is about the link, not the label), and a changed value starts
 * unverified. A field that arrives with `verifiedAt` set (the verification job
 * writing its result) is kept as given.
 */
export const carryOverFieldVerification = (
  next: FieldInput[],
  previous: ActorSettingsField[] | undefined
): ActorSettingsField[] =>
  next.map((field) => {
    if (field.verifiedAt !== undefined) {
      return field.verifiedAt === null
        ? { name: field.name, value: field.value }
        : { ...field, verifiedAt: field.verifiedAt }
    }
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
