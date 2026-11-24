import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import {
  block,
  follow,
  sendFlag,
  sendLike,
  sendPollVotes,
  sendReaction,
  sendUndoLike,
  sendUndoReaction,
  unblock,
  unfollow
} from '@/lib/activities'
import * as signedRequestModule from '@/lib/activities/signedRequest'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import type { Database } from '@/lib/database/types'
import { followTimelineBackfillJob } from '@/lib/jobs/followTimelineBackfillJob'
import {
  DELIVER_ACTIVITY_JOB_NAME,
  FETCH_REMOTE_STATUS_JOB_NAME,
  FOLLOW_TIMELINE_BACKFILL_JOB_NAME,
  SEND_ANNOUNCE_JOB_NAME,
  SEND_BLOCK_JOB_NAME,
  SEND_DELETE_NOTE_JOB_NAME,
  SEND_FLAG_JOB_NAME,
  SEND_NOTE_JOB_NAME,
  SEND_QUOTE_ACCEPT_JOB_NAME,
  SEND_QUOTE_REJECT_JOB_NAME,
  SEND_QUOTE_REQUEST_JOB_NAME,
  SEND_QUOTE_REVOKE_JOB_NAME,
  SEND_UNBLOCK_JOB_NAME,
  SEND_UNDO_ANNOUNCE_JOB_NAME,
  SEND_UNDO_FOLLOW_JOB_NAME,
  SEND_UPDATE_NOTE_JOB_NAME
} from '@/lib/jobs/names'
import { sendAnnounceJob } from '@/lib/jobs/sendAnnounceJob'
import { sendBlockJob } from '@/lib/jobs/sendBlockJob'
import { sendDeleteNoteJob } from '@/lib/jobs/sendDeleteNoteJob'
import { sendFlagJob } from '@/lib/jobs/sendFlagJob'
import { sendNoteJob } from '@/lib/jobs/sendNoteJob'
import { sendQuoteAcceptJob } from '@/lib/jobs/sendQuoteAcceptJob'
import { sendQuoteRejectJob } from '@/lib/jobs/sendQuoteRejectJob'
import { sendQuoteRequestJob } from '@/lib/jobs/sendQuoteRequestJob'
import { sendQuoteRevokeJob } from '@/lib/jobs/sendQuoteRevokeJob'
import { sendUnblockJob } from '@/lib/jobs/sendUnblockJob'
import { sendUndoAnnounceJob } from '@/lib/jobs/sendUndoAnnounceJob'
import { sendUndoFollowJob } from '@/lib/jobs/sendUndoFollowJob'
import { sendUpdateNoteJob } from '@/lib/jobs/sendUpdateNoteJob'
import type { JobMessage } from '@/lib/services/queue/type'
import {
  reactStatus,
  unreactStatus
} from '@/lib/services/reactions/reactStatus'
import {
  queueMissingParentFetch,
  resetParentBackfillStateForTesting
} from '@/lib/services/statuses/parentBackfill'
import { storeBlueskyPost } from '@/lib/stub/blueskyPost'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { EXTERNAL_ACTOR1 } from '@/lib/stub/seed/external1'
import type { Actor } from '@/lib/types/domain/actor'
import { FollowStatus } from '@/lib/types/domain/follow'
import {
  StatusAnnounce,
  StatusNote,
  StatusPoll,
  StatusType
} from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { isBlueskyHostUrl } from '@/lib/utils/blueskyHost'
import { isBlueskyId } from '@/lib/utils/blueskyId'
import { request } from '@/lib/utils/request'

enableFetchMocks()

let activeDatabase: Database | null = null
const publishedJobs: JobMessage[] = []
const signedRequestUrls: string[] = []

vi.mock('@/lib/database', () => ({
  getDatabase: () => activeDatabase
}))

vi.mock('@/lib/services/queue', () => ({
  getQueue: () => ({
    runsInline: false,
    dropsDelayedJobs: false,
    publish: vi.fn(async (message: JobMessage) => {
      publishedJobs.push(message)
    }),
    handle: vi.fn()
  })
}))

vi.mock('@/lib/activities/signedRequest', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/activities/signedRequest')>()
  return {
    ...actual,
    signedActivityPubRequest: vi.fn(
      (options: signedRequestModule.SignedActivityPubRequestOptions) => {
        signedRequestUrls.push(options.url)
        return actual.signedActivityPubRequest(options)
      }
    )
  }
})

