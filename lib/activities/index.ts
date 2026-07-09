import { Span } from '@opentelemetry/api'
import crypto from 'crypto'

import { AcceptFollow } from '@/lib/activities/acceptFollow'
import { activityPubRequestHeaders } from '@/lib/activities/activityPubHeaders'
import { AnnounceStatus } from '@/lib/activities/announceStatus'
import { BlockRequest } from '@/lib/activities/blockAction'
import { CreateStatus } from '@/lib/activities/createStatus'
import { DeleteStatus } from '@/lib/activities/deleteStatus'
import { FlagRequest } from '@/lib/activities/flagAction'
import { FollowRequest } from '@/lib/activities/followAction'
import { getActorPerson } from '@/lib/activities/getActorPerson'
import { compactActivityPub } from '@/lib/activities/jsonld'
import { LikeStatus } from '@/lib/activities/likeAction'
import { RejectFollow } from '@/lib/activities/rejectFollow'
import { UndoBlock } from '@/lib/activities/undoBlock'
import { UndoFollow } from '@/lib/activities/undoFollow'
import { UndoLike } from '@/lib/activities/undoLike'
import { UndoStatus } from '@/lib/activities/undoStatus'
import { UpdateStatus } from '@/lib/activities/updateStatus'
import { Note } from '@/lib/types/activitypub'
import {
  AnnounceAction,
  CreateAction,
  DeleteAction,
  UndoAction,
  UpdateAction
} from '@/lib/types/activitypub/activities'
import { Actor } from '@/lib/types/domain/actor'
import { Block as DomainBlock } from '@/lib/types/domain/block'
import { Follow } from '@/lib/types/domain/follow'
import { Relay } from '@/lib/types/domain/relay'
import {
  Status,
  StatusAnnounce,
  StatusPoll,
  StatusType
} from '@/lib/types/domain/status'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_URL
} from '@/lib/utils/activitystream'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'
import { getNoteFromStatus } from '@/lib/utils/getNoteFromStatus'
import { logger } from '@/lib/utils/logger'
import { request } from '@/lib/utils/request'
import { getTracer } from '@/lib/utils/trace'

interface PostActivityToInboxParams {
  span: Span
  inbox: string
  currentActor: Actor
  activity: object
  logPrefix: string
  silenceTimeout?: boolean
}

/**
 * Signs and POSTs an ActivityPub activity to a target inbox with the shared
 * error handling used by every send helper. For fire-and-forget deliveries,
 * `silenceTimeout` records an ETIMEDOUT only as a span attribute; all other
 * failures are recorded on the span and logged under the caller's `[logPrefix]`.
 * Returns the HTTP status code, or `undefined` when the request threw.
 */
const postActivityToInbox = async ({
  span,
  inbox,
  currentActor,
  activity,
  logPrefix,
  silenceTimeout = false
}: PostActivityToInboxParams): Promise<number | undefined> => {
  const method = 'POST'
  try {
    const { statusCode } = await request({
      url: inbox,
      method,
      headers: activityPubRequestHeaders({
        url: inbox,
        method,
        signingActor: currentActor,
        content: activity
      }),
      body: JSON.stringify(activity)
    })
    return statusCode
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException | null | undefined
    if (silenceTimeout && nodeError?.code === 'ETIMEDOUT') {
      span.setAttribute('timeout', true)
      return undefined
    }

    // Normalize non-Error throws so recording/logging can't itself throw.
    const exception = error instanceof Error ? error : new Error(String(error))
    span.recordException(exception)
    logger.error(`[${logPrefix}] ${exception.message}`)
    return undefined
  }
}

interface GetNoteParams {
  statusId: string
  signingActor?: Actor
}
export const getNote = async ({
  statusId,
  signingActor
}: GetNoteParams): Promise<Note | null> =>
  getTracer().startActiveSpan(
    'activities.getNote',
    { attributes: { statusId } },
    async (span) => {
      try {
        const { statusCode, body } = await request({
          url: statusId,
          headers: activityPubRequestHeaders({
            url: statusId,
            signingActor
          })
        })
        if (statusCode !== 200) return null
        // Canonicalise the fetched note via JSON-LD compaction so every caller
        // (including boosted-note resolution) gets a predictable shape.
        return compactActivityPub(JSON.parse(body))
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException
        if (nodeError.code === 'ETIMEDOUT') {
          span.setAttribute('timeout', true)
          return
        }

        span.recordException(nodeError)
        logger.error(`[getNote] ${nodeError.message}`)
        return null
      } finally {
        span.end()
      }
    }
  )

