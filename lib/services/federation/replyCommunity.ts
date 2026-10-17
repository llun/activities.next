import type { StatusThreadStep } from '@/lib/database/domains/status/types'
import { Database } from '@/lib/database/types'
import { Status, getOriginalStatus } from '@/lib/types/domain/status'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
} from '@/lib/utils/activitystream'
import { MastodonVisibility, getVisibility } from '@/lib/utils/getVisibility'

const isActorAddress = (id: string) =>
  id !== ACTIVITY_STREAM_PUBLIC &&
  id !== ACTIVITY_STREAM_PUBLIC_COMPACT &&
  !id.endsWith('/followers')

const MAX_THREAD_DEPTH = 20

/**
 * Picks the community (Group actor) of a remote post, FEP-1b12 style, without
 * depending on the order of its recipients (they are stored one row each and
 * read back unordered).
 *
 * The inbound `audience` property is not stored, but group software (Lemmy,
 * Mbin, PieFed, Friendica groups, Guppe, ...) addresses the community actor in
 * `to`/`cc` of the posts it hosts, and groups post as themselves. Rules, in
 * order, over actors we have stored with type `Group` (unknown actors are
 * ignored):
 *
 * 1. the author, when it is a Group;
 * 2. a Group in `to`/`cc` that is not a Mention tag of the post: exactly one;
 * 3. no such Group, and exactly one Group in `to`/`cc` at all (mentioned or
 *    not): that one (Guppe and Friendica address a group by mentioning it);
 * 4. anything else, including several candidates, is ambiguous: null. A wrong
 *    audience makes Lemmy reject the reply, so null beats a guess.
 */
export const findCommunityActorId = async ({
  database,
  authorId,
  recipientIds,
  mentionedIds = []
}: {
  database: Database
  authorId: string
  recipientIds: string[]
  mentionedIds?: string[]
}): Promise<string | null> => {
  const recipients = [...new Set(recipientIds.filter(isActorAddress))]
  const ids = [...new Set([authorId, ...recipients])]
  if (ids.length === 0) return null

  const actors = await database.getActorsFromIds({ ids })
  const groups = new Set(
    actors.filter((actor) => actor.type === 'Group').map((actor) => actor.id)
  )
  if (groups.has(authorId)) return authorId

  const groupRecipients = recipients.filter((id) => groups.has(id))
  const mentioned = new Set(mentionedIds)
  const unmentioned = groupRecipients.filter((id) => !mentioned.has(id))
  if (unmentioned.length === 1) return unmentioned[0]
  if (unmentioned.length === 0 && groupRecipients.length === 1) {
    return groupRecipients[0]
  }
  return null
}

const isOpen = (value: MastodonVisibility) =>
  value === 'public' || value === 'unlisted'

/**
 * The community a reply to `replyStatus` belongs to, if any. For a remote
 * parent it is found in the parent itself; a parent of ours never stores its
 * community (only a reply's own parent does), so its community is that of its
 * own parent, up the thread.
 *
 * The walk up our own posts uses `getStatusThreadStep` (two light queries per
 * level, no hydration). It stops with null at a local ancestor that is not
 * public or unlisted (a hidden post in the chain must not tie the reply to a
 * public group), at a loop, a missing ancestor, a thread that is not a reply
 * or after MAX_THREAD_DEPTH posts. Only the remote post it ends on is fully
 * read, to rank its recipients.
 */
export const getReplyCommunityActorId = async ({
  database,
  replyStatus
}: {
  database: Database
  replyStatus: Status
}): Promise<string | null> => {
  const first = getOriginalStatus(replyStatus)
  const seen = new Set<string>()
  let step: Pick<
    StatusThreadStep,
    'id' | 'reply' | 'isLocalActor' | 'to' | 'cc'
  > = {
    id: first.id,
    reply: first.reply || null,
    isLocalActor: first.isLocalActor,
    to: first.to,
    cc: first.cc
  }

  while (true) {
    if (seen.has(step.id) || seen.size >= MAX_THREAD_DEPTH) return null
    seen.add(step.id)

    if (!step.isLocalActor) {
      // `first` is already hydrated; any other remote post is read once.
      const remote =
        step.id === first.id
          ? first
          : await database
              .getStatus({ statusId: step.id, withReplies: false })
              .then((status) => (status ? getOriginalStatus(status) : null))
      if (!remote) return null
      return findCommunityActorId({
        database,
        authorId: remote.actorId,
        recipientIds: [...remote.to, ...remote.cc],
        mentionedIds: remote.tags
          .filter((tag) => tag.type === 'mention')
          .map((tag) => tag.value)
      })
    }

    if (!isOpen(getVisibility(step.to, step.cc))) return null
    // Do not look up a parent the depth limit would discard
    if (!step.reply || seen.size >= MAX_THREAD_DEPTH) return null
    const parent = await database.getStatusThreadStep({
      statusId: step.reply
    })
    if (!parent) return null
    step = parent
  }
}

/**
 * The community a new reply with `visibility` should name, if any. Only a
 * public or unlisted reply to a public or unlisted parent may reach a
 * community: a hidden parent must not leak into a public group.
 */
export const getCommunityForNewReply = async ({
  database,
  replyStatus,
  visibility
}: {
  database: Database
  replyStatus: Status | null
  visibility: MastodonVisibility
}): Promise<string | null> => {
  if (!replyStatus) return null
  const parent = getOriginalStatus(replyStatus)
  if (!isOpen(visibility) || !isOpen(getVisibility(parent.to, parent.cc))) {
    return null
  }
  return getReplyCommunityActorId({ database, replyStatus })
}

/**
 * The community a stored reply of ours belongs to, if any: the community of its
 * parent (as createNote derives it), and only when the reply itself names it in
 * `to`/`cc` and both the reply and its parent are public or unlisted. A
 * mentioned Group, or a private/direct reply that mentions one, never counts.
 */
export const getStatusCommunityActorId = async ({
  database,
  status
}: {
  database: Database
  status: Status
}): Promise<string | null> => {
  const original = getOriginalStatus(status)
  if (!original.reply) return null
  if (!isOpen(getVisibility(original.to, original.cc))) return null

  const parent = await database.getStatus({
    statusId: original.reply,
    withReplies: false
  })
  if (!parent) return null
  const parentOriginal = getOriginalStatus(parent)
  if (!isOpen(getVisibility(parentOriginal.to, parentOriginal.cc))) return null

  const communityActorId = await getReplyCommunityActorId({
    database,
    replyStatus: parent
  })
  if (!communityActorId) return null

  return [...original.to, ...original.cc].includes(communityActorId)
    ? communityActorId
    : null
}
