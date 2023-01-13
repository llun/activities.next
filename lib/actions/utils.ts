import { getPublicProfile } from '../activities'
import { Storage } from '../storage/types'

interface RecordActorIfNeededParams {
  actorId: string
  storage: Storage
}
export const recordActorIfNeeded = async ({
  actorId,
  storage
}: RecordActorIfNeededParams) => {
  const existingActor = await storage.getActorFromId({
    id: actorId
  })
  if (!existingActor) {
    const profile = await getPublicProfile({
      actorId,
      withPublicKey: true
    })
    if (!profile) return undefined
    return storage.createActor({
      actorId: profile.id,
      username: profile.username,
      domain: profile.domain,
      followersUrl: profile.endpoints.followers,
      inboxUrl: profile.endpoints.inbox,
      sharedInboxUrl: profile.endpoints.sharedInbox,
      publicKey: profile.publicKey || '',
      createdAt: profile.createdAt
    })
  }

  const currentTime = Date.now()
  // Update actor if it's older than a day
  if (currentTime - existingActor.data.updatedAt > 86_400_000) {
    const profile = await getPublicProfile({
      actorId,
      withPublicKey: true
    })
    if (!profile) return undefined
    return storage.updateActor({
      actorId: profile.id,
      followersUrl: profile.endpoints.followers,
      inboxUrl: profile.endpoints.inbox,
      sharedInboxUrl: profile.endpoints.sharedInbox,
      publicKey: profile.publicKey || ''
    })
  }
  return existingActor
}
