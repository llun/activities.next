import {
  Actor as ActivityPubActor,
  PropertyValue
} from '@/lib/types/activitypub'
import { ActorProfile } from '@/lib/types/domain/actor'

const UUID_USERNAME_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const getActorDomain = (actorId: string) => {
  try {
    return new URL(actorId).host
  } catch {
    return actorId
  }
}

// The last path segment of an actor id, percent-decoded. A remote server picks
// its own actor ids, so the segment may not be valid UTF-8 once decoded
// (`%FF`); `decodeURIComponent` throws on that, and this runs while rendering
// every post by the actor, so it falls back to the raw segment instead.
const decodeActorIdSegment = (segment: string) => {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

export const getActorIdUsername = (actorId: string) =>
  decodeActorIdSegment(actorId.split('/').filter(Boolean).pop() || actorId)
    .replace(/^@+/, '')
    .trim()

export const isOpaqueActorUsernameValue = (username: string) =>
  username.startsWith('did:') || UUID_USERNAME_PATTERN.test(username)

export const isOpaqueActorUsername = (actorId: string, username: string) => {
  const actorIdUsername = getActorIdUsername(actorId)
  return username === actorIdUsername && isOpaqueActorUsernameValue(username)
}

export const getActorImageUrl = (image: ActivityPubActor['icon']) => {
  if (!image) return undefined
  if (Array.isArray(image)) return image.find((item) => item.url)?.url
  return image.url
}

// How many of a remote actor's profile fields are kept, and how long each name
// and value may be. Mastodon's numbers for a remote account:
// ActivityPub::ProcessAccountService keeps the first `MAX_PROFILE_FIELDS` (50)
// PropertyValue attachments, and Account::Field strips each name and value and
// cuts it to `MAX_CHARACTERS_COMPAT` (2047) characters. Local fields keep their
// own, stricter limits (`lib/services/accounts/profileFieldLimits.ts`).
export const REMOTE_PROFILE_FIELD_LIMIT = 50
export const REMOTE_PROFILE_FIELD_MAX_LENGTH = 2047

// The first `limit` code points, as Ruby's `str[0, limit]` counts them, so a
// cut never splits a surrogate pair. Linear in `limit`, not in the input.
const truncateCodePoints = (text: string, limit: number) => {
  if (text.length <= limit) return text
  let end = 0
  for (let count = 0; count < limit && end < text.length; count++) {
    const code = text.charCodeAt(end)
    const next = text.charCodeAt(end + 1)
    end +=
      code >= 0xd800 && code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff
        ? 2
        : 1
  }
  return text.slice(0, end)
}

const capRemoteFieldText = (text: string) =>
  truncateCodePoints(text.trim(), REMOTE_PROFILE_FIELD_MAX_LENGTH)

const isPropertyValueType = (item: unknown) =>
  typeof item === 'object' &&
  item !== null &&
  (item as { type?: unknown }).type === 'PropertyValue'

// Mastodon profile metadata fields arrive as PropertyValue attachments on the
// actor document. Unknown attachment shapes are tolerated by the schema (the
// loose-object fallback), so narrow back to valid PropertyValues here. This is
// the one place a remote actor's fields are read, both for storage
// (`getPersistableProfile`) and for the profile page (`getProfileData`), so it
// applies Mastodon's remote caps in Mastodon's order: take the first 50
// attachments typed PropertyValue, drop any whose name or value is not a
// string, and strip and cut each name and value to 2047 characters. A value is
// the remote server's raw HTML, so a cut can end inside a tag; every place that
// shows it sanitizes it first (`sanitizeText`), which closes or drops the
// broken markup, exactly as Mastodon sanitizes the cut value it serves.
export const getActorProfileFields = (
  person: ActivityPubActor
): { name: string; value: string }[] => {
  const attachments = Array.isArray(person.attachment)
    ? person.attachment
    : person.attachment
      ? [person.attachment]
      : []
  return attachments
    .filter(isPropertyValueType)
    .slice(0, REMOTE_PROFILE_FIELD_LIMIT)
    .flatMap((item) => {
      const parsed = PropertyValue.safeParse(item)
      return parsed.success
        ? [
            {
              name: capRemoteFieldText(parsed.data.name),
              value: capRemoteFieldText(parsed.data.value)
            }
          ]
        : []
    })
}

const getActorCreatedAt = (published: string | null | undefined) => {
  if (!published) return 0
  const createdAt = Date.parse(published)
  return Number.isFinite(createdAt) ? createdAt : 0
}

export const getActorProfileFromPerson = (
  person: ActivityPubActor
): ActorProfile =>
  ActorProfile.parse({
    id: person.id,
    username: person.preferredUsername,
    domain: getActorDomain(person.id),
    name: person.name,
    summary: person.summary || undefined,
    iconUrl: getActorImageUrl(person.icon),
    headerImageUrl: getActorImageUrl(person.image),
    manuallyApprovesFollowers: person.manuallyApprovesFollowers,
    followersUrl: person.followers || `${person.id}/followers`,
    inboxUrl: person.inbox,
    sharedInboxUrl: person.endpoints?.sharedInbox || '',
    followingCount: 0,
    followersCount: 0,
    statusCount: 0,
    lastStatusAt: null,
    createdAt: getActorCreatedAt(person.published)
  })
