import { getPublicProfile } from '@/lib/activities'
import { Database } from '@/lib/database/types'

interface RecordActorIfNeededParams {
  actorId: string
  storage: Database
}
export const recordActorIfNeeded = async ({
  actorId,
  storage
}: RecordActorIfNeededParams) => {
  const existingActor = await storage.getActorFromId({
    id: actorId
  })
  // Don't update local actor
  if (existingActor?.privateKey) {
    return existingActor
  }
  if (!existingActor) {
    const profile = await getPublicProfile({
      actorId,
      withPublicKey: true
    })
    if (!profile) return undefined
    return storage.createActor({
      actorId,
      username: profile.username,
      domain: profile.domain,
      followersUrl: profile.endpoints.followers,
      inboxUrl: profile.endpoints.inbox,
      sharedInboxUrl: profile.endpoints.sharedInbox,
      ...(profile.icon ? { iconUrl: profile.icon.url } : {}),
      publicKey: profile.publicKey || '',
      createdAt: profile.createdAt
    })
  }

  const currentTime = Date.now()
  // Update actor if it's older than 30 days
  if (currentTime - existingActor.data.updatedAt > 2_592_000_000) {
    const profile = await getPublicProfile({
      actorId,
      withPublicKey: true
    })
    if (!profile) return undefined
    return storage.updateActor({
      actorId,
      followersUrl: profile.endpoints.followers,
      inboxUrl: profile.endpoints.inbox,
      sharedInboxUrl: profile.endpoints.sharedInbox,
      ...(profile.icon ? { iconUrl: profile.icon.url } : {}),
      publicKey: profile.publicKey || ''
    })
  }
  return existingActor
}
