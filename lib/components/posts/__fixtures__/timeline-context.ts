import { ActorProfile } from '@/lib/types/domain/actor'
import {
  Status,
  StatusAnnounce,
  StatusNote,
  StatusPoll,
  StatusType
} from '@/lib/types/domain/status'
import { Account as MastodonAccount } from '@/lib/types/mastodon/account'
import { Status as MastodonStatus } from '@/lib/types/mastodon/status'

export const BASE_TIME = new Date('2026-09-15T10:00:00.000Z').getTime()

// ============================================================================
// Mock Actors / Profiles
// ============================================================================

export const createMockActorProfile = (
  overrides: Partial<ActorProfile> & { id: string; username: string }
): ActorProfile => {
  const { id, username, domain = 'activities.local', ...rest } = overrides
  const displayName =
    rest.name ?? username.charAt(0).toUpperCase() + username.slice(1)
  return {
    id,
    username,
    domain,
    name: displayName,
    summary: `${username} profile bio`,
    followersUrl: `${id}/followers`,
    inboxUrl: `${id}/inbox`,
    sharedInboxUrl: 'https://activities.local/inbox',
    followingCount: 10,
    followersCount: 25,
    statusCount: 40,
    lastStatusAt: BASE_TIME,
    createdAt: BASE_TIME - 86400000 * 30,
    ...rest
  }
}

export const mockAlice: ActorProfile = createMockActorProfile({
  id: 'https://activities.local/users/alice',
  username: 'alice',
  name: 'Alice Smith'
})

export const mockBob: ActorProfile = createMockActorProfile({
  id: 'https://activities.local/users/bob',
  username: 'bob',
  name: 'Bob Jones'
})

export const mockCarol: ActorProfile = createMockActorProfile({
  id: 'https://activities.local/users/carol',
  username: 'carol',
  name: 'Carol White'
})

export const mockDave: ActorProfile = createMockActorProfile({
  id: 'https://activities.local/users/dave',
  username: 'dave',
  name: 'Dave Miller'
})

export const mockEve: ActorProfile = createMockActorProfile({
  id: 'https://activities.local/users/eve',
  username: 'eve',
  name: 'Eve Adams'
})

export const mockFrank: ActorProfile = createMockActorProfile({
  id: 'https://activities.local/users/frank',
  username: 'frank',
  name: 'Frank Brown'
})

export const mockGroupActor: ActorProfile = createMockActorProfile({
  id: 'https://activities.local/users/community',
  username: 'community',
  name: 'Community Group',
  type: 'Group'
})

export const mockBooster1: ActorProfile = createMockActorProfile({
  id: 'https://activities.local/users/booster1',
  username: 'booster1',
  name: 'Booster One'
})

export const mockBooster2: ActorProfile = createMockActorProfile({
  id: 'https://activities.local/users/booster2',
  username: 'booster2',
  name: 'Booster Two'
})

export const mockBooster3: ActorProfile = createMockActorProfile({
  id: 'https://activities.local/users/booster3',
  username: 'booster3',
  name: 'Booster Three'
})

// ============================================================================
// Mock Mastodon Accounts
// ============================================================================

export const createMockAccount = (
  overrides?: Partial<MastodonAccount>
): MastodonAccount => {
  const {
    id = 'https://activities.local/users/alice',
    username = 'alice',
    ...rest
  } = overrides ?? {}
  return {
    id,
    username,
    acct: `${username}@activities.local`,
    display_name: username.charAt(0).toUpperCase() + username.slice(1),
    url: `https://activities.local/@${username}`,
    uri: id,
    avatar: '',
    avatar_static: '',
    avatar_description: '',
    header: '',
    header_static: '',
    header_description: '',
    emojis: [],
    fields: [],
    locked: false,
    bot: false,
    group: false,
    discoverable: true,
    created_at: new Date(BASE_TIME).toISOString(),
    note: '',
    statuses_count: 40,
    followers_count: 25,
    following_count: 10,
    last_status_at: new Date(BASE_TIME).toISOString(),
    roles: [],
    indexable: false,
    hide_collections: null,
    source: {
      privacy: 'public',
      sensitive: false,
      language: 'en',
      note: '',
      fields: [],
      attribution_domains: [],
      follow_requests_count: 0
    },
    ...rest
  } as MastodonAccount
}

