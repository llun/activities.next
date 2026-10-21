import { getActorFromId } from '@/lib/database/domains/actor/lookups'
import { getIdempotencyKey } from '@/lib/database/domains/idempotency/queries'
import {
  IdempotencyConflictError,
  IdempotencyDeletedError
} from '@/lib/database/domains/idempotency/types'
import { incrementLocalStatusBucket } from '@/lib/database/domains/instanceActivity/queries'
import {
  type StatusSearchRow,
  indexStatusSearchDocument
} from '@/lib/database/domains/search/statuses'
import { recoverFromDuplicateInsert } from '@/lib/database/domains/status/recoverFromDuplicateInsert'
import {
  getOriginalStatusIdFromAnnounceContent,
  getStatusActorProfile
} from '@/lib/database/domains/status/rows'
import { isPubliclyAddressed } from '@/lib/database/domains/status/status'
import type {
  CreateAnnounceParams,
  CreateNoteParams,
  CreatePollParams,
  CreateStatusResult,
  StatusHydration
} from '@/lib/database/domains/status/types'
import { type Db, inTransaction } from '@/lib/database/kysely'
import { increaseCounterValue } from '@/lib/database/kysely/counter'
import { incrementBucket } from '@/lib/database/kysely/counterBucket'
import { timestampValue } from '@/lib/database/kysely/dialect'
import { CounterKey } from '@/lib/database/utils/counter'
import {
  type Status,
  StatusAnnounce,
  StatusNote,
  StatusPoll,
  StatusType
} from '@/lib/types/domain/status'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { getVisibility } from '@/lib/utils/getVisibility'
import { generatePublicId } from '@/lib/utils/publicId'

// The status creates: notes, polls and boosts. Each writes the status row,
// its counters and its recipients (and a poll its choices) in one transaction,
// then indexes it for search and reads its author outside it. A create that
// loses a race on the status id to a concurrent delivery of the same object
// returns the winner's status, hydrated through the injected hydration
// (./hydration.ts) after the failed transaction (recoverFromDuplicateInsert).
// The edits are in ./edits.ts.

// The status a reply points at: by id first, then by url.
export const resolveParentStatusIdByReply = async (
  db: Db,
  reply: string
): Promise<string | null> => {
  if (!reply) return null

  const byId = await db
    .selectFrom('statuses')
    .select('id')
    .where('id', '=', reply)
    .limit(1)
    .executeTakeFirst()
  if (byId?.id) return byId.id

  const byUrl = await db
    .selectFrom('statuses')
    .select('id')
    .where('urlHash', '=', getHashFromString(reply))
    .where('url', '=', reply)
    .limit(1)
    .executeTakeFirst()
  if (byUrl?.id) return byUrl.id

  return null
}

