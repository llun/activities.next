// Pure helpers of the direct conversation domain: conversation ids, the light
// status lookup used to walk reply chains, membership id validation, and the
// (lastStatusCreatedAt, id) ordering the conversation pages are scanned in.
// Timestamps are epoch milliseconds, as the Kysely driver returns them.
import { createHash } from 'crypto'

import type { DirectConversation } from '@/lib/database/domains/conversation/types'
import { Status, StatusType } from '@/lib/types/domain/status'
import { getVisibility } from '@/lib/utils/getVisibility'

// A direct_conversation_memberships row joined with its conversation's root.
export type DirectConversationMembershipRow = {
  id: number
  actorId: string
  conversationId: string
  rootStatusId: string
  lastStatusId: string
  lastStatusCreatedAt: number
  unread: boolean
  readAt: number | null
  hiddenAt: number | null
  createdAt: number | null
  updatedAt: number | null
}

export type DirectConversationStatusRow = {
  conversationId: string
  statusId: string
  createdAt: number
}

export type DirectConversationStatusLookup = {
  id: string
  url: string
  actorId: string
  type: StatusType
  to: string[]
  cc: string[]
  reply: string
}

// One row per recipient of the looked-up status (or one row with null
// recipient columns when it has none).
export type DirectConversationStatusLookupRow = {
  id: string
  url: string | null
  actorId: string | null
  type: string | null
  reply: string | null
  recipientActorId: string | null
  recipientType: string | null
}

const MAX_BIGINT_ID = '9223372036854775807'

export const getConversationIdForRootStatusId = (rootStatusId: string) =>
  createHash('sha256').update(rootStatusId).digest('hex')

export const isDirectStatusLookup = (status: DirectConversationStatusLookup) =>
  status.type !== StatusType.enum.Announce &&
  getVisibility(status.to, status.cc) === 'direct'

export const buildDirectConversationStatusLookup = (
  rows: DirectConversationStatusLookupRow[]
): DirectConversationStatusLookup | null => {
  if (rows.length === 0) return null

  const [status] = rows
  return rows.reduce<DirectConversationStatusLookup>(
    (output, row) => {
      if (row.recipientType === 'to' && row.recipientActorId) {
        output.to.push(row.recipientActorId)
      }
      if (row.recipientType === 'cc' && row.recipientActorId) {
        output.cc.push(row.recipientActorId)
      }
      return output
    },
    {
      id: status.id,
      url: status.url ?? status.id,
      // Nullable in the schema, but every status writer sets it.
      actorId: status.actorId as string,
      // Only Note and Poll rows are looked up (see getStatusByIdOrUrl).
      type: status.type as StatusType,
      to: [],
      cc: [],
      reply: status.reply ?? ''
    }
  )
}

const normalizeMembershipId = (id: string) => {
  if (!/^[0-9]+$/.test(id)) return null

  const normalizedId = id.replace(/^0+/, '')
  if (!normalizedId) return null
  if (normalizedId.length > MAX_BIGINT_ID.length) return null
  if (
    normalizedId.length === MAX_BIGINT_ID.length &&
    normalizedId > MAX_BIGINT_ID
  )
    return null

  return normalizedId
}

// A client-supplied membership id that fits the bigint id column: checked
// before it reaches SQL, where an out-of-range value would fail on PostgreSQL.
export const isValidMembershipId = (id: string) =>
  normalizeMembershipId(id) !== null

const compareMembershipIdsDesc = (
  left: string | number,
  right: string | number
) => {
  const leftId = BigInt(String(left))
  const rightId = BigInt(String(right))

  if (leftId === rightId) return 0
  return leftId > rightId ? -1 : 1
}

type MembershipOrderKey = {
  id: string | number
  lastStatusCreatedAt: number
}

const compareMembershipOrderDesc = (
  left: MembershipOrderKey,
  right: MembershipOrderKey
) => {
  if (left.lastStatusCreatedAt !== right.lastStatusCreatedAt)
    return right.lastStatusCreatedAt - left.lastStatusCreatedAt
  return compareMembershipIdsDesc(left.id, right.id)
}

export const compareConversationOrderDesc = (
  left: Pick<DirectConversation, 'id' | 'lastStatusCreatedAt'>,
  right: Pick<DirectConversation, 'id' | 'lastStatusCreatedAt'>
) => {
  if (left.lastStatusCreatedAt !== right.lastStatusCreatedAt)
    return right.lastStatusCreatedAt - left.lastStatusCreatedAt
  return compareMembershipIdsDesc(left.id, right.id)
}

export const compareConversationToMembershipOrderDesc = (
  conversation: Pick<DirectConversation, 'id' | 'lastStatusCreatedAt'>,
  membership: Pick<
    DirectConversationMembershipRow,
    'id' | 'lastStatusCreatedAt'
  >
) =>
  compareMembershipOrderDesc(
    {
      id: conversation.id,
      lastStatusCreatedAt: conversation.lastStatusCreatedAt
    },
    membership
  )

export const isMembershipOlderThanStatus = (
  membership: Pick<
    DirectConversationMembershipRow,
    'lastStatusCreatedAt' | 'lastStatusId'
  >,
  status: Status
) => {
  if (membership.lastStatusCreatedAt !== status.createdAt)
    return membership.lastStatusCreatedAt < status.createdAt
  return String(membership.lastStatusId) < status.id
}

export const getMembershipReadStateForStatus = ({
  actorId,
  status,
  statusCreatedAt,
  readAt
}: {
  actorId: string
  status: Status
  statusCreatedAt: number
  readAt: number | null
}) => {
  if (actorId === status.actorId)
    return {
      unread: false,
      readAt: readAt && readAt > statusCreatedAt ? readAt : statusCreatedAt
    }

  if (readAt && readAt >= statusCreatedAt)
    return {
      unread: false,
      readAt
    }

  return {
    unread: true,
    readAt
  }
}
