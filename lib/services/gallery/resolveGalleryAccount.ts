import { Database } from '@/lib/database/types'
import {
  GalleryAudience,
  toGalleryAudience
} from '@/lib/services/gallery/galleryAudience'
import { resolveActorIdParam } from '@/lib/services/mastodon/resolveClientId'
import { resolveActorStatusesAudience } from '@/lib/services/statusAccess'
import { Actor } from '@/lib/types/domain/actor'

export interface ResolvedGalleryAccount {
  owner: Actor
  audience: GalleryAudience
}

/**
 * The shared first steps of the account-scoped gallery reads: resolve the id
 * the client sent, require a local actor (galleries exist only for accounts
 * this server hosts), and derive who is looking. Null means "answer 404", and
 * a missing and a remote actor are deliberately indistinguishable.
 */
export const resolveGalleryAccount = async ({
  database,
  encodedAccountId,
  currentActor
}: {
  database: Database
  encodedAccountId: string
  currentActor: Actor | null | undefined
}): Promise<ResolvedGalleryAccount | null> => {
  const id = await resolveActorIdParam(database, encodedAccountId)
  const owner = await database.getActorFromId({ id })
  if (!owner || !owner.account) return null

  const audience = toGalleryAudience(
    await resolveActorStatusesAudience({
      database,
      targetActor: owner,
      currentActor
    })
  )
  return { owner, audience }
}
