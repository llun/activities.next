import {
  Status,
  StatusType,
  getOriginalStatus
} from '@/lib/types/domain/status'

// How a profile's one loaded list of statuses splits into its Posts and
// Replies tabs. Pure, so the browser rule is tested on its own.

export type ProfileFeedTab = 'posts' | 'replies'

const isReply = (status: Status) =>
  status.type !== StatusType.enum.Announce && Boolean(status.reply)

/**
 * Splits the loaded statuses into the two tabs, newest first as loaded.
 *
 * A local profile's server says which statuses open the Replies tab
 * (`repliesTabStatusIds`, from the first post of each self-reply chain), so a
 * self-reply sits on the tab of the post its chain starts from and never moves
 * when another page loads. A remote profile has no such list (`null`) and
 * keeps the old rule: replies are not on Posts (a remote profile has no
 * Replies tab, so they are not shown at all).
 */
export const splitProfileFeeds = (
  statuses: Status[],
  repliesTabStatusIds: ReadonlySet<string> | null
): { posts: Status[]; replies: Status[] } => {
  const isOnReplies = repliesTabStatusIds
    ? (status: Status) => repliesTabStatusIds.has(status.id)
    : isReply
  const posts: Status[] = []
  const replies: Status[] = []
  for (const status of statuses) {
    if (isOnReplies(status)) replies.push(status)
    else posts.push(status)
  }
  return { posts, replies }
}

/**
 * The tab of a status the owner just wrote on their own profile, before any
 * server answer: the same rule the server applies, from what is loaded. A post
 * is on Posts; a reply follows its parent when the parent is the owner's own
 * loaded status (a top-level post, or a reply already on Posts, keeps it on
 * Posts; one on Replies takes it there); a reply to anyone else, or to a parent
 * that is not loaded, is on Replies.
 *
 * Only the profile's own rows carry a tab (`repliesTabStatusIds` holds row
 * ids), so a parent that is loaded only as the post a boost shows is known
 * only in part: a top-level own post is still certain (Posts), but an own
 * reply's chain is not, so it gets the unloaded parent's default (Replies).
 * Known limit: such a reply whose chain starts at a top-level post moves to
 * Posts on reload, where the server walks the whole chain.
 */
export const getCreatedStatusTab = (
  status: Status,
  loadedStatuses: Status[],
  repliesTabStatusIds: ReadonlySet<string>
): ProfileFeedTab => {
  if (status.type === StatusType.enum.Announce || !status.reply) return 'posts'
  const isParent = (loaded: Status) => loaded.id === status.reply
  const parentRow = loadedStatuses.find(
    (loaded) => loaded.type !== StatusType.enum.Announce && isParent(loaded)
  )
  if (parentRow) {
    if (parentRow.actorId !== status.actorId) return 'replies'
    return repliesTabStatusIds.has(parentRow.id) ? 'replies' : 'posts'
  }
  // Not a row: maybe the post a boost shows.
  const boostedParent = loadedStatuses
    .filter((loaded) => loaded.type === StatusType.enum.Announce)
    .map((loaded) => getOriginalStatus(loaded))
    .find(isParent)
  if (
    boostedParent &&
    boostedParent.actorId === status.actorId &&
    !boostedParent.reply
  ) {
    return 'posts'
  }
  return 'replies'
}
