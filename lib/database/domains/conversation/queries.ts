import {
  getDirectConversation,
  getDirectConversationStatuses,
  getDirectConversations,
  hideDirectConversation,
  markDirectConversationRead
} from '@/lib/database/domains/conversation/conversations'
import type { ConversationStatusSource } from '@/lib/database/domains/conversation/hydrate'
import { syncDirectConversationForStatus } from '@/lib/database/domains/conversation/sync'
import type {
  GetDirectConversationParams,
  GetDirectConversationStatusesParams,
  GetDirectConversationsParams,
  MarkDirectConversationReadParams
} from '@/lib/database/domains/conversation/types'
import type { Db } from '@/lib/database/kysely'

export type { ConversationStatusSource } from '@/lib/database/domains/conversation/hydrate'

/**
 * The direct conversation facade methods as `(db, params)` queries. The reads
 * hydrate statuses through `statuses` (the status facade's getStatusesByIds,
 * injected until status is ported), always outside a transaction; the writes
 * do not need it.
 */
export const createConversationQueries = (
  statuses: ConversationStatusSource
) => ({
  syncDirectConversationForStatus,
  getDirectConversations: (db: Db, params: GetDirectConversationsParams) =>
    getDirectConversations(db, statuses, params),
  getDirectConversation: (db: Db, params: GetDirectConversationParams) =>
    getDirectConversation(db, statuses, params),
  markDirectConversationRead: (
    db: Db,
    params: MarkDirectConversationReadParams
  ) => markDirectConversationRead(db, statuses, params),
  hideDirectConversation,
  getDirectConversationStatuses: (
    db: Db,
    params: GetDirectConversationStatusesParams
  ) => getDirectConversationStatuses(db, statuses, params)
})