interface SendNoteParams {
  currentActor: Actor
  inbox: string
  note: Note
}
export const sendNote = async ({ currentActor, inbox, note }: SendNoteParams) =>
  getTracer().startActiveSpan(
    'activities.sendNote',
    {
      attributes: {
        actorId: currentActor.id,
        inbox
      }
    },
    async (span) => {
      const activity: CreateStatus = {
        '@context': ACTIVITY_STREAM_URL,
        id: note.id,
        type: CreateAction,
        actor: note.attributedTo,
        published: note.published,
        to: note.to,
        cc: note.cc,
        object: note
      }
      await postActivityToInbox({
        span,
        inbox,
        currentActor,
        activity,
        logPrefix: 'sendNote',
        silenceTimeout: true
      })
      span.end()
    }
  )

interface SendUpdateNoteParams {
  currentActor: Actor
  inbox: string
  status: Status
}
export const sendUpdateNote = async ({
  currentActor,
  inbox,
  status
}: SendUpdateNoteParams) =>
  getTracer().startActiveSpan(
    'activities.sendUpdateNote',
    {
      attributes: {
        actorId: currentActor.id,
        inbox
      }
    },
    async (span) => {
      const note = getNoteFromStatus(status, { includeUpdated: true })
      if (!note) {
        span.end()
        return
      }

      const activity: UpdateStatus = {
        '@context': ACTIVITY_STREAM_URL,
        id: `${note.id}#updates/${Date.now()}`,
        type: UpdateAction,
        actor: note.attributedTo,
        published: getISOTimeUTC(status.updatedAt),
        to: note.to,
        cc: note.cc,
        object: note
      }
      await postActivityToInbox({
        span,
        inbox,
        currentActor,
        activity,
        logPrefix: 'sendUpdateNote',
        silenceTimeout: true
      })
      span.end()
    }
  )

interface SendAnnounceParams {
  currentActor: Actor
  inbox: string
  status: Status
}
export const sendAnnounce = async ({
  currentActor,
  inbox,
  status
}: SendAnnounceParams) =>
  getTracer().startActiveSpan(
    'activities.sendAnnounce',
    {
      attributes: {
        actorId: currentActor.id,
        inbox
      }
    },
    async (span) => {
      if (status.type !== StatusType.enum.Announce) {
        span.end()
        return null
      }

      const activity: AnnounceStatus = {
        '@context': ACTIVITY_STREAM_URL,
        id: `${status.id}/activity`,
        type: AnnounceAction,
        actor: status.actorId,
        published: getISOTimeUTC(status.createdAt),
        to: status.to,
        cc: status.cc,
        object: status.originalStatus.id
      }
      await postActivityToInbox({
        span,
        inbox,
        currentActor,
        activity,
        logPrefix: 'sendAnnounce',
        silenceTimeout: true
      })
      span.end()
    }
  )

interface DeleteStatusParams {
  currentActor: Actor
  inbox: string
  statusId: string
  to?: string[]
  cc?: string[]
}
export const deleteStatus = async ({
  currentActor,
  inbox,
  statusId,
  to,
  cc
}: DeleteStatusParams) =>
  getTracer().startActiveSpan(
    'activities.deleteStatus',
    {
      attributes: {
        actorId: currentActor.id,
        inbox
      }
    },
    async (span) => {
      const activity: DeleteStatus = {
        '@context': ACTIVITY_STREAM_URL,
        id: `${statusId}#delete`,
        type: DeleteAction,
        actor: currentActor.id,
        to: to ?? [ACTIVITY_STREAM_PUBLIC],
        ...(cc ? { cc } : {}),
        object: {
          id: statusId,
          type: 'Tombstone'
        }
      }
      await postActivityToInbox({
        span,
        inbox,
        currentActor,
        activity,
        logPrefix: 'deleteStatus',
        silenceTimeout: true
      })
      span.end()
    }
  )

