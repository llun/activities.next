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

export const getActorIdUsername = (actorId: string) =>
  decodeURIComponent(actorId.split('/').filter(Boolean).pop() || actorId)
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

// Mastodon profile metadata fields arrive as PropertyValue attachments on the
// actor document. Unknown attachment shapes are tolerated by the schema (the
// loose-object fallback), so narrow back to valid PropertyValues here.
export const getActorProfileFields = (
  person: ActivityPubActor
): { name: string; value: string }[] => {
  const attachments = Array.isArray(person.attachment)
    ? person.attachment
    : person.attachment
      ? [person.attachment]
      : []
  return attachments.flatMap((item) => {
    const parsed = PropertyValue.safeParse(item)
    return parsed.success
      ? [{ name: parsed.data.name, value: parsed.data.value }]
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