// The counters a new status moves, inside its create's transaction: the
// author's and the service's status totals and hour bucket, the author's
// `lastStatusAt`, the local post total and bucket for a local author, the
// boosted status's reblog total and the parent's reply total. Deletion moves
// them back with its own batched adjustments (./deletion.ts).
const updateStatusCounters = async (
  trx: Db,
  {
    actorId,
    type,
    reply,
    content,
    currentTime,
    statusCreatedAt,
    audience
  }: {
    actorId: string
    type: StatusType
    reply: string
    // The status content: the boosted status id for an Announce.
    content: unknown
    currentTime: Date
    // The new status's own createdAt (may be backdated for federated/imported
    // statuses), used to advance the actor's persisted `lastStatusAt`.
    statusCreatedAt: Date
    // The new status's recipients. Only a public or unlisted reply moves the
    // parent's reply counter, which anonymous surfaces serve as
    // `replies_count` (Mastodon counts only distributable replies), and a
    // direct status does not advance `lastStatusAt` (Mastodon parity), so
    // neither is observable through a count or a timestamp.
    audience: { to: string[]; cc: string[] }
  }
) => {
  await increaseCounterValue(
    trx,
    CounterKey.totalStatus(actorId),
    1,
    currentTime
  )
  await increaseCounterValue(
    trx,
    CounterKey.serviceTotalStatuses(),
    1,
    currentTime
  )
  await incrementBucket(trx, 'statuses', 1, currentTime)
  if (getVisibility(audience.to, audience.cc) !== 'direct') {
    // Advance the actor's persisted last-status timestamp. Guarded set-if-newer
    // (keyed on the status createdAt, not currentTime) so a backdated or
    // out-of-order insert never lowers a more recent value. Direct statuses
    // are skipped: `lastStatusAt` is served as the account's public
    // `last_status_at` and directory order, and would otherwise date a
    // direct message to anyone.
    await trx
      .updateTable('actors')
      .set({ lastStatusAt: statusCreatedAt })
      .where('id', '=', actorId)
      .where((eb) =>
        eb.or([
          eb('lastStatusAt', 'is', null),
          eb('lastStatusAt', '<', timestampValue(statusCreatedAt))
        ])
      )
      .execute()
  }

  const actor = await trx
    .selectFrom('actors')
    .select('accountId')
    .where('id', '=', actorId)
    .limit(1)
    .executeTakeFirst()
  if (actor?.accountId) {
    await increaseCounterValue(
      trx,
      CounterKey.nodeinfoLocalPosts(),
      1,
      currentTime
    )
    await incrementLocalStatusBucket(trx, currentTime)
  }

  if (type === StatusType.enum.Announce) {
    const originalStatusId = getOriginalStatusIdFromAnnounceContent(content)
    if (originalStatusId) {
      await increaseCounterValue(
        trx,
        CounterKey.totalReblog(originalStatusId),
        1,
        currentTime
      )
    }
  }

  if (reply && isPubliclyAddressed(audience)) {
    const parentStatusId = await resolveParentStatusIdByReply(trx, reply)
    if (parentStatusId) {
      await increaseCounterValue(
        trx,
        CounterKey.totalReply(parentStatusId),
        1,
        currentTime
      )
    }
  }
}

// One `recipients` row per addressee, the `to` ones first, one statement each.
export const insertStatusRecipients = async (
  trx: Db,
  {
    statusId,
    to,
    cc,
    currentTime
  }: { statusId: string; to: string[]; cc: string[]; currentTime: Date }
) => {
  for (const [type, actorIds] of [
    ['to', to],
    ['cc', cc]
  ] as const) {
    for (const actorId of actorIds) {
      await trx
        .insertInto('recipients')
        .values({
          id: crypto.randomUUID(),
          statusId,
          actorId,
          type,
          createdAt: currentTime,
          updatedAt: currentTime
        })
        .execute()
    }
  }
}

// Resolves the winner's status after a unique constraint violation on either
// `statuses.id` or `idempotency_keys(actorId, key)`.
const resolveDuplicateStatus = async (
  db: Db,
  hydration: StatusHydration,
  {
    id,
    actorId,
    idempotency
  }: {
    id: string
    actorId: string
    idempotency?: { key: string; contentHash: string }
  }
): Promise<Status | null> => {
  const byId = await hydration.getStatus({ statusId: id, withReplies: false })
  if (byId) return byId
  if (!idempotency) return null

  const existingKey = await getIdempotencyKey(db, {
    actorId,
    key: idempotency.key
  })
  if (!existingKey) return null
  if (
    existingKey.contentHash !== null &&
    existingKey.contentHash !== idempotency.contentHash
  ) {
    throw new IdempotencyConflictError()
  }
  const existingStatus = await hydration.getStatus({
    statusId: existingKey.statusId,
    withReplies: false
  })
  if (!existingStatus) {
    // A discard that committed after the key was read removes the key too:
    // that is a create to retry, not a deleted post.
    const currentKey = await getIdempotencyKey(db, {
      actorId,
      key: idempotency.key
    })
    if (currentKey?.statusId === existingKey.statusId) {
      throw new IdempotencyDeletedError(existingKey.statusId)
    }
    return null
  }
  return existingStatus
}