export const mockAliceAccount = createMockAccount({
  id: mockAlice.id,
  username: mockAlice.username,
  acct: `${mockAlice.username}@activities.local`,
  display_name: mockAlice.name ?? 'Alice Smith'
})

export const mockBobAccount = createMockAccount({
  id: mockBob.id,
  username: mockBob.username,
  acct: `${mockBob.username}@activities.local`,
  display_name: mockBob.name ?? 'Bob Jones'
})

// ============================================================================
// Mock Status Builders
// ============================================================================

export const createMockNote = (
  params: Partial<StatusNote> & { id: string }
): StatusNote => {
  const { id, actor = mockAlice, ...rest } = params
  const actorId = rest.actorId ?? actor?.id ?? mockAlice.id
  const createdAt = rest.createdAt ?? BASE_TIME
  return {
    id,
    publicId: null,
    actorId,
    actor,
    to: ['https://www.w3.org/ns/activitystreams#Public'],
    cc: [],
    edits: [],
    isLocalActor: true,
    createdAt,
    updatedAt: createdAt,
    type: StatusType.enum.Note,
    url: `https://activities.local/@${actor?.username ?? 'alice'}/${id.split('/').pop()}`,
    text: `Status note content for ${id}`,
    summary: null,
    sensitive: false,
    language: 'en',
    reply: '',
    replies: [],
    totalReplies: 0,
    actorAnnounceStatusId: null,
    isActorLiked: false,
    isActorBookmarked: false,
    totalLikes: 0,
    totalShares: 0,
    attachments: [],
    tags: [],
    quote: null,
    linkPreview: null,
    ...rest
  }
}

export const createMockPoll = (
  params: Partial<StatusPoll> & { id: string }
): StatusPoll => {
  const {
    choices,
    endAt,
    pollType,
    hideTotals,
    votersCount,
    voted,
    ownVotes,
    type: _type,
    ...noteParams
  } = params
  const baseNote = createMockNote(noteParams)
  const createdAt = baseNote.createdAt
  return {
    ...baseNote,
    type: StatusType.enum.Poll,
    choices: choices ?? [
      {
        statusId: params.id,
        title: 'Option 1',
        totalVotes: 5,
        createdAt,
        updatedAt: createdAt
      },
      {
        statusId: params.id,
        title: 'Option 2',
        totalVotes: 3,
        createdAt,
        updatedAt: createdAt
      }
    ],
    endAt: endAt ?? createdAt + 86400000,
    pollType: pollType ?? 'oneOf',
    hideTotals: hideTotals ?? false,
    votersCount: votersCount ?? 8,
    voted: voted ?? false,
    ownVotes: ownVotes ?? []
  }
}

export const createMockAnnounce = (params: {
  id: string
  originalStatus: Status
  actor?: ActorProfile | null
  actorId?: string
  createdAt?: number
  updatedAt?: number
  to?: string[]
  cc?: string[]
}): StatusAnnounce => {
  const actor = params.actor ?? mockBooster1
  const createdAt = params.createdAt ?? BASE_TIME + 1000
  return {
    id: params.id,
    publicId: null,
    actorId: params.actorId ?? actor?.id ?? mockBooster1.id,
    actor,
    to: params.to ?? ['https://www.w3.org/ns/activitystreams#Public'],
    cc: params.cc ?? [],
    edits: [],
    isLocalActor: true,
    createdAt,
    updatedAt: params.updatedAt ?? createdAt,
    type: StatusType.enum.Announce,
    originalStatus: params.originalStatus
  }
}

export const createMockMastodonStatus = (
  params: Partial<MastodonStatus> & { id: string }
): MastodonStatus => {
  const { id, account = mockAliceAccount, created_at, ...rest } = params
  const nowIso = new Date(created_at ?? BASE_TIME).toISOString()
  return {
    id,
    uri: rest.uri ?? id,
    created_at: nowIso,
    account,
    content: rest.content ?? `<p>Mock status content for ${id}</p>`,
    visibility: rest.visibility ?? 'public',
    sensitive: rest.sensitive ?? false,
    spoiler_text: rest.spoiler_text ?? '',
    media_attachments: rest.media_attachments ?? [],
    application: rest.application ?? null,
    mentions: rest.mentions ?? [],
    tags: rest.tags ?? [],
    emojis: rest.emojis ?? [],
    reblogs_count: rest.reblogs_count ?? 0,
    favourites_count: rest.favourites_count ?? 0,
    replies_count: rest.replies_count ?? 0,
    url: rest.url ?? id,
    in_reply_to_id: rest.in_reply_to_id ?? null,
    in_reply_to_account_id: rest.in_reply_to_account_id ?? null,
    reblog: rest.reblog ?? null,
    poll: rest.poll ?? null,
    card: rest.card ?? null,
    language: rest.language ?? 'en',
    text: rest.text ?? null,
    edited_at: rest.edited_at ?? null,
    favourited: rest.favourited ?? false,
    reblogged: rest.reblogged ?? false,
    muted: rest.muted ?? false,
    bookmarked: rest.bookmarked ?? false,
    pinned: rest.pinned ?? false,
    ...rest
  } as MastodonStatus
}

