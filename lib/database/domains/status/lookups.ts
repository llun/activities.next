import type {
  GetActorAnnouncedStatusIdParams,
  GetActorStatusFromPathSegmentParams,
  GetStatusFromPublicIdParams,
  GetStatusFromUrlHashParams,
  GetStatusFromUrlParams,
  GetStatusIdByPublicIdParams,
  GetStatusIdsByPublicIdsParams,
  GetStatusPublicIdsParams,
  HasActorAnnouncedStatusParams,
  StatusHydration
} from '@/lib/database/domains/status/types'
import type { Db } from '@/lib/database/kysely'
import { getWhereInBatchSize } from '@/lib/database/kysely/inList'
import {
  resolveIdsByPublicIds,
  resolvePublicIdsByIds
} from '@/lib/database/sql/utils/publicIdLookup'
import { type Status, StatusType } from '@/lib/types/domain/status'
import { getLocalStatusId } from '@/lib/utils/activitypubId'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { isPublicId, toPublicIdLookupKey } from '@/lib/utils/publicId'

// The status lookups by url, url hash, publicId and path segment, and the
// actor's own Announce of a status. Each reads the row (or its id) here and
// hydrates it through the injected hydration (./hydration.ts, bound to the
// same `db` by statusHydrationFor).

export const getStatusFromUrl = async (
  db: Db,
  hydration: StatusHydration,
  { url, currentActorId }: GetStatusFromUrlParams
): Promise<Status | null> => {
  const row = await db
    .selectFrom('statuses')
    .select('id')
    .where('urlHash', '=', getHashFromString(url))
    .where('url', '=', url)
    .limit(1)
    .executeTakeFirst()

  if (row?.id) {
    return hydration.getStatus({ statusId: row.id, currentActorId })
  }

  return null
}

export const getStatusFromUrlHash = async (
  db: Db,
  hydration: StatusHydration,
  { urlHash, actorId, currentActorId }: GetStatusFromUrlHashParams
): Promise<Status | null> => {
  const row = await db
    .selectFrom('statuses')
    .selectAll()
    .where('urlHash', '=', urlHash)
    .$if(Boolean(actorId), (qb) => qb.where('actorId', '=', actorId!))
    .limit(1)
    .executeTakeFirst()
  if (!row) return null

  return hydration.hydrateStatusRow(row, currentActorId)
}

// The lookup parameter is normalized here, at the single choke point every
// resolution site goes through, rather than in each caller — see
// toPublicIdLookupKey.
export const getStatusIdByPublicId = async (
  db: Db,
  { publicId }: GetStatusIdByPublicIdParams
): Promise<string | null> => {
  const row = await db
    .selectFrom('statuses')
    .select('id')
    .where('publicId', '=', toPublicIdLookupKey(publicId))
    .limit(1)
    .executeTakeFirst()
  return row?.id ?? null
}

// Batch counterpart of getStatusIdByPublicId, so a request carrying an array
// of ids costs one query instead of one per id. The returned map is keyed by
// the publicIds as REQUESTED, so callers can zip it back against their input.
export const getStatusIdsByPublicIds = (
  db: Db,
  { publicIds }: GetStatusIdsByPublicIdsParams
): Promise<Map<string, string>> =>
  resolveIdsByPublicIds({
    publicIds,
    batchSize: getWhereInBatchSize(db),
    selectChunk: (lookupKeys) =>
      db
        .selectFrom('statuses')
        .select(['id', 'publicId'])
        .where('publicId', 'in', lookupKeys)
        .$narrowType<{ publicId: string }>()
        .execute()
  })

export const getStatusFromPublicId = async (
  db: Db,
  hydration: StatusHydration,
  { publicId, currentActorId }: GetStatusFromPublicIdParams
): Promise<Status | null> => {
  const row = await db
    .selectFrom('statuses')
    .selectAll()
    .where('publicId', '=', toPublicIdLookupKey(publicId))
    .limit(1)
    .executeTakeFirst()
  if (!row) return null
  return hydration.hydrateStatusRow(row, currentActorId)
}

export const getStatusPublicIds = (
  db: Db,
  { statusIds }: GetStatusPublicIdsParams
): Promise<Map<string, string>> =>
  resolvePublicIdsByIds({
    ids: statusIds,
    batchSize: getWhereInBatchSize(db),
    selectChunk: (ids) =>
      db
        .selectFrom('statuses')
        .select(['id', 'publicId'])
        .where('id', 'in', ids)
        .where('publicId', 'is not', null)
        .$narrowType<{ publicId: string }>()
        .execute()
  })

export const getActorStatusFromPathSegment = async (
  db: Db,
  hydration: StatusHydration,
  { actorId, pathSegment, withReplies }: GetActorStatusFromPathSegmentParams
): Promise<Status | null> => {
  const status = await hydration.getStatus({
    statusId: getLocalStatusId({ actorId, statusId: pathSegment }),
    withReplies
  })
  if (status) return status
  if (!isPublicId(pathSegment)) return null

  const uriFromPublicId = await getStatusIdByPublicId(db, {
    publicId: pathSegment
  })
  if (!uriFromPublicId) return null

  const candidate = await hydration.getStatus({
    statusId: uriFromPublicId,
    withReplies
  })
  // Serve only this actor's own statuses — a publicId belonging to another
  // actor must not resolve under this actor's URL space.
  if (candidate?.actorId !== actorId) return null
  return candidate
}

// The id of `actorId`'s Announce of `originalStatusId`. Status hydration reads
// it for the viewer's own boost of each status it hydrates.
export const getActorAnnouncedStatusId = async (
  db: Db,
  { actorId, originalStatusId }: GetActorAnnouncedStatusIdParams
): Promise<string | null> => {
  const row = await db
    .selectFrom('statuses')
    .select('id')
    .where('type', '=', StatusType.enum.Announce)
    .where('originalStatusId', '=', originalStatusId)
    .where('actorId', '=', actorId)
    .limit(1)
    .executeTakeFirst()
  return row?.id ?? null
}

export const getActorAnnounceStatus = async (
  db: Db,
  hydration: StatusHydration,
  { actorId, statusId }: HasActorAnnouncedStatusParams
): Promise<Status | null> => {
  if (!actorId) return null

  const row = await db
    .selectFrom('statuses')
    .selectAll()
    .where('type', '=', StatusType.enum.Announce)
    .where('originalStatusId', '=', statusId)
    .where('actorId', '=', actorId)
    .limit(1)
    .executeTakeFirst()

  if (!row) return null
  return hydration.hydrateStatusRow(row)
}
