import { getActorPerson } from '@/lib/activities/getActorPerson'
import { Database } from '@/lib/database/types'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { getFederationSigningActor } from '@/lib/services/federation/getFederationSigningActor'
import { Actor } from '@/lib/types/domain/actor'
import { getActorImageUrl } from '@/lib/utils/activitypubActor'
import { logger } from '@/lib/utils/logger'

interface RecordActorIfNeededParams {
  actorId: string
  database: Database
  signingActor?: Actor
}

export class BlockedFederationDomainError extends Error {
  constructor(actorId: string) {
    super(`Federation with actor domain is blocked: ${actorId}`)
    this.name = 'BlockedFederationDomainError'
  }
}

export const assertActorCanFederate = async ({
  actorId,
  database
}: RecordActorIfNeededParams): Promise<void> => {
  if (!(await canFederateWithDomain(database, actorId))) {
    throw new BlockedFederationDomainError(actorId)
  }
}

export const recordActorIfNeeded = async ({
  actorId,
  database,
  signingActor
}: RecordActorIfNeededParams): Promise<Actor | undefined> => {
  await assertActorCanFederate({ actorId, database })

  const existingActor = await database.getActorFromId({
    id: actorId
  })
  // Don't update local actor
  if (existingActor?.privateKey) {
    return existingActor
  }

  const getResolvedSigningActor = async () => {
    const resolvedSigningActor = await getFederationSigningActor(
      database,
      signingActor
    )
    if (!resolvedSigningActor) {
      logger.warn({
        message: 'Fetching remote actor without a federation signing actor',
        actorId
      })
    }
    return resolvedSigningActor
  }

  if (!existingActor) {
    const person = await getActorPerson({
      actorId,
      signingActor: await getResolvedSigningActor()
    })
    if (!person) return
    const iconUrl = getActorImageUrl(person.icon)
    const actor = await database.createActor({
      actorId,
      username: person.preferredUsername,
      domain: new URL(person.id).hostname,
      followersUrl: person.followers ?? '',
      inboxUrl: person.inbox,
      sharedInboxUrl: person.endpoints?.sharedInbox ?? person.inbox,
      ...(iconUrl ? { iconUrl } : {}),
      publicKey: person.publicKey.publicKeyPem || '',
      createdAt: new Date(person.published ?? Date.now()).getTime()
    })
    return actor ?? undefined
  }

  const currentTime = Date.now()
  // Update actor if it's older than 3 day
  if (currentTime - existingActor.updatedAt > 3 * 86_400_000) {
    const person = await getActorPerson({
      actorId,
      signingActor: await getResolvedSigningActor()
    })
    if (!person) return undefined
    const iconUrl = getActorImageUrl(person.icon)
    const actor = await database.updateActor({
      actorId,
      followersUrl: person.followers ?? '',
      inboxUrl: person.inbox,
      sharedInboxUrl: person.endpoints?.sharedInbox ?? person.inbox,
      ...(iconUrl ? { iconUrl } : {}),
      publicKey: person.publicKey.publicKeyPem || ''
    })
    return actor ?? undefined
  }
  return existingActor
}
