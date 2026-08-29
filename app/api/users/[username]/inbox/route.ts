import { trace } from '@opentelemetry/api'
import { z } from 'zod'

import { getForwardedJobMessage } from '@/app/api/inbox/getForwardedJobMessage'
import { getJobMessage } from '@/app/api/inbox/getJobMessage'
import { acceptFollowRequest } from '@/lib/actions/acceptFollowRequest'
import {
  acceptRelayRequest,
  rejectRelayRequest
} from '@/lib/actions/acceptRelayRequest'
import { applyRemoteBlock } from '@/lib/actions/applyRemoteBlock'
import { applyRemoteUnblock } from '@/lib/actions/applyRemoteUnblock'
import { createFollower } from '@/lib/actions/createFollower'
import {
  emojiReactionRequest,
  getReactionContent,
  undoEmojiReactionRequest
} from '@/lib/actions/emojiReaction'
import { handleQuoteResponse } from '@/lib/actions/handleQuoteResponse'
import { likeRequest } from '@/lib/actions/like'
import { rejectFollowRequest } from '@/lib/actions/rejectFollowRequest'
import { undoFollowRequest } from '@/lib/actions/undoFollowRequest'
import { FollowRequest } from '@/lib/activities/followAction'
import { compactActivityPub } from '@/lib/activities/jsonld'
import { StatusActivity } from '@/lib/activities/statusAction'
import { UndoFollow } from '@/lib/activities/undoFollow'
import { HANDLE_QUOTE_REQUEST_JOB_NAME } from '@/lib/jobs/names'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { isFederationSigningActor } from '@/lib/services/federation/instanceActor'
import { ActivityPubVerifySenderGuard } from '@/lib/services/guards/ActivityPubVerifyGuard'
import {
  OnlyLocalUserGuard,
  OnlyLocalUserGuardParams
} from '@/lib/services/guards/OnlyLocalUserGuard'
import {
  annotateInboxRejection,
  getActivityTraceAttributes
} from '@/lib/services/guards/inboxRejectionTrace'
import { getQueue } from '@/lib/services/queue'
import {
  Accept,
  Block,
  EmojiReact,
  Follow,
  Like,
  Reject,
  Undo
} from '@/lib/types/activitypub'
import { normalizeActorId } from '@/lib/utils/activitypub'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { HttpMethod } from '@/lib/utils/http-headers'
import { logger } from '@/lib/utils/logger'
import {
  DEFAULT_202,
  ERROR_403,
  ERROR_404,
  ERROR_500,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { toLoggableError } from '@/lib/utils/toLoggableError'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { isRecord } from '@/lib/utils/typeGuards'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]
const GracefullyAcceptedActivity = z
  .object({
    id: z.string(),
    type: z.enum(['Flag', 'Move', 'Add', 'Remove']),
    actor: z.string()
  })
  .passthrough()
// FEP-044f: a remote actor asks to quote one of our statuses. Parsed leniently
// here (the handler re-validates); the passthrough keeps `object`/`instrument`.
const InboundQuoteRequest = z
  .object({
    id: z.string(),
    type: z.literal('QuoteRequest'),
    actor: z.string()
  })
  .passthrough()
// FEP-044f: the quoted author settles our QuoteRequest with an Accept/Reject
// whose `object` is that QuoteRequest — embedded, or as a bare id after
// compaction — and never a Follow. The shared Accept/Reject schemas model only
// the follow handshake (`object: Follow`), so without this lenient member the
// union rejects a quote response with a 400 and `handleQuoteResponse` below is
// never consulted, leaving every approved outbound quote stuck as `pending`.
// Listed after Accept/Reject so a follow handshake keeps the strict parse (and
// its narrowed type) rather than falling into the passthrough member. That is a
// readability preference, not a correctness requirement: the `safeParse`
// re-narrowing in each branch below recovers the strict shape either way,
// because a passthrough parse preserves `object` verbatim.
const InboundQuoteResponse = z
  .object({
    id: z.string(),
    type: z.enum(['Accept', 'Reject']),
    actor: z.string()
  })
  .passthrough()