// Claims the Idempotency-Key for a create inside its transaction. A unique
// violation (the key or the status id already exists) is thrown to the caller's
// `recoverFromDuplicateInsert`, which resolves the winner.
const insertIdempotencyClaim = async (
  trx: Db,
  {
    actorId,
    id,
    idempotency,
    currentTime
  }: {
    actorId: string
    id: string
    idempotency: { key: string; contentHash: string }
    currentTime: Date
  }
): Promise<void> => {
  await trx
    .insertInto('idempotency_keys')
    .values({
      actorId,
      key: idempotency.key,
      statusId: id,
      contentHash: idempotency.contentHash,
      // The create's own publish moves it to 'publishing', then
      // 'complete' or 'publish_failed'.
      state: 'pending',
      // The claim time, not the (possibly backdated) status time, so
      // the key's TTL runs from when the request was made.
      createdAt: currentTime
    })
    .execute()
}

export const createNoteWithResult = async (
  db: Db,
  hydration: StatusHydration,
  {
    id,
    url,
    actorId,
    text,
    summary = '',
    to,
    cc,
    reply = '',
    sensitive = false,
    language = null,
    quoteApprovalPolicy,
    applicationName = null,
    applicationWebsite = null,
    createdAt,
    publicId,
    idempotency
  }: CreateNoteParams
): Promise<CreateStatusResult> => {
  const currentTime = new Date()
  const statusCreatedAt = createdAt ? new Date(createdAt) : currentTime
  const statusPublicId = publicId ?? generatePublicId(statusCreatedAt.getTime())
  const statusUpdatedAt = currentTime
  const content = {
    url,
    text,
    summary,
    sensitive,
    language,
    // Persisted in the blob (no column). JSON.stringify drops it when
    // undefined, so non-quotable-policy statuses store nothing extra.
    ...(quoteApprovalPolicy ? { quoteApprovalPolicy } : {})
  }
  const statusContent = JSON.stringify(content)
  const searchStatus: StatusSearchRow = {
    id,
    actorId,
    type: StatusType.enum.Note,
    content: statusContent,
    createdAt: statusCreatedAt
  }

  const outcome = await recoverFromDuplicateInsert({
    insert: () =>
      inTransaction(db, async (trx) => {
        if (idempotency) {
          await insertIdempotencyClaim(trx, {
            actorId,
            id,
            idempotency,
            currentTime
          })
        }
        await trx
          .insertInto('statuses')
          .values({
            id,
            publicId: statusPublicId,
            url,
            urlHash: getHashFromString(url),
            actorId,
            type: StatusType.enum.Note,
            content: statusContent,
            applicationName,
            applicationWebsite,
            reply,
            replyHash: reply ? getHashFromString(reply) : null,
            createdAt: statusCreatedAt,
            updatedAt: statusUpdatedAt
          })
          .execute()
        await updateStatusCounters(trx, {
          actorId,
          type: StatusType.enum.Note,
          reply,
          content,
          currentTime,
          statusCreatedAt,
          audience: { to, cc }
        })
        await insertStatusRecipients(trx, {
          statusId: id,
          to,
          cc,
          currentTime: statusUpdatedAt
        })
      }),
    getExisting: () =>
      resolveDuplicateStatus(db, hydration, { id, actorId, idempotency })
  })
  if (outcome.recovered) {
    // A concurrent delivery of the same note won the unique key; return its
    // row with isNew=false so the caller skips its side effects.
    return { status: outcome.existing, isNew: false }
  }

  await indexStatusSearchDocument(db, { status: searchStatus })

  const actor = await getActorFromId(db, { id: actorId })
  const status = StatusNote.parse({
    id,
    publicId: statusPublicId,
    url,
    actorId,
    actor: actor ? getStatusActorProfile(actor) : null,
    type: StatusType.enum.Note,
    text,
    summary,
    sensitive,
    language,
    ...(quoteApprovalPolicy ? { quoteApprovalPolicy } : {}),
    // Content detection runs after this insert (in the actions/jobs layer
    // that called createNote), so the row this function just wrote has no
    // detected language yet — matches what a hydrated re-fetch would show
    // at this same instant.
    detectedLanguage: null,
    applicationName,
    applicationWebsite,
    reply,
    to,
    cc,
    edits: [],
    attachments: [],
    tags: [],
    replies: [],
    totalLikes: 0,
    // A status this instance just created has no reactions yet; declare it so
    // the freshly-created shape matches the hydrated one.
    reactions: [],
    isActorLiked: false,
    isActorBookmarked: false,
    actorAnnounceStatusId: null,
    isLocalActor: Boolean(actor?.account),
    createdAt: statusCreatedAt.getTime(),
    updatedAt: statusUpdatedAt.getTime()
  })
  return { status, isNew: true }
}