/**
 * Extract the in-reply-to status ID from either a domain Status or Mastodon Status.
 * Returns null if the status is not a reply.
 */
export const getInReplyToId = (
  status: Status | MastodonStatus
): string | null => {
  if ('in_reply_to_id' in status) {
    return status.in_reply_to_id ?? null
  }
  if (status.type === StatusType.enum.Announce) {
    return getInReplyToId(status.originalStatus)
  }
  return status.reply ? status.reply : null
}

// ============================================================================
// 13 Authoritative Timeline Scenarios
// ============================================================================

// a. Single post: isolated post with no parent, no replies, no boosts
const singlePost = createMockNote({
  id: 'https://activities.local/users/alice/statuses/single-post-1',
  actor: mockAlice,
  actorId: mockAlice.id,
  createdAt: BASE_TIME,
  text: 'Just a solitary status update',
  reply: ''
})

export const singlePostScenario = {
  name: 'a_single_post' as const,
  description: 'Single isolated post with no replies, parent, or boosts',
  post: singlePost,
  statuses: [singlePost],
  mastodonStatuses: [
    createMockMastodonStatus({
      id: singlePost.id,
      in_reply_to_id: null,
      content: singlePost.text
    })
  ]
}

// b. Self-thread: consecutive posts by same author linked via inReplyToId
const selfThreadRoot = createMockNote({
  id: 'https://activities.local/users/alice/statuses/thread-1',
  actor: mockAlice,
  actorId: mockAlice.id,
  createdAt: BASE_TIME,
  text: 'Thread part 1: The introduction',
  reply: ''
})

const selfThreadReply1 = createMockNote({
  id: 'https://activities.local/users/alice/statuses/thread-2',
  actor: mockAlice,
  actorId: mockAlice.id,
  createdAt: BASE_TIME + 60000,
  text: 'Thread part 2: The continuation',
  reply: selfThreadRoot.id
})

const selfThreadReply2 = createMockNote({
  id: 'https://activities.local/users/alice/statuses/thread-3',
  actor: mockAlice,
  actorId: mockAlice.id,
  createdAt: BASE_TIME + 120000,
  text: 'Thread part 3: The conclusion',
  reply: selfThreadReply1.id
})

export const selfThreadScenario = {
  name: 'b_self_thread' as const,
  description:
    'Self-thread of consecutive posts by Alice linked via reply/inReplyToId',
  root: selfThreadRoot,
  reply1: selfThreadReply1,
  reply2: selfThreadReply2,
  chronologicalStatuses: [selfThreadRoot, selfThreadReply1, selfThreadReply2],
  rawFeedStatuses: [selfThreadReply2, selfThreadReply1, selfThreadRoot],
  statuses: [selfThreadReply2, selfThreadReply1, selfThreadRoot]
}

// c. Multi-author conversation: A replies to B, C replies to A
const multiAuthorPostA = createMockNote({
  id: 'https://activities.local/users/alice/statuses/conv-a',
  actor: mockAlice,
  actorId: mockAlice.id,
  createdAt: BASE_TIME,
  text: 'Alice: What does everyone think of Phanpy timeline layout?',
  reply: ''
})

const multiAuthorPostB = createMockNote({
  id: 'https://activities.local/users/bob/statuses/conv-b',
  actor: mockBob,
  actorId: mockBob.id,
  createdAt: BASE_TIME + 60000,
  text: 'Bob: @alice It groups conversations nicely!',
  reply: multiAuthorPostA.id
})

const multiAuthorPostC = createMockNote({
  id: 'https://activities.local/users/carol/statuses/conv-c',
  actor: mockCarol,
  actorId: mockCarol.id,
  createdAt: BASE_TIME + 120000,
  text: 'Carol: @bob @alice Agreed, the nested replies make reading easier.',
  reply: multiAuthorPostB.id
})

