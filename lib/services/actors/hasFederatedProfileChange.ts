import { Actor } from '@/lib/types/domain/actor'
import { getPersonFromActor } from '@/lib/utils/getPersonFromActor'

type Json = unknown

// Key order must not matter, so two documents built from objects whose keys
// were spread in a different order still compare equal.
const stableStringify = (value: Json): string => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, Json>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

// What a remote server sees of the actor. Taken from `getPersonFromActor`, the
// document the actor URL serves and `Update(Person)` carries, so the list of
// federated fields (name, summary, icon and header URLs, profile links, the
// locked/discoverable/indexable flags, attribution domains, the emoji tags)
// can never drift from what is actually sent. The one volatile value is each
// emoji tag's `updated`, which `getPersonFromActor` takes from the row's
// `updatedAt`: it moves on every save, so it is not a change of the profile.
const withoutUpdated = (tag: unknown): unknown => {
  if (Array.isArray(tag)) return tag.map(withoutUpdated)
  if (tag && typeof tag === 'object') {
    const { updated: _updated, ...rest } = tag as Record<string, unknown>
    return rest
  }
  return tag
}

const toFederatedProfile = (actor: Actor): Json => {
  const { tag, ...person } = getPersonFromActor(actor)
  return { ...person, ...(tag ? { tag: withoutUpdated(tag) } : null) }
}

/**
 * Whether saving a profile changed anything the federated Person carries.
 *
 * Settings that only this server reads (post line limit, the profile tabs
 * shown, image alt texts, the featured-tags collection, link verification
 * stamps, notification and reading preferences) are not part of the Person, so
 * saving only those must not send an `Update(Person)` to every follower inbox.
 * When the comparison itself fails, the answer is `true`.
 */
export const hasFederatedProfileChange = (
  before: Actor,
  after: Actor
): boolean => {
  try {
    return (
      stableStringify(toFederatedProfile(before)) !==
      stableStringify(toFederatedProfile(after))
    )
  } catch {
    // A profile that cannot be rendered to compare is sent rather than
    // silently left stale on remote servers.
    return true
  }
}