export const createNote = async (
  db: Db,
  hydration: StatusHydration,
  params: CreateNoteParams
): Promise<Status> => (await createNoteWithResult(db, hydration, params)).status

// Boosts `originalStatusId`, which must exist. The boost row stores the
// original's id in both `content` and `originalStatusId`.
export const createAnnounce = async (
  db: Db,
  hydration: StatusHydration,
  {
    id,
    actorId,
    to,
    cc,
    originalStatusId,
    createdAt,
    publicId
  }: CreateAnnounceParams
): Promise<Status | null> => {
  const existingOriginal = await hydration.getStatus({
    statusId: originalStatusId
  })
  if (!existingOriginal) {
    return null
  }

  const currentTime = new Date()
  const statusCreatedAt = createdAt ? new Date(createdAt) : currentTime
  const statusPublicId = publicId ?? generatePublicId(statusCreatedAt.getTime())
  const statusUpdatedAt = currentTime

  const outcome = await recoverFromDuplicateInsert({
    insert: () =>
      inTransaction(db, async (trx) => {
        await trx
          .insertInto('statuses')
          .values({
            id,
            publicId: statusPublicId,
            url: null,
            urlHash: null,
            actorId,
            type: StatusType.enum.Announce,
            reply: '',
            replyHash: null,
            content: originalStatusId,
            originalStatusId,
            createdAt: statusCreatedAt,
            updatedAt: statusUpdatedAt
          })
          .execute()
        await updateStatusCounters(trx, {
          actorId,
          type: StatusType.enum.Announce,
          reply: '',
          content: originalStatusId,
          currentTime,
          statusCreatedAt,
          audience: { to, cc }
        })
        await insertStatusRecipients(trx, {
          statusId: id,
          to,
          cc,
          currentTime: statusUpdatedAt
        })
      }),
    getExisting: () => hydration.getStatus({ statusId: id, withReplies: false })
  })
  if (outcome.recovered) {
    return outcome.existing
  }

  const [originalStatus, actor] = await Promise.all([
    hydration.getStatus({ statusId: originalStatusId }),
    getActorFromId(db, { id: actorId })
  ])
  if (!originalStatus) {
    return null
  }
  return StatusAnnounce.parse({
    id,
    publicId: statusPublicId,
    actorId,
    actor: actor ? getStatusActorProfile(actor) : null,
    to,
    cc,
    edits: [],
    type: StatusType.enum.Announce,
    originalStatus: originalStatus as StatusNote,

    isLocalActor: Boolean(actor?.account),
    createdAt: statusUpdatedAt.getTime(),
    updatedAt: statusUpdatedAt.getTime()
  })
}