vi.mock('@/lib/utils/request', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils/request')>()
  return {
    ...actual,
    request: vi.fn(actual.request)
  }
})

const containsBlueskyRef = (value: unknown): boolean => {
  if (typeof value === 'string') {
    return isBlueskyId(value) || isBlueskyHostUrl(value)
  }
  if (Array.isArray(value)) {
    return value.some(containsBlueskyRef)
  }
  if (value && typeof value === 'object') {
    return Object.values(value).some(containsBlueskyRef)
  }
  return false
}

describe('Bluesky ActivityPub isolation sweep', () => {
  const { database, prepare, destroy } = createTestDatabase()
  let localActor: Actor
  let bskyActorId: string
  let bskyPostId: string
  let localBoostId: string
  let localQuotingNoteId: string

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await seedDatabase(database)
    activeDatabase = database

    localActor = (await database.getActorFromUsername({
      username: seedActor1.username,
      domain: seedActor1.domain
    })) as Actor

    // Ensure localActor has an accepted remote follower with a live inbox so
    // any fan-out job would enqueue a real delivery if it lacked a Bluesky guard.
    const existingFollow = await database.getAcceptedOrRequestedFollow({
      actorId: EXTERNAL_ACTOR1,
      targetActorId: localActor.id
    })
    if (!existingFollow) {
      await database.createFollow({
        actorId: EXTERNAL_ACTOR1,
        targetActorId: localActor.id,
        status: FollowStatus.enum.Accepted,
        inbox: `${EXTERNAL_ACTOR1}/inbox`,
        sharedInbox: 'https://somewhere.test/inbox'
      })
    }

    const stored = await storeBlueskyPost(database, 'isolation')
    bskyActorId = stored.actorId
    bskyPostId = stored.statusId

    localBoostId = `${localActor.id}/statuses/bsky-isolation-boost`
    await database.createAnnounce({
      id: localBoostId,
      actorId: localActor.id,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      originalStatusId: bskyPostId
    })

    localQuotingNoteId = `${localActor.id}/statuses/bsky-isolation-quote`
    await database.createNote({
      id: localQuotingNoteId,
      url: localQuotingNoteId,
      actorId: localActor.id,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      text: 'Quoting a post'
    })
  })

  afterAll(async () => {
    activeDatabase = null
    await destroy()
  })

  beforeEach(() => {
    publishedJobs.length = 0
    signedRequestUrls.length = 0
    vi.mocked(request).mockClear()
    vi.mocked(signedRequestModule.signedActivityPubRequest).mockClear()
    fetchMock.resetMocks()
    fetchMock.mockResponse('', { status: 202 })
    resetParentBackfillStateForTesting()
  })

  it('never publishes a DELIVER_ACTIVITY job for a Bluesky inbox/object or contacts bsky.app across all send jobs', async () => {
    const bskyPost = (await database.getStatus({
      statusId: bskyPostId,
      withReplies: false
    })) as StatusNote
    const localBoost = (await database.getStatus({
      statusId: localBoostId,
      withReplies: false
    })) as StatusAnnounce
    expect(bskyPost).not.toBeNull()
    expect(localBoost).not.toBeNull()

    // Status fan-out jobs: sendNote, sendUpdateNote, sendDeleteNote, sendAnnounce, sendUndoAnnounce
    await sendNoteJob(database, {
      id: 'sweep-send-note',
      name: SEND_NOTE_JOB_NAME,
      data: { actorId: localActor.id, statusId: bskyPostId }
    })
    await sendUpdateNoteJob(database, {
      id: 'sweep-send-update-note',
      name: SEND_UPDATE_NOTE_JOB_NAME,
      data: { actorId: localActor.id, statusId: bskyPostId }
    })
    await sendDeleteNoteJob(database, {
      id: 'sweep-send-delete-note',
      name: SEND_DELETE_NOTE_JOB_NAME,
      data: {
        actorId: localActor.id,
        statusId: bskyPostId,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [bskyActorId]
      }
    })
    await sendAnnounceJob(database, {
      id: 'sweep-send-announce',
      name: SEND_ANNOUNCE_JOB_NAME,
      data: { actorId: localActor.id, statusId: localBoostId }
    })
    await sendUndoAnnounceJob(database, {
      id: 'sweep-send-undo-announce',
      name: SEND_UNDO_ANNOUNCE_JOB_NAME,
      data: {
        actorId: localActor.id,
        statusId: localBoostId,
        originalStatusId: bskyPostId,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        createdAt: localBoost.createdAt
      }
    })

    // Likes, reactions, and poll votes (both direct Bluesky post and local boost with real booster inbox)
    await sendLike({ currentActor: localActor, status: bskyPost })
    await sendLike({ currentActor: localActor, status: localBoost })
    await sendUndoLike({ currentActor: localActor, status: bskyPost })
    await sendUndoLike({ currentActor: localActor, status: localBoost })
    await sendReaction({
      currentActor: localActor,
      status: bskyPost,
      reaction: '🔥',
      customEmoji: null
    })
    await sendReaction({
      currentActor: localActor,
      status: localBoost,
      reaction: '🔥',
      customEmoji: null
    })
    await sendUndoReaction({
      currentActor: localActor,
      status: bskyPost,
      reaction: '🔥',
      customEmoji: null
    })
    await sendUndoReaction({
      currentActor: localActor,
      status: localBoost,
      reaction: '🔥',
      customEmoji: null
    })
    await reactStatus({
      database,
      currentActor: localActor,
      statusId: bskyPostId,
      name: '🔥'
    })
    await unreactStatus({
      database,
      currentActor: localActor,
      statusId: bskyPostId,
      name: '🔥'
    })
    await unreactStatus({
      database,
      currentActor: localActor,
      statusId: localBoostId,
      name: '🔥'
    })
    const bskyPoll: StatusPoll = {
      ...bskyPost,
      actor: { ...localActor, id: bskyActorId },
      type: StatusType.enum.Poll,
      choices: [
        {
          statusId: bskyPostId,
          title: 'Option A',
          totalVotes: 0,
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      ],
      endAt: Date.now() + 60_000,
      pollType: 'oneOf'
    }
    await sendPollVotes({
      currentActor: localActor,
      status: bskyPoll,
      choices: [0]
    })

    // Block / unblock
    const blockUri = `${localActor.id}#blocks/bsky-sweep`
    const storedBlock = await database.createBlock({
      actorId: localActor.id,
      targetActorId: bskyActorId,
      uri: blockUri
    })
    await sendBlockJob(database, {
      id: 'sweep-send-block',
      name: SEND_BLOCK_JOB_NAME,
      data: {
        actorId: localActor.id,
        targetActorId: bskyActorId,
        uri: blockUri
      }
    })
    await block({
      uri: blockUri,
      currentActor: localActor,
      targetActorId: bskyActorId
    })
    await sendUnblockJob(database, {
      id: 'sweep-send-unblock',
      name: SEND_UNBLOCK_JOB_NAME,
      data: {
        actorId: localActor.id,
        block: storedBlock
      }
    })
    await unblock(localActor, storedBlock)

    // Follow / unfollow
    const followRecord = await database.createFollow({
      actorId: localActor.id,
      targetActorId: bskyActorId,
      status: FollowStatus.enum.Undo,
      inbox: '',
      sharedInbox: ''
    })
    await follow('follow-bsky-sweep', localActor, bskyActorId)
    await unfollow(localActor, followRecord)
    await sendUndoFollowJob(database, {
      id: 'sweep-send-undo-follow',
      name: SEND_UNDO_FOLLOW_JOB_NAME,
      data: {
        actorId: localActor.id,
        follow: followRecord
      }
    })

    // Flag (direct Bluesky target + direct sendFlag helper)
    await sendFlagJob(database, {
      id: 'sweep-send-flag',
      name: SEND_FLAG_JOB_NAME,
      data: {
        reportId: 'report-bsky-sweep',
        targetActorId: bskyActorId,
        statusIds: [bskyPostId],
        content: 'spam'
      }
    })
    await sendFlag({
      uri: `${localActor.id}#reports/bsky-sweep`,
      currentActor: localActor,
      targetActorId: bskyActorId,
      objects: [bskyActorId, bskyPostId],
      content: 'spam'
    })

    // Quote request / accept / reject / revoke
    await sendQuoteRequestJob(database, {
      id: 'sweep-quote-req-post',
      name: SEND_QUOTE_REQUEST_JOB_NAME,
      data: {
        actorId: localActor.id,
        statusId: localQuotingNoteId,
        quotedStatusId: bskyPostId
      }
    })
    await sendQuoteRequestJob(database, {
      id: 'sweep-quote-req-boost',
      name: SEND_QUOTE_REQUEST_JOB_NAME,
      data: {
        actorId: localActor.id,
        statusId: localQuotingNoteId,
        quotedStatusId: localBoostId
      }
    })
    await sendQuoteAcceptJob(database, {
      id: 'sweep-quote-accept',
      name: SEND_QUOTE_ACCEPT_JOB_NAME,
      data: {
        actorId: localActor.id,
        quotingActorId: bskyActorId,
        quoteRequestId: `${bskyPostId}#quote-request`,
        quotedStatusId: localQuotingNoteId,
        instrumentId: bskyPostId,
        stampId: `${localQuotingNoteId}#stamp`
      }
    })
    await sendQuoteRejectJob(database, {
      id: 'sweep-quote-reject',
      name: SEND_QUOTE_REJECT_JOB_NAME,
      data: {
        actorId: localActor.id,
        quotingActorId: bskyActorId,
        quoteRequestId: `${bskyPostId}#quote-request`,
        quotedStatusId: localQuotingNoteId,
        instrumentId: bskyPostId
      }
    })
    await sendQuoteRevokeJob(database, {
      id: 'sweep-quote-revoke',
      name: SEND_QUOTE_REVOKE_JOB_NAME,
      data: {
        actorId: localActor.id,
        quotingActorId: bskyActorId,
        quotingStatusId: bskyPostId,
        stampId: `${localQuotingNoteId}#stamp`
      }
    })

    // Backfills: followTimelineBackfill & parentBackfill
    await followTimelineBackfillJob(database, {
      id: 'sweep-follow-backfill',
      name: FOLLOW_TIMELINE_BACKFILL_JOB_NAME,
      data: { actorId: localActor.id, targetActorId: bskyActorId }
    })
    const parentQueued = await queueMissingParentFetch({
      database,
      inReplyTo: `${bskyActorId}/post/3kmissing`
    })
    expect(parentQueued).toBe(false)

    // Assertions:
    // 1. No DELIVER_ACTIVITY job published for a Bluesky inbox or object.
    const deliveryJobs = publishedJobs.filter(
      (job) => job.name === DELIVER_ACTIVITY_JOB_NAME
    )
    expect(deliveryJobs).toEqual([])
    for (const job of deliveryJobs) {
      const data = job.data as {
        inbox?: string
        activity?: Record<string, unknown>
      }
      expect(isBlueskyHostUrl(data.inbox)).toBe(false)
      expect(containsBlueskyRef(data.activity)).toBe(false)
    }

    // 2. No FETCH_REMOTE_STATUS job published for a Bluesky post.
    const fetchStatusJobs = publishedJobs.filter(
      (job) => job.name === FETCH_REMOTE_STATUS_JOB_NAME
    )
    expect(fetchStatusJobs).toEqual([])

    // 3. signedActivityPubRequest, request, and fetch were never called with a bsky.app URL.
    expect(signedRequestUrls.filter((url) => isBlueskyHostUrl(url))).toEqual([])
    const requestUrls = vi
      .mocked(request)
      .mock.calls.map(([opts]) => String(opts.url))
    expect(requestUrls.filter((url) => isBlueskyHostUrl(url))).toEqual([])
    const fetchUrls = fetchMock.mock.calls.map(([input]) => String(input))
    expect(fetchUrls.filter((url) => isBlueskyHostUrl(url))).toEqual([])
  })

  it('still delivers a normal local note to ActivityPub followers while skipping a mentioned Bluesky actor', async () => {
    const localNoteId = `${localActor.id}/statuses/bsky-isolation-local-note`
    await database.createNote({
      id: localNoteId,
      url: localNoteId,
      actorId: localActor.id,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [bskyActorId],
      text: 'Hello ActivityPub'
    })

    await sendNoteJob(database, {
      id: 'sweep-local-note-with-bsky-cc',
      name: SEND_NOTE_JOB_NAME,
      data: { actorId: localActor.id, statusId: localNoteId }
    })

    const deliveryJobs = publishedJobs.filter(
      (job) => job.name === DELIVER_ACTIVITY_JOB_NAME
    )
    expect(deliveryJobs.length).toBeGreaterThan(0)
    for (const job of deliveryJobs) {
      const data = job.data as {
        inbox?: string
        activity?: Record<string, unknown>
      }
      expect(isBlueskyHostUrl(data.inbox)).toBe(false)
    }
    expect(signedRequestUrls.filter((url) => isBlueskyHostUrl(url))).toEqual([])
    const requestUrls = vi
      .mocked(request)
      .mock.calls.map(([opts]) => String(opts.url))
    expect(requestUrls.filter((url) => isBlueskyHostUrl(url))).toEqual([])
  })
})