interface UndoAnnounceParams {
  currentActor: Actor
  inbox: string
  announce: StatusAnnounce
}
export const undoAnnounce = async ({
  currentActor,
  inbox,
  announce
}: UndoAnnounceParams) =>
  getTracer().startActiveSpan(
    'activities.undoAnnounce',
    {
      attributes: {
        actorId: currentActor.id,
        inbox
      }
    },
    async (span) => {
      const activity: UndoStatus = {
        '@context': ACTIVITY_STREAM_URL,
        id: `${announce.id}#undo`,
        type: UndoAction,
        actor: currentActor.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        object: {
          id: `${announce.id}/activity`,
          type: AnnounceAction,
          actor: announce.actorId,
          published: getISOTimeUTC(announce.createdAt),
          to: announce.to,
          cc: announce.cc,
          object: announce.originalStatus.id
        }
      }
      await postActivityToInbox({
        span,
        inbox,
        currentActor,
        activity,
        logPrefix: 'undoAnnounce',
        silenceTimeout: true
      })
      span.end()
    }
  )

export const follow = async (
  id: string,
  currentActor: Actor,
  targetActorId: string,
  signingActor?: Actor
) =>
  getTracer().startActiveSpan(
    'activities.follow',
    {
      attributes: {
        id,
        actorId: currentActor.id,
        targetActorId
      }
    },
    async (span) => {
      const activity: FollowRequest = {
        '@context': ACTIVITY_STREAM_URL,
        id: `https://${currentActor.domain}/${id}`,
        type: 'Follow',
        actor: currentActor.id,
        object: targetActorId
      }
      const person = await getActorPerson({
        actorId: targetActorId,
        signingActor
      })
      const targetInbox = person?.inbox
      if (!targetInbox) {
        span.end()
        return false
      }

      const statusCode = await postActivityToInbox({
        span,
        inbox: targetInbox,
        currentActor,
        activity,
        logPrefix: 'follow'
      })
      span.end()
      return statusCode === 202
    }
  )

export const unfollow = async (
  currentActor: Actor,
  follow: Follow,
  signingActor?: Actor
) =>
  getTracer().startActiveSpan(
    'activities.unfollow',
    {
      attributes: {
        actorId: currentActor.id,
        follow: follow.id
      }
    },
    async (span) => {
      const activity: UndoFollow = {
        '@context': ACTIVITY_STREAM_URL,
        id: `https://${currentActor.domain}/${currentActor.id}#follows/${follow.id}/undo`,
        type: 'Undo',
        actor: currentActor.id,
        object: {
          id: `https://${currentActor.domain}/${follow.id}`,
          type: 'Follow',
          actor: follow.actorId,
          object: follow.targetActorId
        }
      }

      const person = await getActorPerson({
        actorId: follow.targetActorId,
        signingActor
      })
      const targetInbox = person?.inbox ?? `${follow.targetActorId}/inbox`

      const statusCode = await postActivityToInbox({
        span,
        inbox: targetInbox,
        currentActor,
        activity,
        logPrefix: 'unfollow'
      })
      span.end()
      return statusCode === 202
    }
  )

// Subscribe to a relay: send a Follow whose object is the ActivityStreams
// Public collection (the LitePub convention) to the relay's inbox, signed by
// the instance/federation signing actor. Returns the generated Follow id (to
// persist so the relay's Accept can be matched back) and whether the relay
// inbox accepted delivery (HTTP 202). The relay confirms the subscription
// asynchronously with its own Accept.
export const followRelay = async (
  relay: Relay,
  signingActor: Actor
): Promise<{ followActivityId: string; ok: boolean }> =>
  getTracer().startActiveSpan(
    'activities.followRelay',
    { attributes: { relayId: relay.id, inbox: relay.inboxUrl } },
    async (span) => {
      const followActivityId = `https://${signingActor.domain}/${crypto.randomUUID()}`
      const activity: FollowRequest = {
        '@context': ACTIVITY_STREAM_URL,
        id: followActivityId,
        type: 'Follow',
        actor: signingActor.id,
        object: ACTIVITY_STREAM_PUBLIC
      }
      const statusCode = await postActivityToInbox({
        span,
        inbox: relay.inboxUrl,
        currentActor: signingActor,
        activity,
        logPrefix: 'followRelay'
      })
      span.end()
      return { followActivityId, ok: statusCode === 202 }
    }
  )

