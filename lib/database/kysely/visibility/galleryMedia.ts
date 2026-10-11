import { type Expression, type SqlBool, expressionBuilder, sql } from 'kysely'

import type { DB, Db } from '@/lib/database/kysely'
import { castToTextOnSqlite } from '@/lib/database/kysely/dialect'
import {
  type StatusIdsSubquery,
  actorVisibleStatusIds
} from '@/lib/database/kysely/visibility/actorVisible'
import type { GalleryAudience } from '@/lib/services/gallery/galleryAudience'
import type { GalleryShow } from '@/lib/types/database/gallery'

// What "gallery media" means, decided in exactly one place and read by every
// gallery query:
//
//   medias.actorId = owner AND medias.inGallery = true
//   AND EXISTS an attachment of that media, written by the owner, on a status
//       of the owner's that the audience may read
//
// so a viewer sees exactly the photos of the posts they could read on the
// profile, a deleted post drops its photos (attachments are deleted with their
// status), and an unposted upload never appears for anyone else. The status
// filter is `actorVisibleStatusIds`, the same subquery the profile's Media tab
// uses, never re-derived here.
//
// The OWNER's view widens the last condition: media the owner added in Gallery
// (`medias.galleryAddedAt` set) is theirs to see even though no post uses it,
// so an owner reads "posted OR added in Gallery". That is the only way a media
// without an attachment is ever in the scope, and it is gated on the owner
// audience alone: every other audience keeps the posted condition, whatever
// `show` says.
//
// The Kysely twin of the Knex `buildGalleryMediaScope`, which stays in
// lib/database/sql/galleryAlbums.ts for the album reads until they are ported
// (with the default options only: no `show`, `requireInGallery` on).
// galleryMediaEquivalence.test.ts runs both over the same rows. Change both
// together.

/** The alias the scope reads `attachments` under. */
export const GALLERY_ATTACHMENTS = 'gallery_attachments'
/** The alias the scope reads `statuses` under. */
export const GALLERY_STATUSES = 'gallery_statuses'

// The tables the scope's conditions name: `medias` of the outer query and the
// two aliases of its attachment probe.
type ScopeDB = DB & {
  gallery_attachments: DB['attachments']
  gallery_statuses: DB['statuses']
}

const scope = expressionBuilder<
  ScopeDB,
  'medias' | 'gallery_attachments' | 'gallery_statuses'
>()

/**
 * The status ids of `actorId` the audience may read, or `null` for the
 * owner's unfiltered view.
 *
 * Fails closed twice over: only `kind: 'owner'` (checked exactly) is
 * unfiltered, and a viewer whose flags are all falsy (which
 * `actorVisibleStatusIds` would answer with `null`, "no filter") is coerced to
 * `publicOnly`.
 */
const galleryVisibleStatusIds = (
  db: Db,
  actorId: string,
  audience: GalleryAudience
): StatusIdsSubquery | null => {
  if (audience?.kind === 'owner') return null

  const viewer = audience?.kind === 'viewer' ? audience : null
  const scoped = actorVisibleStatusIds(db, actorId, {
    publicOnly: viewer?.publicOnly === true,
    visibleToActorId: viewer?.visibleToActorId ?? null,
    includeFollowersOnly: viewer?.includeFollowersOnly === true,
    followersAudience: viewer?.followersAudience ?? null
  })
  if (scoped) return scoped

  const publicOnly = actorVisibleStatusIds(db, actorId, { publicOnly: true })
  // `publicOnly: true` always yields a subquery; refusing here keeps an
  // unexpected change in that builder from ever reading as "no filter".
  if (!publicOnly) {
    throw new Error('Gallery visibility subquery is unexpectedly unfiltered')
  }
  return publicOnly
}

/**
 * Narrows a query over `attachments as gallery_attachments`, joined to
 * `statuses as gallery_statuses` on `gallery_statuses.id =
 * gallery_attachments.statusId`, to attachments the owner wrote on a status of
 * their own that the audience may read.
 *
 * `attachments.actorId = owner` is what keeps another actor's post that points
 * at the owner's media id (any actor can write `attachments.mediaId`) from
 * unlocking it. The join to `statuses` drops an attachment whose status row is
 * gone, even in the owner's unfiltered mode.
 */
export const postedGalleryAttachment = (
  db: Db,
  actorId: string,
  audience: GalleryAudience
): Expression<SqlBool> => {
  const visibleStatusIds = galleryVisibleStatusIds(db, actorId, audience)
  return scope.and([
    scope('gallery_attachments.actorId', '=', actorId),
    scope('gallery_statuses.actorId', '=', actorId),
    scope('gallery_attachments.statusId', 'is not', null),
    scope('gallery_attachments.statusId', '<>', ''),
    ...(visibleStatusIds
      ? [scope('gallery_attachments.statusId', 'in', visibleStatusIds)]
      : [])
  ])
}

/**
 * The `medias.id` side of a `medias` to `attachments.mediaId` comparison: the
 * text form on SQLite, so `attachments_mediaId_idx` stays usable (see
 * `castToTextOnSqlite`). `createAttachment` writes the canonical `String(id)`.
 */
export const galleryMediaIdRef = (db: Db) => castToTextOnSqlite(db, 'medias.id')

export type GalleryMediaScopeOptions = {
  // `false` only for the owner's gear usage, which counts every photo
  // regardless of its gallery switch.
  requireInGallery?: boolean
  // Narrows the owner's view: `all` adds no `inGallery` condition, `hidden`
  // requires it to be false, `not_posted` lists only the media added in
  // Gallery that no post uses. Honoured for the owner audience only; every
  // other audience keeps `inGallery = true` and the posted condition.
  show?: GalleryShow
}

/**
 * The gallery scope, for the `where` of a query over `medias`.
 */
export const galleryMediaScope = (
  db: Db,
  actorId: string,
  audience: GalleryAudience,
  { requireInGallery = true, show }: GalleryMediaScopeOptions = {}
): Expression<SqlBool> => {
  const isOwner = audience?.kind === 'owner'
  const effectiveShow: GalleryShow =
    isOwner && show !== undefined ? show : 'in_gallery'

  const posted = db
    .selectFrom(`attachments as ${GALLERY_ATTACHMENTS}`)
    .innerJoin(
      `statuses as ${GALLERY_STATUSES}`,
      'gallery_statuses.id',
      'gallery_attachments.statusId'
    )
    .select(sql.lit(1).as('one'))
    .where('gallery_attachments.mediaId', '=', galleryMediaIdRef(db))
    .where(postedGalleryAttachment(db, actorId, audience))

  const conditions: Expression<SqlBool>[] = [
    scope('medias.actorId', '=', actorId)
  ]
  // Bound as `true`/`false`; SQLite stores the column as 0/1 and the driver
  // binds 1/0. `not_posted` lists what was added in Gallery whatever its
  // switch.
  if (
    requireInGallery &&
    effectiveShow !== 'all' &&
    effectiveShow !== 'not_posted'
  ) {
    conditions.push(
      scope('medias.inGallery', '=', effectiveShow === 'in_gallery')
    )
  }

  if (!isOwner) {
    conditions.push(scope.exists(posted))
  } else if (effectiveShow === 'not_posted') {
    conditions.push(
      scope('medias.galleryAddedAt', 'is not', null),
      scope.not(scope.exists(posted))
    )
  } else {
    // Posted, or kept in Gallery without a post.
    conditions.push(
      scope.or([
        scope.exists(posted),
        scope('medias.galleryAddedAt', 'is not', null)
      ])
    )
  }
  return scope.and(conditions)
}