export const multiAuthorConversationScenario = {
  name: 'c_multi_author_conversation' as const,
  description:
    'Multi-author conversation (Alice -> Bob replies to Alice -> Carol replies to Bob)',
  postA: multiAuthorPostA,
  postB: multiAuthorPostB,
  postC: multiAuthorPostC,
  chronologicalStatuses: [multiAuthorPostA, multiAuthorPostB, multiAuthorPostC],
  rawFeedStatuses: [multiAuthorPostC, multiAuthorPostB, multiAuthorPostA],
  statuses: [multiAuthorPostC, multiAuthorPostB, multiAuthorPostA]
}

// d. Nested replies: branching trees
const nestedRoot = createMockNote({
  id: 'https://activities.local/users/alice/statuses/tree-root',
  actor: mockAlice,
  actorId: mockAlice.id,
  createdAt: BASE_TIME,
  text: 'Root topic for tree discussion',
  reply: ''
})

const nestedChildBob = createMockNote({
  id: 'https://activities.local/users/bob/statuses/tree-child-bob',
  actor: mockBob,
  actorId: mockBob.id,
  createdAt: BASE_TIME + 60000,
  text: 'Bob replying to root',
  reply: nestedRoot.id
})

const nestedChildCarol = createMockNote({
  id: 'https://activities.local/users/carol/statuses/tree-child-carol',
  actor: mockCarol,
  actorId: mockCarol.id,
  createdAt: BASE_TIME + 120000,
  text: 'Carol replying to root',
  reply: nestedRoot.id
})

const nestedGrandchildDave = createMockNote({
  id: 'https://activities.local/users/dave/statuses/tree-gc-dave',
  actor: mockDave,
  actorId: mockDave.id,
  createdAt: BASE_TIME + 180000,
  text: 'Dave replying to Bob',
  reply: nestedChildBob.id
})

const nestedGrandchildEve = createMockNote({
  id: 'https://activities.local/users/eve/statuses/tree-gc-eve',
  actor: mockEve,
  actorId: mockEve.id,
  createdAt: BASE_TIME + 240000,
  text: 'Eve replying to Bob',
  reply: nestedChildBob.id
})

const nestedGrandchildFrank = createMockNote({
  id: 'https://activities.local/users/frank/statuses/tree-gc-frank',
  actor: mockFrank,
  actorId: mockFrank.id,
  createdAt: BASE_TIME + 300000,
  text: 'Frank replying to Carol',
  reply: nestedChildCarol.id
})

export const nestedRepliesScenario = {
  name: 'd_nested_replies' as const,
  description:
    'Branching tree of replies under Alice root with multiple children and grandchildren',
  root: nestedRoot,
  childBob: nestedChildBob,
  childCarol: nestedChildCarol,
  grandchildDave: nestedGrandchildDave,
  grandchildEve: nestedGrandchildEve,
  grandchildFrank: nestedGrandchildFrank,
  chronologicalStatuses: [
    nestedRoot,
    nestedChildBob,
    nestedChildCarol,
    nestedGrandchildDave,
    nestedGrandchildEve,
    nestedGrandchildFrank
  ],
  rawFeedStatuses: [
    nestedGrandchildFrank,
    nestedGrandchildEve,
    nestedGrandchildDave,
    nestedChildCarol,
    nestedChildBob,
    nestedRoot
  ],
  statuses: [
    nestedGrandchildFrank,
    nestedGrandchildEve,
    nestedGrandchildDave,
    nestedChildCarol,
    nestedChildBob,
    nestedRoot
  ]
}

// e. Boost of old post
const OLD_POST_TIME = BASE_TIME - 7 * 86400000
const oldPost = createMockNote({
  id: 'https://activities.local/users/alice/statuses/old-post-1',
  actor: mockAlice,
  actorId: mockAlice.id,
  createdAt: OLD_POST_TIME,
  updatedAt: OLD_POST_TIME,
  text: 'An important evergreen thought from a week ago',
  reply: ''
})

const boostOfOldPost = createMockAnnounce({
  id: 'https://activities.local/users/bob/statuses/boost-old-1',
  originalStatus: oldPost,
  actor: mockBob,
  actorId: mockBob.id,
  createdAt: BASE_TIME + 5000
})