const ReferenceUndo = z
  .object({
    id: z.string(),
    actor: z.string(),
    type: z.literal('Undo'),
    object: z.union([
      z.string(),
      z
        .object({
          type: z.string()
        })
        .passthrough()
    ])
  })
  .passthrough()
const Activity = z.union([
  Accept,
  Reject,
  InboundQuoteResponse,
  Follow,
  Block,
  EmojiReact,
  Like,
  Undo,
  ReferenceUndo,
  InboundQuoteRequest,
  GracefullyAcceptedActivity
])

// An Accept/Reject delivered to the instance/federation signing actor is a
// relay handshake response. Parse it leniently: relays echo the Follow we sent
// either as the full object or as a bare id string.
const RelayHandshake = z
  .object({
    id: z.string(),
    actor: z.string(),
    type: z.enum(['Accept', 'Reject']),
    object: z.union([z.string(), z.object({ id: z.string() }).passthrough()])
  })
  .passthrough()

const actorIdsMatch = (firstActorId: string, secondActorId: string) => {
  const normalizedFirstActorId = normalizeActorId(firstActorId)
  const normalizedSecondActorId = normalizeActorId(secondActorId)

  return (
    Boolean(normalizedFirstActorId) &&
    normalizedFirstActorId === normalizedSecondActorId
  )
}

