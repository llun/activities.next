import { getNote } from '@/lib/activities'
import { getActorPerson } from '@/lib/activities/getActorPerson'
import { normalizeActivityPubContent } from '@/lib/utils/activitypub'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
} from '@/lib/utils/activitystream'
import { logger } from '@/lib/utils/logger'

import { Actor } from '../types/activitypub'
import { Note } from '../types/activitypub/objects'
import { ActorProfile, Actor as DomainActor } from '../types/domain/actor'
import { StatusNote, fromNote } from '../types/domain/status'

type GetRemoteStatusParams = {
  statusId: string
  signingActor?: DomainActor
}

const publicStreams = [
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT,
  'Public',
  'as:Public'
]

const hasPublicAudience = (value: Note['to'] | Note['cc']) => {
  const items = Array.isArray(value) ? value : [value]
  return items.some(
    (item): item is string =>
      typeof item === 'string' && publicStreams.includes(item)
  )
}

const getActorDomain = (actorId: string) => {
  try {
    return new URL(actorId).host
  } catch {
    return actorId
  }
}

const getImageUrl = (image: Actor['icon']) => {
  if (!image) return undefined
  if (Array.isArray(image)) return image.find((item) => item.url)?.url
  return image.url
}

const getActorProfileFromPerson = (person: Actor): ActorProfile =>
  ActorProfile.parse({
    id: person.id,
    username: person.preferredUsername,
    domain: getActorDomain(person.id),
    name: person.name,
    summary: person.summary || undefined,
    iconUrl: getImageUrl(person.icon),
    headerImageUrl: getImageUrl(person.image),
    manuallyApprovesFollowers: person.manuallyApprovesFollowers,
    followersUrl: person.followers || `${person.id}/followers`,
    inboxUrl: person.inbox,
    sharedInboxUrl: person.endpoints?.sharedInbox || '',
    followingCount: 0,
    followersCount: 0,
    statusCount: 0,
    lastStatusAt: null,
    createdAt: person.published ? new Date(person.published).getTime() : 0
  })

export const getRemoteStatus = async ({
  statusId,
  signingActor
}: GetRemoteStatusParams): Promise<StatusNote | null> => {
  try {
    const remoteNote = await getNote({ statusId, signingActor })
    if (!remoteNote) return null

    const note = normalizeActivityPubContent(remoteNote) as Note
    if (!hasPublicAudience(note.to) && !hasPublicAudience(note.cc)) {
      return null
    }

    const status = fromNote(note)
    const actorPerson = await getActorPerson({
      actorId: status.actorId,
      signingActor
    })
    status.actor = actorPerson ? getActorProfileFromPerson(actorPerson) : null

    return status
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException
    logger.error(`[getRemoteStatus] ${nodeError.message}`)
    return null
  }
}