export const boostOfOldPostScenario = {
  name: 'e_boost_of_old_post' as const,
  description:
    'Boost of an older post (boost timestamp is recent, original post timestamp is old)',
  originalPost: oldPost,
  boost: boostOfOldPost,
  statuses: [boostOfOldPost]
}

// f. Repeated boosts (multiple accounts boosting same post)
const popularPost = createMockNote({
  id: 'https://activities.local/users/alice/statuses/popular-post-1',
  actor: mockAlice,
  actorId: mockAlice.id,
  createdAt: BASE_TIME,
  text: 'Exciting announcement that everyone boosts!',
  reply: ''
})

const repeatedBoost1 = createMockAnnounce({
  id: 'https://activities.local/users/booster1/statuses/boost-p1-1',
  originalStatus: popularPost,
  actor: mockBooster1,
  actorId: mockBooster1.id,
  createdAt: BASE_TIME + 60000
})

const repeatedBoost2 = createMockAnnounce({
  id: 'https://activities.local/users/booster2/statuses/boost-p1-2',
  originalStatus: popularPost,
  actor: mockBooster2,
  actorId: mockBooster2.id,
  createdAt: BASE_TIME + 120000
})

const repeatedBoost3 = createMockAnnounce({
  id: 'https://activities.local/users/booster3/statuses/boost-p1-3',
  originalStatus: popularPost,
  actor: mockBooster3,
  actorId: mockBooster3.id,
  createdAt: BASE_TIME + 180000
})

export const repeatedBoostsScenario = {
  name: 'f_repeated_boosts' as const,
  description:
    'Multiple boosters boosting the exact same original post with separate Announce wrappers',
  originalPost: popularPost,
  boost1: repeatedBoost1,
  boost2: repeatedBoost2,
  boost3: repeatedBoost3,
  boosts: [repeatedBoost3, repeatedBoost2, repeatedBoost1],
  statuses: [repeatedBoost3, repeatedBoost2, repeatedBoost1]
}

// g. Boost of reply
const parentForBoostedReply = createMockNote({
  id: 'https://activities.local/users/alice/statuses/parent-for-boosted-reply',
  actor: mockAlice,
  actorId: mockAlice.id,
  createdAt: BASE_TIME,
  text: 'Original question initiating discussion',
  reply: ''
})

const replyToBeBoosted = createMockNote({
  id: 'https://activities.local/users/bob/statuses/reply-to-be-boosted',
  actor: mockBob,
  actorId: mockBob.id,
  createdAt: BASE_TIME + 60000,
  text: 'Insightful answer worth boosting',
  reply: parentForBoostedReply.id
})

const boostOfReply = createMockAnnounce({
  id: 'https://activities.local/users/carol/statuses/boost-of-reply-1',
  originalStatus: replyToBeBoosted,
  actor: mockCarol,
  actorId: mockCarol.id,
  createdAt: BASE_TIME + 120000
})

export const boostOfReplyScenario = {
  name: 'g_boost_of_reply' as const,
  description:
    'An Announce wrapper around an original status that is itself a reply',
  parentPost: parentForBoostedReply,
  replyPost: replyToBeBoosted,
  boostOfReply,
  statuses: [boostOfReply, parentForBoostedReply]
}

// h. Quote post
const quotedTargetPost = createMockNote({
  id: 'https://activities.local/users/bob/statuses/quoted-post-1',
  actor: mockBob,
  actorId: mockBob.id,
  createdAt: BASE_TIME,
  text: 'Here is an interesting observation to quote',
  reply: ''
})

const quotingPost = createMockNote({
  id: 'https://activities.local/users/alice/statuses/quoting-post-1',
  actor: mockAlice,
  actorId: mockAlice.id,
  createdAt: BASE_TIME + 60000,
  text: 'Adding my thoughts to Bob observation:',
  reply: '',
  quote: {
    quotedStatusId: quotedTargetPost.id,
    quotedStatusUrl: quotedTargetPost.url,
    state: 'accepted',
    authorizationUri: null
  }
})

export const quotePostScenario = {
  name: 'h_quote_post' as const,
  description: 'A status quoting another status with an accepted quote edge',
  quotedPost: quotedTargetPost,
  quotingPost,
  statuses: [quotingPost, quotedTargetPost]
}

