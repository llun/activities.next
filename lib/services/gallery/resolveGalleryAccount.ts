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
 * Who is looking at `owner`'s gallery: the owner's own audience, or a viewer
 * scoped by the posts they may read (a follower, a signed-in stranger, or
 * logged out). One answer for every gallery read, whether it comes through an
 * API route or a server-rendered page.
 */
export const resolveGalleryAudience = async ({
  database,
  owner,
  currentActor
}: {
  database: Database
  owner: Actor
  currentActor: Actor | null | undefined
}): Promise<GalleryAudience> =>
  toGalleryAudience(
    await resolveActorStatusesAudience({
      database,
      targetActor: owner,
      currentActor
    })
  )

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

  return {
    owner,
    audience: await resolveGalleryAudience({ database, owner, currentActor })
  }
}