// Unsubscribe from a relay: send Undo(Follow) reusing the Follow id we sent
// (relay.followActivityId), signed by the instance/federation signing actor.
export const unfollowRelay = async (
  relay: Relay,
  signingActor: Actor
): Promise<boolean> =>
  getTracer().startActiveSpan(
    'activities.unfollowRelay',
    { attributes: { relayId: relay.id, inbox: relay.inboxUrl } },
    async (span) => {
      const followActivityId =
        relay.followActivityId ??
        `https://${signingActor.domain}/${crypto.randomUUID()}`
      const activity: UndoFollow = {
        '@context': ACTIVITY_STREAM_URL,
        id: `${followActivityId}/undo`,
        type: 'Undo',
        actor: signingActor.id,
        object: {
          id: followActivityId,
          type: 'Follow',
          actor: signingActor.id,
          object: ACTIVITY_STREAM_PUBLIC
        }
      }
      const statusCode = await postActivityToInbox({
        span,
        inbox: relay.inboxUrl,
        currentActor: signingActor,
        activity,
        logPrefix: 'unfollowRelay'
      })
      span.end()
      return statusCode === 202
    }
  )

interface BlockParams {
  uri: string
  currentActor: Actor
  targetActorId: string
  signingActor?: Actor
}

export const block = async ({
  uri,
  currentActor,
  targetActorId,
  signingActor
}: BlockParams) =>
  getTracer().startActiveSpan(
    'activities.block',
    {
      attributes: {
        actorId: currentActor.id,
        targetActorId,
        uri
      }
    },
    async (span) => {
      const activity: BlockRequest = {
        '@context': ACTIVITY_STREAM_URL,
        id: uri,
        type: 'Block',
        actor: currentActor.id,
        object: targetActorId
      }

      const person = await getActorPerson({
        actorId: targetActorId,
        signingActor
      })
      const targetInbox = person?.inbox ?? `${targetActorId}/inbox`

      const statusCode = await postActivityToInbox({
        span,
        inbox: targetInbox,
        currentActor,
        activity,
        logPrefix: 'block'
      })
      span.end()
      return { ok: statusCode === 202, uri }
    }
  )

interface FlagParams {
  uri: string
  currentActor: Actor
  targetActorId: string
  objects: string | string[]
  content: string
  signingActor?: Actor
}

export const sendFlag = async ({
  uri,
  currentActor,
  targetActorId,
  objects,
  content,
  signingActor
}: FlagParams) =>
  getTracer().startActiveSpan(
    'activities.sendFlag',
    {
      attributes: {
        actorId: currentActor.id,
        targetActorId,
        uri
      }
    },
    async (span) => {
      const activity: FlagRequest = {
        '@context': ACTIVITY_STREAM_URL,
        id: uri,
        type: 'Flag',
        actor: currentActor.id,
        content,
        object: objects
      }

      const person = await getActorPerson({
        actorId: targetActorId,
        signingActor
      })
      const targetInbox = person?.inbox ?? `${targetActorId}/inbox`

      const statusCode = await postActivityToInbox({
        span,
        inbox: targetInbox,
        currentActor,
        activity,
        logPrefix: 'sendFlag'
      })
      span.end()
      return { ok: statusCode === 202, uri }
    }
  )

export const unblock = async (
  currentActor: Actor,
  block: DomainBlock,
  signingActor?: Actor
) =>
  getTracer().startActiveSpan(
    'activities.unblock',
    {
      attributes: {
        actorId: currentActor.id,
        block: block.id
      }
    },
    async (span) => {
      const activity: UndoBlock = {
        '@context': ACTIVITY_STREAM_URL,
        id: `${block.uri}/undo`,
        type: 'Undo',
        actor: currentActor.id,
        object: {
          id: block.uri,
          type: 'Block',
          actor: block.actorId,
          object: block.targetActorId
        }
      }

      const person = await getActorPerson({
        actorId: block.targetActorId,
        signingActor
      })
      const targetInbox = person?.inbox ?? `${block.targetActorId}/inbox`

      const statusCode = await postActivityToInbox({
        span,
        inbox: targetInbox,
        currentActor,
        activity,
        logPrefix: 'unblock'
      })
      span.end()
      return statusCode === 202
    }
  )

export const acceptFollow = async (
  currentActor: Actor,
  followingInbox: string,
  followRequest: FollowRequest
) =>
  getTracer().startActiveSpan(
    'activities.acceptFollow',
    {
      attributes: {
        actorId: currentActor.id,
        followingInbox
      }
    },
    async (span) => {
      const activity: AcceptFollow = {
        '@context': ACTIVITY_STREAM_URL,
        id: `${currentActor.id}#accepts/followers`,
        type: 'Accept',
        actor: currentActor.id,
        object: {
          id: followRequest.id,
          type: 'Follow',
          actor: followRequest.actor,
          object: followRequest.object
        }
      }
      const statusCode = await postActivityToInbox({
        span,
        inbox: followingInbox,
        currentActor,
        activity,
        logPrefix: 'acceptFollow'
      })
      span.end()
      return statusCode === 202
    }
  )

