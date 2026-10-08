import type { ActorStatusesAudience } from '@/lib/services/statusAccess'

/**
 * Who a gallery read is for. Every gallery database method takes one as a
 * REQUIRED argument, so the compiler rejects a call that forgets it.
 *
 * `owner` is the only unfiltered audience. A `viewer` is scoped through
 * `buildActorVisibleStatusIdsQuery` exactly as the profile's posts and media
 * are, and a viewer whose flags are all falsy (which that builder would read as
 * "no filter") is coerced to `publicOnly` in the database layer: an audience
 * that names nobody fails closed, never open.
 */
export type GalleryAudience =
  | { kind: 'owner' }
  | {
      kind: 'viewer'
      publicOnly: boolean
      visibleToActorId: string | null
      includeFollowersOnly: boolean
      followersAudience: string | null
    }

export const OWNER_GALLERY_AUDIENCE: GalleryAudience = { kind: 'owner' }

/**
 * The logged-out audience. Also what the owner's "preview public map" runs
 * under, so the preview is the real public rows, not owner rows re-projected.
 */
export const PUBLIC_GALLERY_AUDIENCE: GalleryAudience = {
  kind: 'viewer',
  publicOnly: true,
  visibleToActorId: null,
  includeFollowersOnly: false,
  followersAudience: null
}

export const toGalleryAudience = (
  audience: ActorStatusesAudience
): GalleryAudience =>
  audience.isOwner
    ? OWNER_GALLERY_AUDIENCE
    : {
        kind: 'viewer',
        publicOnly: audience.publicOnly,
        visibleToActorId: audience.visibleToActorId,
        includeFollowersOnly: audience.includeFollowersOnly,
        followersAudience: audience.followersAudience
      }

/** Owner only by an exact match; anything else is a viewer. */
export const isOwnerGalleryAudience = (
  audience: GalleryAudience | null | undefined
): boolean => audience?.kind === 'owner'
