import { type ExpressionBuilder, sql } from 'kysely'

import { PER_PAGE_LIMIT } from '@/lib/database/constants'
import {
  type ConversationStatusSource,
  getStatusesByIdVisibleToActor,
  hydrateConversationRows,
  statusKeyset
} from '@/lib/database/domains/conversation/hydrate'
import {
  type DirectConversationMembershipRow,
  type DirectConversationStatusRow,
  compareConversationOrderDesc,
  compareConversationToMembershipOrderDesc,
  isValidMembershipId
} from '@/lib/database/domains/conversation/ordering'
import type {
  DirectConversation,
  GetDirectConversationParams,
  GetDirectConversationStatusesParams,
  GetDirectConversationsParams,
  HideDirectConversationParams,
  MarkDirectConversationReadParams
} from '@/lib/database/domains/conversation/types'
import { type DB, type Db, inTransaction } from '@/lib/database/kysely'
import { forUpdate, timestampValue } from '@/lib/database/kysely/dialect'
import { pastKeyset } from '@/lib/database/kysely/keyset'
import type { Status } from '@/lib/types/domain/status'

const MAX_DIRECT_CONVERSATION_PAGE_SCAN_BATCHES = 20
const MAX_DIRECT_CONVERSATION_STATUS_SCAN_BATCHES = 20

// A membership id from the client, already checked by isValidMembershipId. It
// is bound as the string it arrived as, so an id past 2^53 keeps every digit;
// both backends compare it to the bigint column as a number.
const membershipIdValue = (id: string) => sql<number>`${id}`

// Memberships strictly older than `cursor` in (lastStatusCreatedAt, id) order.
const olderThanMembership = (
  eb: ExpressionBuilder<
    DB,
    'direct_conversation_memberships' | 'direct_conversations'
  >,
  cursor: DirectConversationMembershipRow
) => {
  const lastStatusCreatedAt = timestampValue(cursor.lastStatusCreatedAt)
  return eb.or([
    eb(
      'direct_conversation_memberships.lastStatusCreatedAt',
      '<',
      lastStatusCreatedAt
    ),
    eb.and([
      eb(
        'direct_conversation_memberships.lastStatusCreatedAt',
        '=',
        lastStatusCreatedAt
      ),
      eb('direct_conversation_memberships.id', '<', cursor.id)
    ])
  ])
}

const buildConversationQuery = (
  db: Db,
  {
    actorId,
    includeHidden = false
  }: Pick<GetDirectConversationParams, 'actorId' | 'includeHidden'>
) =>
  db
    .selectFrom('direct_conversation_memberships')
    .innerJoin(
      'direct_conversations',
      'direct_conversation_memberships.conversationId',
      'direct_conversations.id'
    )
    .where('direct_conversation_memberships.actorId', '=', actorId)
    .select([
      'direct_conversation_memberships.id',
      'direct_conversation_memberships.actorId',
      'direct_conversation_memberships.conversationId',
      'direct_conversations.rootStatusId',
      'direct_conversation_memberships.lastStatusId',
      'direct_conversation_memberships.lastStatusCreatedAt',
      'direct_conversation_memberships.unread',
      'direct_conversation_memberships.readAt',
      'direct_conversation_memberships.hiddenAt',
      'direct_conversation_memberships.createdAt',
      'direct_conversation_memberships.updatedAt'
    ])
    .$if(!includeHidden, (qb) =>
      qb.where('direct_conversation_memberships.hiddenAt', 'is', null)
    )

type ConversationQuery = ReturnType<typeof buildConversationQuery>

const getDirectConversationByMembershipId = async (
  db: Db,
  statuses: ConversationStatusSource,
  { actorId, conversationId, includeHidden }: GetDirectConversationParams
) => {
  if (!isValidMembershipId(conversationId)) return null

  const row = await buildConversationQuery(db, { actorId, includeHidden })
    .where(
      'direct_conversation_memberships.id',
      '=',
      membershipIdValue(conversationId)
    )
    .limit(1)
    .executeTakeFirst()
  if (!row) return null
  const [conversation] = await hydrateConversationRows(
    db,
    statuses,
    [row],
    actorId
  )
  return conversation ?? null
}