// i. Poll
const pollStatus = createMockPoll({
  id: 'https://activities.local/users/alice/statuses/poll-post-1',
  actor: mockAlice,
  actorId: mockAlice.id,
  createdAt: BASE_TIME,
  text: 'What is your preferred timeline reading mode?',
  reply: '',
  choices: [
    {
      statusId: 'https://activities.local/users/alice/statuses/poll-post-1',
      title: 'Grouped threads (Phanpy style)',
      totalVotes: 42,
      createdAt: BASE_TIME,
      updatedAt: BASE_TIME
    },
    {
      statusId: 'https://activities.local/users/alice/statuses/poll-post-1',
      title: 'Pure chronological flat list',
      totalVotes: 15,
      createdAt: BASE_TIME,
      updatedAt: BASE_TIME
    },
    {
      statusId: 'https://activities.local/users/alice/statuses/poll-post-1',
      title: 'Algorithm / Catch-up',
      totalVotes: 4,
      createdAt: BASE_TIME,
      updatedAt: BASE_TIME
    }
  ],
  endAt: BASE_TIME + 86400000 * 2,
  pollType: 'oneOf',
  hideTotals: false,
  votersCount: 61
})

export const pollScenario = {
  name: 'i_poll' as const,
  description:
    'A status containing an interactive poll with multiple options and vote tallies',
  pollPost: pollStatus,
  statuses: [pollStatus]
}

// j. Missing / hidden parent (inReplyToId points to nonexistent or blocked post)
const missingParentId =
  'https://activities.local/users/ghost/statuses/nonexistent-parent-999'

const orphanReply = createMockNote({
  id: 'https://activities.local/users/bob/statuses/orphan-reply-1',
  actor: mockBob,
  actorId: mockBob.id,
  createdAt: BASE_TIME + 60000,
  text: 'Bob reply to a missing, deleted, or blocked parent status',
  reply: missingParentId
})

export const missingParentScenario = {
  name: 'j_missing_parent' as const,
  description:
    'A reply whose inReplyToId points to a nonexistent, deleted, or blocked parent',
  missingParentId,
  orphanReply,
  statuses: [orphanReply]
}

// k. Late parent (parent arrives after child or appears lower in feed)
const lateParentRoot = createMockNote({
  id: 'https://activities.local/users/alice/statuses/late-parent-root',
  actor: mockAlice,
  actorId: mockAlice.id,
  createdAt: BASE_TIME, // 10:00:00
  text: 'Parent post authored earlier',
  reply: ''
})

const lateParentUnrelated = createMockNote({
  id: 'https://activities.local/users/carol/statuses/late-parent-unrelated',
  actor: mockCarol,
  actorId: mockCarol.id,
  createdAt: BASE_TIME + 120000, // 10:02:00
  text: 'Unrelated post sitting between parent and child in raw feed',
  reply: ''
})

const lateParentChild = createMockNote({
  id: 'https://activities.local/users/bob/statuses/late-parent-child',
  actor: mockBob,
  actorId: mockBob.id,
  createdAt: BASE_TIME + 240000, // 10:04:00
  text: 'Child post authored later, replying to parent',
  reply: lateParentRoot.id
})

export const lateParentScenario = {
  name: 'k_late_parent' as const,
  description:
    'Child arrives earlier in newest-first feed than its parent (parent appears lower in the array)',
  parent: lateParentRoot,
  unrelated: lateParentUnrelated,
  child: lateParentChild,
  rawFeedStatuses: [lateParentChild, lateParentUnrelated, lateParentRoot],
  statuses: [lateParentChild, lateParentUnrelated, lateParentRoot]
}

// l. Equal timestamps (sibling replies or child with same timestamp as parent)
const equalTimestampRoot = createMockNote({
  id: 'https://activities.local/users/alice/statuses/eq-root',
  actor: mockAlice,
  actorId: mockAlice.id,
  createdAt: BASE_TIME,
  text: 'Root post for timestamp tie-breaking',
  reply: ''
})

const equalTimestampSiblingA = createMockNote({
  id: 'https://activities.local/users/bob/statuses/eq-sibling-a',
  actor: mockBob,
  actorId: mockBob.id,
  createdAt: BASE_TIME + 60000,
  text: 'Sibling A reply with exact same timestamp as Sibling B',
  reply: equalTimestampRoot.id
})

const equalTimestampSiblingB = createMockNote({
  id: 'https://activities.local/users/carol/statuses/eq-sibling-b',
  actor: mockCarol,
  actorId: mockCarol.id,
  createdAt: BASE_TIME + 60000, // exact same ms
  text: 'Sibling B reply with exact same timestamp as Sibling A',
  reply: equalTimestampRoot.id
})

