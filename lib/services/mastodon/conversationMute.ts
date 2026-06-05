import { Database } from '@/lib/database/types'
import { Status, StatusType } from '@/lib/types/domain/status'

// A defensive cap on how far the reply chain is walked when resolving a thread
// root, so a malformed (e.g. cyclic) chain can never loop forever.
const MAX_THREAD_WALK = 100

/**
 * Resolves the conversation (thread) root status id for a status. This is the
 * key a conversation mute is stored under: muting any status in a thread mutes
 * the whole thread, identified by its root. For an Announce (reblog) the
 * original status's thread is used. The walk follows `in_reply_to` to the
 * topmost ancestor, ignoring readability (mute state is independent of who can
 * read the thread).
 *
 * `cache` (statusId → rootId) memoizes results across a batch render so the
 * shared ancestors of a thread are walked once, not once per reply.
 */
export const resolveConversationRootId = async (
  database: Database,
  status: Status,
  cache?: Map<string, string>
): Promise<string> => {
  const target =
    status.type === StatusType.enum.Announce ? status.originalStatus : status

  const cachedRoot = cache?.get(target.id)
  if (cachedRoot) return cachedRoot

  let rootId = target.id
  let replyId = target.type === StatusType.enum.Announce ? '' : target.reply
  // Every node visited on the way up shares the same thread root, so record
  // them all once the root is known.
  const visited = [target.id]
  const seen = new Set<string>([target.id])

  for (let hops = 0; replyId && hops < MAX_THREAD_WALK; hops++) {
    const cachedParentRoot = cache?.get(replyId)
    if (cachedParentRoot) {
      rootId = cachedParentRoot
      break
    }

    const parent = await database.getStatus({
      statusId: replyId,
      withReplies: false
    })
    if (!parent || seen.has(parent.id)) break
    seen.add(parent.id)
    visited.push(parent.id)
    rootId = parent.id
    replyId = parent.type === StatusType.enum.Announce ? '' : parent.reply
  }

  if (cache) {
    for (const visitedId of visited) cache.set(visitedId, rootId)
  }

  return rootId
}

/**
 * Whether the conversation a status belongs to is muted for the given actor.
 * When `mutedConversationRootIds` is supplied (the batch path), an empty set
 * short-circuits to `false` without resolving the thread root — so the common
 * case (an actor with no conversation mutes) costs nothing per status.
 */
export const isConversationMutedForActor = async (
  database: Database,
  status: Status,
  currentActorId: string | undefined,
  mutedConversationRootIds?: Set<string>,
  conversationRootCache?: Map<string, string>
): Promise<boolean> => {
  if (!currentActorId) return false

  if (mutedConversationRootIds) {
    if (mutedConversationRootIds.size === 0) return false
    const rootId = await resolveConversationRootId(
      database,
      status,
      conversationRootCache
    )
    return mutedConversationRootIds.has(rootId)
  }

  const rootId = await resolveConversationRootId(
    database,
    status,
    conversationRootCache
  )
  return database.isConversationMuted({
    actorId: currentActorId,
    statusId: rootId
  })
}