// Scans memberships newest first, in batches, until `limit` hydratable
// conversations sit strictly between the cursors. Hydration can move a row
// back in the order (its last status falls back to an older one), so a page
// is sorted again after each batch and the scan only stops once the batch
// boundary is past the page's last conversation.
const getHydratedConversationPage = async (
  db: Db,
  statuses: ConversationStatusSource,
  {
    actorId,
    query,
    limit,
    olderThan,
    newerThan
  }: {
    actorId: string
    query: ConversationQuery
    limit: number
    olderThan: DirectConversation | null
    newerThan: DirectConversation | null
  }
) => {
  if (limit <= 0) return []

  const conversations: DirectConversation[] = []
  const scanBatchSize = Math.max(limit, PER_PAGE_LIMIT)
  let scannedCursor: DirectConversationMembershipRow | null = null

  for (
    let batchIndex = 0;
    batchIndex < MAX_DIRECT_CONVERSATION_PAGE_SCAN_BATCHES &&
    (conversations.length < limit || scannedCursor);
    batchIndex += 1
  ) {
    const cursor = scannedCursor
    const scanQuery = cursor
      ? query.where((eb) => olderThanMembership(eb, cursor))
      : query
    const rows: DirectConversationMembershipRow[] = await scanQuery
      .orderBy('direct_conversation_memberships.lastStatusCreatedAt', 'desc')
      .orderBy('direct_conversation_memberships.id', 'desc')
      .limit(scanBatchSize)
      .execute()
    if (rows.length === 0) break
    const scanBoundary = { ...rows[rows.length - 1] }

    const hydratedRows = await hydrateConversationRows(
      db,
      statuses,
      rows,
      actorId
    )
    conversations.push(
      ...hydratedRows.filter((conversation) => {
        if (
          olderThan &&
          compareConversationOrderDesc(conversation, olderThan) <= 0
        )
          return false
        if (
          newerThan &&
          compareConversationOrderDesc(conversation, newerThan) >= 0
        )
          return false
        return true
      })
    )
    conversations.sort(compareConversationOrderDesc)
    conversations.splice(limit)

    if (rows.length < scanBatchSize) break
    if (
      conversations.length === limit &&
      compareConversationToMembershipOrderDesc(
        conversations[conversations.length - 1],
        scanBoundary
      ) <= 0
    )
      break
    if (
      newerThan &&
      compareConversationToMembershipOrderDesc(newerThan, scanBoundary) <= 0
    )
      break

    scannedCursor = scanBoundary
  }

  return conversations
}

export const getDirectConversations = async (
  db: Db,
  statuses: ConversationStatusSource,
  {
    actorId,
    limit = PER_PAGE_LIMIT,
    maxId,
    minId
  }: GetDirectConversationsParams
): Promise<DirectConversation[]> => {
  const query = buildConversationQuery(db, { actorId })
  const olderCursorId = maxId
  const newerCursorId = minId

  if (
    (olderCursorId && !isValidMembershipId(olderCursorId)) ||
    (newerCursorId && !isValidMembershipId(newerCursorId))
  )
    return []

  // A cursor is a visible conversation of the same actor; anything else
  // (hidden, another actor's, unknown) gives an empty page.
  const olderThan = olderCursorId
    ? await getDirectConversationByMembershipId(db, statuses, {
        actorId,
        conversationId: olderCursorId
      })
    : null
  if (olderCursorId && !olderThan) return []

  const newerThan = newerCursorId
    ? await getDirectConversationByMembershipId(db, statuses, {
        actorId,
        conversationId: newerCursorId
      })
    : null
  if (newerCursorId && !newerThan) return []

  return getHydratedConversationPage(db, statuses, {
    actorId,
    query,
    limit,
    olderThan,
    newerThan
  })
}

export const getDirectConversation = (
  db: Db,
  statuses: ConversationStatusSource,
  params: GetDirectConversationParams
): Promise<DirectConversation | null> =>
  getDirectConversationByMembershipId(db, statuses, params)