const equalTimestampParentSameTime = createMockNote({
  id: 'https://activities.local/users/dave/statuses/eq-parent-same-time',
  actor: mockDave,
  actorId: mockDave.id,
  createdAt: BASE_TIME + 120000,
  text: 'Parent with timestamp identical to its child',
  reply: ''
})

const equalTimestampChildSameTime = createMockNote({
  id: 'https://activities.local/users/eve/statuses/eq-child-same-time',
  actor: mockEve,
  actorId: mockEve.id,
  createdAt: BASE_TIME + 120000, // exact same ms as parent
  text: 'Child with timestamp identical to its parent',
  reply: equalTimestampParentSameTime.id
})

export const equalTimestampsScenario = {
  name: 'l_equal_timestamps' as const,
  description:
    'Sibling replies with identical timestamps, and child with identical timestamp to parent',
  rootPost: equalTimestampRoot,
  siblingA: equalTimestampSiblingA,
  siblingB: equalTimestampSiblingB,
  parentSameTime: equalTimestampParentSameTime,
  childSameTime: equalTimestampChildSameTime,
  statuses: [
    equalTimestampChildSameTime,
    equalTimestampParentSameTime,
    equalTimestampSiblingB,
    equalTimestampSiblingA,
    equalTimestampRoot
  ]
}

// m. Cyclic references (A -> B -> A and X -> Y -> Z -> X)
const cyclicPostA = createMockNote({
  id: 'https://activities.local/users/alice/statuses/cycle-a',
  actor: mockAlice,
  actorId: mockAlice.id,
  createdAt: BASE_TIME,
  text: 'Cyclic Post A (points to B)',
  reply: 'https://activities.local/users/bob/statuses/cycle-b'
})

const cyclicPostB = createMockNote({
  id: 'https://activities.local/users/bob/statuses/cycle-b',
  actor: mockBob,
  actorId: mockBob.id,
  createdAt: BASE_TIME + 1000,
  text: 'Cyclic Post B (points to A)',
  reply: cyclicPostA.id
})

const cyclicPostX = createMockNote({
  id: 'https://activities.local/users/alice/statuses/cycle-x',
  actor: mockAlice,
  actorId: mockAlice.id,
  createdAt: BASE_TIME + 2000,
  text: 'Cycle node X (points to Y)',
  reply: 'https://activities.local/users/bob/statuses/cycle-y'
})

const cyclicPostY = createMockNote({
  id: 'https://activities.local/users/bob/statuses/cycle-y',
  actor: mockBob,
  actorId: mockBob.id,
  createdAt: BASE_TIME + 3000,
  text: 'Cycle node Y (points to Z)',
  reply: 'https://activities.local/users/carol/statuses/cycle-z'
})

const cyclicPostZ = createMockNote({
  id: 'https://activities.local/users/carol/statuses/cycle-z',
  actor: mockCarol,
  actorId: mockCarol.id,
  createdAt: BASE_TIME + 4000,
  text: 'Cycle node Z (points to X)',
  reply: cyclicPostX.id
})

export const cyclicReferencesScenario = {
  name: 'm_cyclic_references' as const,
  description:
    'Malformed data containing circular reply chains (A -> B -> A and X -> Y -> Z -> X)',
  cyclicPostA,
  cyclicPostB,
  twoNodeCycle: [cyclicPostA, cyclicPostB],
  cyclicPostX,
  cyclicPostY,
  cyclicPostZ,
  threeNodeCycle: [cyclicPostX, cyclicPostY, cyclicPostZ],
  statuses: [cyclicPostB, cyclicPostA]
}

// ============================================================================
// Comprehensive Scenarios Map
// ============================================================================

export const timelineScenarios = {
  singlePost: singlePostScenario,
  selfThread: selfThreadScenario,
  multiAuthorConversation: multiAuthorConversationScenario,
  nestedReplies: nestedRepliesScenario,
  boostOfOldPost: boostOfOldPostScenario,
  repeatedBoosts: repeatedBoostsScenario,
  boostOfReply: boostOfReplyScenario,
  quotePost: quotePostScenario,
  poll: pollScenario,
  missingParent: missingParentScenario,
  lateParent: lateParentScenario,
  equalTimestamps: equalTimestampsScenario,
  cyclicReferences: cyclicReferencesScenario
} as const