const logAcceptedWithoutSideEffects = ({
  activity,
  reason
}: {
  activity: { id?: string; type: string; actor?: string }
  reason: string
}) => {
  logger.info({
    message: 'Accepted ActivityPub inbox activity without local side effects',
    activityId: activity.id,
    activityType: activity.type,
    actorId: activity.actor,
    reason
  })
}

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const POST = traceApiRoute(
  'actorInbox',
  ActivityPubVerifySenderGuard<OnlyLocalUserGuardParams>(
    (req, context) =>
      OnlyLocalUserGuard(
        async (database, actor, req) => {
          try {
            // A FORWARDED delivery (HTTP signer !== activity actor — AP
            // §7.1.2 inbox forwarding) carries an unverified payload; no
            // handler below may act on it. Status-level activities go to the
            // origin re-fetch job; everything else — Follow, Accept/Reject
            // (including relay handshakes), Like, Undo — is acknowledged and
            // dropped, matching Mastodon's handling of non-LD-signed
            // forwards.
            if (context.forwarded) {
              const compactedForwarded = await compactActivityPub(
                context.activityBody
              )
              const forwardedActor =
                isRecord(compactedForwarded) &&
                typeof compactedForwarded.actor === 'string'
                  ? compactedForwarded.actor
                  : null
              if (
                forwardedActor &&
                (await canFederateWithDomain(database, forwardedActor))
              ) {
                const forwardedJobMessage = isRecord(compactedForwarded)
                  ? getForwardedJobMessage(
                      compactedForwarded as unknown as StatusActivity
                    )
                  : null
                if (forwardedJobMessage) {
                  await getQueue().publish(forwardedJobMessage)
                } else {
                  logAcceptedWithoutSideEffects({
                    activity: compactedForwarded as {
                      id?: string
                      type: string
                      actor?: string
                    },
                    reason:
                      'forwarded activity without an origin verification path'
                  })
                }
              }
              return apiResponse({
                req,
                allowedMethods: CORS_HEADERS,
                data: DEFAULT_202,
                responseStatusCode: 202
              })
            }

            if (isFederationSigningActor(actor)) {
              // The instance/federation signing actor only ever sends relay
              // Follows, so an Accept/Reject delivered here is a relay handshake
              // response. The HTTP-signature guard already verified the sender
              // is the relay (signer === activity.actor). Anything else is
              // accepted without side effects, preserving prior behaviour.
              const compactedHandshake = await compactActivityPub(
                context.activityBody
              )
              const relayHandshake =
                RelayHandshake.safeParse(compactedHandshake)
              if (relayHandshake.success) {
                const activity = relayHandshake.data
                if (activity.type === 'Accept') {
                  await acceptRelayRequest({ activity, database })
                } else {
                  await rejectRelayRequest({ activity, database })
                }
              }
              return apiResponse({
                req,
                allowedMethods: CORS_HEADERS,
                data: DEFAULT_202,
                responseStatusCode: 202
              })
            }

            const compactedActivity = await compactActivityPub(
              context.activityBody
            )
            const activityActor =
              isRecord(compactedActivity) &&
              typeof compactedActivity.actor === 'string'
                ? compactedActivity.actor
                : context.verifiedSenderActorId

            if (!(await canFederateWithDomain(database, activityActor))) {
              annotateInboxRejection('domain_not_federatable', {
                actor_id: activityActor,
                sender_actor_id: context.verifiedSenderActorId,
                ...getActivityTraceAttributes(compactedActivity)
              })
              return apiResponse({
                req,
                allowedMethods: CORS_HEADERS,
                data: ERROR_403,
                responseStatusCode: 403
              })
            }

            // Swallow activities from a suspended remote actor: acknowledge
            // with 202 but apply no local side effects. A 403 would leak the
            // moderation decision back to the sender.
            const senderStates = await database.getModerationStatesForActors({
              actorIds: [context.verifiedSenderActorId]
            })
            if (senderStates.get(context.verifiedSenderActorId)?.suspendedAt) {
              return apiResponse({
                req,
                allowedMethods: CORS_HEADERS,
                data: DEFAULT_202,
                responseStatusCode: 202
              })
            }

            // Peers may deliver status-level activities (Create, Update, Delete,
            // Announce, Undo of Announce) to personal inboxes. Route them through
            // the shared job queue just like the shared inbox does.
            const isStatusLevelActivity =
              isRecord(compactedActivity) &&
              (compactedActivity.type === 'Create' ||
                compactedActivity.type === 'Update' ||
                compactedActivity.type === 'Delete' ||
                compactedActivity.type === 'Announce' ||
                (compactedActivity.type === 'Undo' &&
                  isRecord(compactedActivity.object) &&
                  compactedActivity.object.type === 'Announce'))

            if (isStatusLevelActivity) {
              const jobMessage = getJobMessage(
                compactedActivity as unknown as StatusActivity,
                context.verifiedSenderActorId
              )
              if (jobMessage) {
                await getQueue().publish(jobMessage)
              } else {
                logAcceptedWithoutSideEffects({
                  activity: compactedActivity as {
                    id?: string
                    type: string
                    actor?: string
                  },
                  reason: 'unmatched status activity'
                })
              }
              return apiResponse({
                req,
                allowedMethods: CORS_HEADERS,
                data: DEFAULT_202,
                responseStatusCode: 202
              })
            }

            const parsed = Activity.safeParse(compactedActivity)
            if (!parsed.success) {
              logAcceptedWithoutSideEffects({
                activity: isRecord(compactedActivity)
                  ? (compactedActivity as {
                      id?: string
                      type: string
                      actor?: string
                    })
                  : { type: 'unknown' },
                reason: 'unsupported activity shape'
              })
              return apiResponse({
                req,
                allowedMethods: CORS_HEADERS,
                data: DEFAULT_202,
                responseStatusCode: 202
              })
            }

            const activity = parsed.data

            switch (activity.type) {
              case 'Accept': {
                // A remote author accepting our QuoteRequest is matched first;
                // it falls through to the follow handshake on no match.
                if (
                  await handleQuoteResponse({
                    database,
                    activity: compactedActivity,
                    verifiedSenderActorId: context.verifiedSenderActorId
                  })
                ) {
                  return apiResponse({
                    req,
                    allowedMethods: CORS_HEADERS,
                    data: DEFAULT_202,
                    responseStatusCode: 202
                  })
                }
                // Not a quote response: fall through to the follow handshake,
                // which needs the strict Accept(Follow) shape the lenient
                // quote-response member above does not carry.
                const acceptFollow = Accept.safeParse(activity)
                if (!acceptFollow.success) {
                  logAcceptedWithoutSideEffects({
                    activity,
                    reason:
                      'Accept of an object that is neither a Follow nor a known QuoteRequest'
                  })
                  return apiResponse({
                    req,
                    allowedMethods: CORS_HEADERS,
                    data: DEFAULT_202,
                    responseStatusCode: 202
                  })
                }
                const follow = await acceptFollowRequest({
                  activity: acceptFollow.data,
                  database
                })
                if (!follow) {
                  annotateInboxRejection('follow_request_not_found', {
                    sender_actor_id: context.verifiedSenderActorId,
                    ...getActivityTraceAttributes(activity)
                  })
                  return apiResponse({
                    req,
                    allowedMethods: CORS_HEADERS,
                    data: ERROR_404,
                    responseStatusCode: 404
                  })
                }
                return apiResponse({
                  req,
                  allowedMethods: CORS_HEADERS,
                  data: DEFAULT_202,
                  responseStatusCode: 202
                })
              }
              case 'Reject': {
                if (
                  await handleQuoteResponse({
                    database,
                    activity: compactedActivity,
                    verifiedSenderActorId: context.verifiedSenderActorId
                  })
                ) {
                  return apiResponse({
                    req,
                    allowedMethods: CORS_HEADERS,
                    data: DEFAULT_202,
                    responseStatusCode: 202
                  })
                }
                const rejectFollow = Reject.safeParse(activity)
                if (!rejectFollow.success) {
                  logAcceptedWithoutSideEffects({
                    activity,
                    reason:
                      'Reject of an object that is neither a Follow nor a known QuoteRequest'
                  })
                  return apiResponse({
                    req,
                    allowedMethods: CORS_HEADERS,
                    data: DEFAULT_202,
                    responseStatusCode: 202
                  })
                }
                const follow = await rejectFollowRequest({
                  activity: rejectFollow.data,
                  database
                })
                if (!follow) {
                  annotateInboxRejection('follow_request_not_found', {
                    sender_actor_id: context.verifiedSenderActorId,
                    ...getActivityTraceAttributes(activity)
                  })
                  return apiResponse({
                    req,
                    allowedMethods: CORS_HEADERS,
                    data: ERROR_404,
                    responseStatusCode: 404
                  })
                }
                return apiResponse({
                  req,
                  allowedMethods: CORS_HEADERS,
                  data: DEFAULT_202,
                  responseStatusCode: 202
                })
              }
              case 'Follow': {
                const follow = await createFollower({
                  followRequest: activity as FollowRequest,
                  database
                })
                if (!follow) {
                  annotateInboxRejection('follow_creation_failed', {
                    sender_actor_id: context.verifiedSenderActorId,
                    ...getActivityTraceAttributes(activity)
                  })
                  return apiResponse({
                    req,
                    allowedMethods: CORS_HEADERS,
                    data: ERROR_404,
                    responseStatusCode: 404
                  })
                }
                return apiResponse({
                  req,
                  allowedMethods: CORS_HEADERS,
                  data: { target: follow.object },
                  responseStatusCode: 202
                })
              }
              case 'Block': {
                const block = await applyRemoteBlock({
                  database,
                  activity,
                  targetActorId: actor.id
                })
                if (!block) {
                  annotateInboxRejection('block_failed', {
                    sender_actor_id: context.verifiedSenderActorId,
                    ...getActivityTraceAttributes(activity)
                  })
                  return apiResponse({
                    req,
                    allowedMethods: CORS_HEADERS,
                    data: ERROR_404,
                    responseStatusCode: 404
                  })
                }
                return apiResponse({
                  req,
                  allowedMethods: CORS_HEADERS,
                  data: DEFAULT_202,
                  responseStatusCode: 202
                })
              }
              case 'EmojiReact': {
                await emojiReactionRequest({ activity, database })
                return apiResponse({
                  req,
                  allowedMethods: CORS_HEADERS,
                  data: DEFAULT_202,
                  responseStatusCode: 202
                })
              }
              case 'Like': {
                // A Like carrying a reaction is a Misskey-family emoji reaction,
                // never a favourite: it must not write a `likes` row or move
                // favourites_count. A plain Like stays a favourite.
                if (getReactionContent(activity)) {
                  await emojiReactionRequest({ activity, database })
                } else {
                  await likeRequest({ activity, database })
                }
                return apiResponse({
                  req,
                  allowedMethods: CORS_HEADERS,
                  data: DEFAULT_202,
                  responseStatusCode: 202
                })
              }
              case 'Undo': {
                const undoObject = activity.object
                if (typeof undoObject === 'string') {
                  const block = await applyRemoteUnblock({
                    database,
                    actorId: activity.actor,
                    object: undoObject,
                    targetActorId: actor.id
                  })
                  if (block) {
                    return apiResponse({
                      req,
                      allowedMethods: CORS_HEADERS,
                      data: DEFAULT_202,
                      responseStatusCode: 202
                    })
                  }

                  logAcceptedWithoutSideEffects({
                    activity,
                    reason: 'reference-only Undo object'
                  })
                  return apiResponse({
                    req,
                    allowedMethods: CORS_HEADERS,
                    data: DEFAULT_202,
                    responseStatusCode: 202
                  })
                }

                const undoFollow = Follow.safeParse(undoObject)
                if (undoFollow.success) {
                  if (!actorIdsMatch(activity.actor, undoFollow.data.actor)) {
                    annotateInboxRejection('sender_actor_mismatch', {
                      verified_sender: activity.actor,
                      ...getActivityTraceAttributes(activity),
                      activity_actor: undoFollow.data.actor
                    })
                    return apiResponse({
                      req,
                      allowedMethods: CORS_HEADERS,
                      data: ERROR_403,
                      responseStatusCode: 403
                    })
                  }

                  const result = await undoFollowRequest({
                    database,
                    request: {
                      ...activity,
                      object: undoFollow.data
                    } as UndoFollow
                  })
                  if (!result) {
                    annotateInboxRejection('undo_follow_not_found', {
                      sender_actor_id: context.verifiedSenderActorId,
                      ...getActivityTraceAttributes(activity)
                    })
                    return apiResponse({
                      req,
                      allowedMethods: CORS_HEADERS,
                      data: ERROR_404,
                      responseStatusCode: 404
                    })
                  }
                  return apiResponse({
                    req,
                    allowedMethods: CORS_HEADERS,
                    data: { target: undoFollow.data.object },
                    responseStatusCode: 202
                  })
                }

                // Pleroma/Akkoma undo their own EmojiReact; Misskey undoes the
                // rendered Like, which still carries the reaction. Both remove a
                // reaction, never a favourite.
                const undoEmojiReact = EmojiReact.safeParse(undoObject)
                if (undoEmojiReact.success) {
                  await undoEmojiReactionRequest({
                    activity: { ...undoEmojiReact.data, actor: activity.actor },
                    database
                  })
                  return apiResponse({
                    req,
                    allowedMethods: CORS_HEADERS,
                    data: DEFAULT_202,
                    responseStatusCode: 202
                  })
                }

                const undoLike = Like.safeParse(undoObject)
                if (undoLike.success) {
                  if (getReactionContent(undoLike.data)) {
                    await undoEmojiReactionRequest({
                      activity: { ...undoLike.data, actor: activity.actor },
                      database
                    })
                    return apiResponse({
                      req,
                      allowedMethods: CORS_HEADERS,
                      data: DEFAULT_202,
                      responseStatusCode: 202
                    })
                  }

                  const likedObject = undoLike.data.object
                  await database.deleteLike({
                    actorId: activity.actor,
                    statusId:
                      typeof likedObject === 'string'
                        ? likedObject
                        : likedObject.id
                  })
                  return apiResponse({
                    req,
                    allowedMethods: CORS_HEADERS,
                    data: DEFAULT_202,
                    responseStatusCode: 202
                  })
                }

                const undoBlock = Block.safeParse(undoObject)
                if (undoBlock.success) {
                  if (!actorIdsMatch(activity.actor, undoBlock.data.actor)) {
                    annotateInboxRejection('sender_actor_mismatch', {
                      verified_sender: activity.actor,
                      ...getActivityTraceAttributes(activity),
                      activity_actor: undoBlock.data.actor
                    })
                    return apiResponse({
                      req,
                      allowedMethods: CORS_HEADERS,
                      data: ERROR_403,
                      responseStatusCode: 403
                    })
                  }

                  const result = await applyRemoteUnblock({
                    database,
                    actorId: activity.actor,
                    object: undoBlock.data,
                    targetActorId: actor.id
                  })
                  if (!result) {
                    annotateInboxRejection('undo_block_not_found', {
                      sender_actor_id: context.verifiedSenderActorId,
                      ...getActivityTraceAttributes(activity)
                    })
                    return apiResponse({
                      req,
                      allowedMethods: CORS_HEADERS,
                      data: ERROR_404,
                      responseStatusCode: 404
                    })
                  }
                  return apiResponse({
                    req,
                    allowedMethods: CORS_HEADERS,
                    data: DEFAULT_202,
                    responseStatusCode: 202
                  })
                }

                logAcceptedWithoutSideEffects({
                  activity,
                  reason: `unsupported Undo object type ${undoObject.type}`
                })
                return apiResponse({
                  req,
                  allowedMethods: CORS_HEADERS,
                  data: DEFAULT_202,
                  responseStatusCode: 202
                })
              }
              case 'QuoteRequest': {
                // Defer to the shared quote-request handler via the queue so the
                // authorship-verifying fetch runs in the worker rather than
                // inline in the inbox response (mirrors the shared-inbox path).
                await getQueue().publish({
                  id: getHashFromString(activity.id),
                  name: HANDLE_QUOTE_REQUEST_JOB_NAME,
                  data: compactedActivity,
                  verifiedSenderActorId: context.verifiedSenderActorId
                })
                return apiResponse({
                  req,
                  allowedMethods: CORS_HEADERS,
                  data: DEFAULT_202,
                  responseStatusCode: 202
                })
              }
              default:
                logAcceptedWithoutSideEffects({
                  activity,
                  reason: 'unsupported but accepted ActivityPub activity type'
                })
                return apiResponse({
                  req,
                  allowedMethods: CORS_HEADERS,
                  data: DEFAULT_202,
                  responseStatusCode: 202
                })
            }
          } catch (error) {
            const span = trace.getActiveSpan()
            const err =
              error instanceof Error ? error : new Error(String(error))
            span?.recordException(err)
            annotateInboxRejection('handler_exception', {
              sender_actor_id: context.verifiedSenderActorId,
              ...getActivityTraceAttributes(context.activityBody),
              error: err.message
            })
            logger.error({
              err: toLoggableError(error),
              message: 'ActivityPub inbox handler threw',
              senderActorId: context.verifiedSenderActorId
            })
            return apiResponse({
              req,
              allowedMethods: CORS_HEADERS,
              data: ERROR_500,
              responseStatusCode: 500
            })
          }
        },
        { allowFederationSigningActor: true }
      )(req, context),
    CORS_HEADERS
  )
)
