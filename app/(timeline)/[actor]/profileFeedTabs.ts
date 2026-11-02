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
 * keeps the plain split: every reply on Replies.
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
 */
export const getCreatedStatusTab = (
  status: Status,
  loadedStatuses: Status[],
  repliesTabStatusIds: ReadonlySet<string>
): ProfileFeedTab => {
  if (status.type === StatusType.enum.Announce || !status.reply) return 'posts'
  // The parent may be loaded as its own row or as the post a boost shows.
  const parent = loadedStatuses
    .map((loaded) => getOriginalStatus(loaded))
    .find((loaded) => loaded.id === status.reply)
  if (!parent || parent.actorId !== status.actorId) return 'replies'
  return repliesTabStatusIds.has(parent.id) ? 'replies' : 'posts'
}