export const markDirectConversationRead = async (
  db: Db,
  statuses: ConversationStatusSource,
  { actorId, conversationId }: MarkDirectConversationReadParams
): Promise<DirectConversation | null> => {
  if (!isValidMembershipId(conversationId)) return null

  // Lock the membership row so a concurrent status sync cannot interleave
  // between the read and the update and have its unread flag overwritten.
  const updated = await inTransaction(db, async (trx) => {
    const row = await forUpdate(
      trx,
      trx
        .selectFrom('direct_conversation_memberships')
        .select('id')
        .where('id', '=', membershipIdValue(conversationId))
        .where('actorId', '=', actorId)
        .where('hiddenAt', 'is', null)
        .limit(1)
    ).executeTakeFirst()
    if (!row) return false

    const currentTime = new Date()
    await trx
      .updateTable('direct_conversation_memberships')
      .set({
        unread: false,
        readAt: currentTime,
        updatedAt: currentTime
      })
      .where('id', '=', row.id)
      .execute()
    return true
  })

  if (!updated) return null

  return getDirectConversationByMembershipId(db, statuses, {
    actorId,
    conversationId
  })
}

export const hideDirectConversation = async (
  db: Db,
  { actorId, conversationId }: HideDirectConversationParams
): Promise<void> => {
  if (!isValidMembershipId(conversationId)) return

  await db
    .updateTable('direct_conversation_memberships')
    .set({
      hiddenAt: new Date(),
      unread: false,
      updatedAt: new Date()
    })
    .where('actorId', '=', actorId)
    .where('id', '=', membershipIdValue(conversationId))
    .execute()
}

// The conversation's statuses the actor can see, newest first, scanning past
// the ones they cannot until the page is full.
export const getDirectConversationStatuses = async (
  db: Db,
  statuses: ConversationStatusSource,
  {
    actorId,
    conversationId,
    limit = PER_PAGE_LIMIT,
    maxStatusId,
    minStatusId
  }: GetDirectConversationStatusesParams
): Promise<Status[]> => {
  if (!isValidMembershipId(conversationId)) return []

  const conversation = await getDirectConversationByMembershipId(db, statuses, {
    actorId,
    conversationId
  })
  if (!conversation) return []

  // A cursor is a status of the same conversation; anything else gives an
  // empty page.
  const getStatusCursor = (statusId: string) =>
    db
      .selectFrom('direct_conversation_statuses')
      .select(['conversationId', 'statusId', 'createdAt'])
      .where('conversationId', '=', conversation.conversationId)
      .where('statusId', '=', statusId)
      .limit(1)
      .executeTakeFirst()

  let query = db
    .selectFrom('direct_conversation_statuses')
    .select(['conversationId', 'statusId', 'createdAt'])
    .where('conversationId', '=', conversation.conversationId)

  if (maxStatusId) {
    const cursor = await getStatusCursor(maxStatusId)
    if (!cursor) return []
    query = query.where((eb) =>
      pastKeyset(eb, statusKeyset(cursor), '<', 'statusId')
    )
  }

  if (minStatusId) {
    const cursor = await getStatusCursor(minStatusId)
    if (!cursor) return []
    query = query.where((eb) =>
      pastKeyset(eb, statusKeyset(cursor), '>', 'statusId')
    )
  }

  if (limit <= 0) return []

  const page: Status[] = []
  const scanBatchSize = Math.max(limit, PER_PAGE_LIMIT)
  let scannedCursor: DirectConversationStatusRow | null = null

  for (
    let batchIndex = 0;
    batchIndex < MAX_DIRECT_CONVERSATION_STATUS_SCAN_BATCHES &&
    page.length < limit;
    batchIndex += 1
  ) {
    const cursor = scannedCursor
    const scanQuery = cursor
      ? query.where((eb) =>
          pastKeyset(eb, statusKeyset(cursor), '<', 'statusId')
        )
      : query
    const rows: DirectConversationStatusRow[] = await scanQuery
      .orderBy('createdAt', 'desc')
      .orderBy('statusId', 'desc')
      .limit(scanBatchSize)
      .execute()
    if (rows.length === 0) break

    const statusById = await getStatusesByIdVisibleToActor(
      statuses,
      rows.map((row) => row.statusId),
      actorId
    )

    for (const row of rows) {
      const status = statusById.get(row.statusId)
      if (!status) continue

      page.push(status)
      if (page.length === limit) break
    }

    if (page.length === limit || rows.length < scanBatchSize) break
    scannedCursor = rows[rows.length - 1]
  }

  return page
}
