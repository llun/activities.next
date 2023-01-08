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
    if (!profile) return
    await storage.createActor({
      actorId: profile.id,
      username: profile.username,
      domain: profile.domain,
      followersUrl: profile.endpoints.followers,
      publicKey: profile.publicKey || '',
      createdAt: profile.createdAt
    })
  }
}