export const rejectFollow = async (
  currentActor: Actor,
  followingInbox: string,
  followRequest: FollowRequest
) =>
  getTracer().startActiveSpan(
    'activities.rejectFollow',
    {
      attributes: {
        actorId: currentActor.id,
        followingInbox
      }
    },
    async (span) => {
      const activity: RejectFollow = {
        '@context': ACTIVITY_STREAM_URL,
        id: `${currentActor.id}#rejects/followers`,
        type: 'Reject',
        actor: currentActor.id,
        object: {
          id: followRequest.id,
          type: 'Follow',
          actor: followRequest.actor,
          object: followRequest.object
        }
      }
      const statusCode = await postActivityToInbox({
        span,
        inbox: followingInbox,
        currentActor,
        activity,
        logPrefix: 'rejectFollow'
      })
      span.end()
      return statusCode === 202
    }
  )

const statusIdHash = (statusId: string) =>
  crypto.createHash('md5').update(statusId).digest('hex')

interface LikeParams {
  currentActor: Actor
  status: Status
}
export const sendLike = async ({ currentActor, status }: LikeParams) =>
  getTracer().startActiveSpan(
    'activities.sendLike',
    { attributes: { actorId: currentActor.id, statusId: status.id } },
    async (span) => {
      if (!status.actor) return

      const activity: LikeStatus = {
        '@context': ACTIVITY_STREAM_URL,
        id: `${currentActor.id}#likes/${statusIdHash(status.id)}`,
        type: 'Like',
        actor: currentActor.id,
        object: status.id
      }
      await postActivityToInbox({
        span,
        inbox: status.actor.inboxUrl,
        currentActor,
        activity,
        logPrefix: 'sendLike'
      })
      span.end()
    }
  )

interface UndoLikeParams {
  currentActor: Actor
  status: Status
}
export const sendUndoLike = async ({ currentActor, status }: UndoLikeParams) =>
  getTracer().startActiveSpan(
    'activities.sendUndoLike',
    { attributes: { actorId: currentActor.id, statusId: status.id } },
    async (span) => {
      if (!status.actor) return

      const activity: UndoLike = {
        '@context': ACTIVITY_STREAM_URL,
        id: `${currentActor.id}/#likes/${statusIdHash(status.id)}/undo`,
        type: 'Undo',
        actor: currentActor.id,
        object: {
          id: `${currentActor.id}/#likes/${statusIdHash(status.id)}`,
          type: 'Like',
          actor: currentActor.id,
          object: status.id
        }
      }
      await postActivityToInbox({
        span,
        inbox: status.actor.inboxUrl,
        currentActor,
        activity,
        logPrefix: 'sendUndoLike'
      })
      span.end()
    }
  )

interface SendPollVotesParams {
  currentActor: Actor
  status: StatusPoll
  choices: number[]
}

export const sendPollVotes = async ({
  currentActor,
  status,
  choices
}: SendPollVotesParams) =>
  getTracer().startActiveSpan(
    'activities.sendPollVotes',
    {
      attributes: {
        actorId: currentActor.id,
        statusId: status.id,
        choices: choices.join(',')
      }
    },
    async (span) => {
      if (!status.actor) return

      for (const choiceIndex of choices) {
        const choice = status.choices[choiceIndex]
        if (!choice) continue

        const voteId = `${currentActor.id}#votes/${crypto.randomUUID()}`

        const voteNote = {
          id: voteId,
          type: 'Note' as const,
          attributedTo: currentActor.id,
          inReplyTo: status.id,
          name: choice.title,
          to: [status.actorId],
          cc: [],
          tag: [],
          published: getISOTimeUTC(Date.now())
        }

        const activity: CreateStatus = {
          '@context': ACTIVITY_STREAM_URL,
          id: `${voteId}/activity`,
          type: CreateAction,
          actor: currentActor.id,
          published: voteNote.published,
          to: voteNote.to,
          cc: [],
          object: voteNote
        }

        await postActivityToInbox({
          span,
          inbox: status.actor.inboxUrl,
          currentActor,
          activity,
          logPrefix: 'sendPollVotes'
        })
      }

      span.end()
    }
  )
