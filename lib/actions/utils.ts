import { getActorPerson } from '@/lib/activities/requests/getActorPerson'
import { Database } from '@/lib/database/types'
import { Actor } from '@/lib/models/actor'

interface RecordActorIfNeededParams {
  actorId: string
  database: Database
}
export const recordActorIfNeeded = async ({
  actorId,
  database
}: RecordActorIfNeededParams): Promise<Actor | undefined> => {
  const existingActor = await database.getActorFromId({
    id: actorId
  })
  // Don't update local actor
  if (existingActor?.privateKey) {
    return existingActor
  }
  if (!existingActor) {
    const person = await getActorPerson({ actorId })
    if (!person) return
    return database.createActor({
      actorId,
      username: person.preferredUsername,
      domain: new URL(person.id).hostname,
      followersUrl: person.followers ?? '',
      inboxUrl: person.inbox,
      sharedInboxUrl: person.endpoints?.sharedInbox ?? person.inbox,
      ...(person.icon ? { iconUrl: person.icon.url } : {}),
      publicKey: person.publicKey.publicKeyPem || '',
      createdAt: new Date(person.published ?? Date.now()).getTime()
    })
  }

  const currentTime = Date.now()
  // Update actor if it's older than 3 day
  if (currentTime - existingActor.updatedAt > 3 * 86_400_000) {
    const person = await getActorPerson({ actorId })
    if (!person) return undefined
    return database.updateActor({
      actorId,
      followersUrl: person.followers ?? '',
      inboxUrl: person.inbox,
      sharedInboxUrl: person.endpoints?.sharedInbox ?? person.inbox,
      ...(person.icon ? { iconUrl: person.icon.url } : {}),
      publicKey: person.publicKey.publicKeyPem || ''
    })
  }
  return existingActor
}