export const createPollWithResult = async (
  db: Db,
  hydration: StatusHydration,
  {
    id,
    url,
    actorId,
    text,
    summary = '',
    to,
    cc,
    reply = '',
    endAt,
    choices,
    pollType = 'oneOf',
    hideTotals = false,
    sensitive = false,
    language = null,
    applicationName = null,
    applicationWebsite = null,
    createdAt,
    publicId,
    idempotency
  }: CreatePollParams
): Promise<CreateStatusResult> => {
  const currentTime = new Date()
  const statusCreatedAt = createdAt ? new Date(createdAt) : currentTime
  const statusPublicId = publicId ?? generatePublicId(statusCreatedAt.getTime())
  const statusUpdatedAt = currentTime
  const content = {
    url,
    text,
    summary,
    sensitive,
    language,
    endAt,
    pollType,
    hideTotals
  }
  const statusContent = JSON.stringify(content)
  const searchStatus: StatusSearchRow = {
    id,
    actorId,
    type: StatusType.enum.Poll,
    content: statusContent,
    createdAt: statusCreatedAt
  }

  const outcome = await recoverFromDuplicateInsert({
    insert: () =>
      inTransaction(db, async (trx) => {
        if (idempotency) {
          await insertIdempotencyClaim(trx, {
            actorId,
            id,
            idempotency,
            currentTime
          })
        }
        await trx
          .insertInto('statuses')
          .values({
            id,
            publicId: statusPublicId,
            url,
            urlHash: getHashFromString(url),
            actorId,
            type: StatusType.enum.Poll,
            content: statusContent,
            applicationName,
            applicationWebsite,
            reply,
            replyHash: reply ? getHashFromString(reply) : null,
            createdAt: statusCreatedAt,
            updatedAt: statusUpdatedAt
          })
          .execute()
        await updateStatusCounters(trx, {
          actorId,
          type: StatusType.enum.Poll,
          reply,
          content,
          currentTime,
          statusCreatedAt,
          audience: { to, cc }
        })
        // One statement per choice, in order: choiceId follows the insert
        // order, and hydration lists the choices by choiceId.
        for (const choice of choices) {
          await trx
            .insertInto('poll_choices')
            .values({
              statusId: id,
              title: typeof choice === 'string' ? choice : choice.title,
              totalVotes:
                typeof choice === 'string' ? 0 : (choice.totalVotes ?? 0),
              createdAt: statusUpdatedAt,
              updatedAt: statusUpdatedAt
            })
            .execute()
        }
        await insertStatusRecipients(trx, {
          statusId: id,
          to,
          cc,
          currentTime: statusUpdatedAt
        })
      }),
    getExisting: () =>
      resolveDuplicateStatus(db, hydration, { id, actorId, idempotency })
  })
  if (outcome.recovered) {
    // A concurrent delivery of the same poll won the unique key; return its
    // row with isNew=false so the caller skips its side effects.
    return { status: outcome.existing, isNew: false }
  }

  await indexStatusSearchDocument(db, { status: searchStatus })

  const actor = await getActorFromId(db, { id: actorId })
  const status = StatusPoll.parse({
    id,
    publicId: statusPublicId,
    url,
    actorId,
    actor: actor ? getStatusActorProfile(actor) : null,
    type: StatusType.enum.Poll,
    text,
    summary,
    sensitive,
    language,
    // Content detection runs after this insert (in the actions/jobs layer
    // that called createPoll), so the row this function just wrote has no
    // detected language yet — matches what a hydrated re-fetch would show
    // at this same instant.
    detectedLanguage: null,
    applicationName,
    applicationWebsite,
    reply,
    to,
    cc,
    edits: [],
    attachments: [],
    tags: [],
    replies: [],
    choices: [],
    totalLikes: 0,
    // A status this instance just created has no reactions yet; declare it so
    // the freshly-created shape matches the hydrated one.
    reactions: [],
    isActorLiked: false,
    isActorBookmarked: false,
    actorAnnounceStatusId: null,
    endAt,
    pollType,
    hideTotals,
    isLocalActor: Boolean(actor?.account),
    createdAt: statusCreatedAt.getTime(),
    updatedAt: statusUpdatedAt.getTime()
  })
  return { status, isNew: true }
}

export const createPoll = async (
  db: Db,
  hydration: StatusHydration,
  params: CreatePollParams
): Promise<Status> => (await createPollWithResult(db, hydration, params)).status
