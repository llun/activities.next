import isMatch from 'lodash/isMatch'

import { getInboxJobId } from '@/app/api/inbox/getInboxJobId'
import { StatusActivity } from '@/lib/activities/statusAction'
import {
  CREATE_ANNOUNCE_JOB_NAME,
  CREATE_NOTE_JOB_NAME,
  CREATE_POLL_JOB_NAME,
  CREATE_POLL_VOTE_JOB_NAME,
  DELETE_OBJECT_JOB_NAME,
  EMOJI_REACTION_JOB_NAME,
  HANDLE_QUOTE_REQUEST_JOB_NAME,
  UPDATE_ACTOR_JOB_NAME,
  UPDATE_NOTE_JOB_NAME,
  UPDATE_POLL_JOB_NAME
} from '@/lib/jobs/names'
import type { JobMessage } from '@/lib/services/queue/type'
import { ENTITY_TYPE_NOTE, ENTITY_TYPE_QUESTION } from '@/lib/types/activitypub'
import {
  AnnounceAction,
  CreateAction,
  DeleteAction,
  ENTITY_TYPE_EMOJI_REACT,
  ENTITY_TYPE_LIKE,
  UndoAction,
  UpdateAction
} from '@/lib/types/activitypub/activities'
import { ACTOR_TYPES } from '@/lib/types/domain/actor'
import {
  extractActivityPubId,
  isSameActivityPubOrigin,
  normalizeActorId
} from '@/lib/utils/activitypub'
import { isRecord } from '@/lib/utils/typeGuards'

import { getForwardedJobMessage } from './getForwardedJobMessage'

const ENTITY_TYPE_IMAGE = 'Image'
const ENTITY_TYPE_PAGE = 'Page'
const ENTITY_TYPE_ARTICLE = 'Article'
const ENTITY_TYPE_VIDEO = 'Video'

const NOTE_TYPES = [
  ENTITY_TYPE_NOTE,
  ENTITY_TYPE_IMAGE,
  ENTITY_TYPE_PAGE,
  ENTITY_TYPE_ARTICLE,
  ENTITY_TYPE_VIDEO
]

const createJobMessage = ({
  data,
  id,
  name,
  verifiedSenderActorId
}: JobMessage) => {
  const normalizedVerifiedSenderActorId = normalizeActorId(
    verifiedSenderActorId
  )

  return {
    id,
    name,
    data,
    ...(normalizedVerifiedSenderActorId
      ? { verifiedSenderActorId: normalizedVerifiedSenderActorId }
      : {})
  }
}

const activityActorMismatch = (
  activity: StatusActivity,
  verifiedSenderActorId: string
) => {
  const normalizedVerifiedSenderActorId = normalizeActorId(
    verifiedSenderActorId
  )
  const normalizedActivityActorId = normalizeActorId(
    extractActivityPubId(activity.actor)
  )

  return (
    !normalizedVerifiedSenderActorId ||
    !normalizedActivityActorId ||
    normalizedActivityActorId !== normalizedVerifiedSenderActorId
  )
}

const extractActivityPubIds = (value: unknown): string[] => {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(extractActivityPubIds)
  if (!isRecord(value)) return []

  if (typeof value.id === 'string') return [value.id]
  if (typeof value.href === 'string') return [value.href]
  if (typeof value.url === 'string') return [value.url]
  return []
}

// A reaction-bearing activity is either a litepub `EmojiReact` or a
// Misskey-style `Like` whose emoji rides on `content`/`_misskey_reaction`. A
// plain `Like` is NOT one: favourites are not routed from the shared inbox
// today, and quietly starting to would change favourite semantics here.
const isReactionBearing = (value: unknown): boolean => {
  if (!isRecord(value)) return false
  if (value.type === ENTITY_TYPE_EMOJI_REACT) return true
  if (value.type !== ENTITY_TYPE_LIKE) return false
  return (
    typeof value._misskey_reaction === 'string' ||
    typeof value.content === 'string'
  )
}

// Binds a Create/Update payload to the HTTP signer and returns the payload the
// job should store, or null when the signer did not author it.
//
// `attributedTo` may name several authors: PeerTube attributes a Video to the
// uploading account AND its channel (a Group), and signs with the account. The
// signer only has to be ONE of the authors, and every co-author must live on
// the signer's own origin, so a sender cannot list a third party's actor as a
// co-author. Any `actor` the object carries must still be the signer itself.
//
// The returned copy has `attributedTo` pinned to the signer's own entry.
// `normalizeActivityPubContent` stores the FIRST id of an array, so without the
// pin a `[channel, account]` ordering would store the channel as the author
// (and the job's own signer check would then drop it), and `[victim, self]`
// would only be safe because of that downstream check.
const bindObjectToSender = <T extends Record<string, unknown>>(
  object: T,
  verifiedSenderActorId: string
): T | null => {
  const normalizedVerifiedSenderActorId = normalizeActorId(
    verifiedSenderActorId
  )
  if (!normalizedVerifiedSenderActorId) return null

  const authorIds = extractActivityPubIds(object.attributedTo)
  const objectActorIds = extractActivityPubIds(object.actor)
  if (authorIds.length === 0 && objectActorIds.length === 0) return null

  const isSender = (actorId: string) =>
    normalizeActorId(actorId) === normalizedVerifiedSenderActorId

  if (!objectActorIds.every(isSender)) return null
  if (authorIds.length === 0) return object

  const senderAuthorId = authorIds.find(isSender)
  if (!senderAuthorId) return null
  if (
    !authorIds.every((actorId) =>
      isSameActivityPubOrigin(actorId, normalizedVerifiedSenderActorId)
    )
  ) {
    return null
  }

  return { ...object, attributedTo: senderAuthorId }
}

// An Announce whose `object` is itself an activity: an embedded record with
// an `actor` and an `object`. A boosted Note/Page has neither an `actor` nor
// an `object`, so a plain boost never matches.
const getWrappedActivity = (object: unknown): StatusActivity | null => {
  if (!isRecord(object)) return null
  if (typeof object.type !== 'string') return null
  const actor = extractActivityPubId(object.actor)
  if (!actor) return null
  if (!('object' in object) || object.object === undefined) return null
  return { ...object, actor } as unknown as StatusActivity
}

const isActorType = (type: unknown) =>
  typeof type === 'string' && (ACTOR_TYPES as readonly string[]).includes(type)

// An Update whose object is an actor (Mastodon, Misskey, GoToSocial and
// Pleroma all send one when a profile changes). Returns `undefined` when the
// object is not an actor, so the caller goes on to the note and poll updates;
// `null` when it is one but may not be applied. Only an actor may update
// itself: the signer, the activity's actor and the object must be the same id.
// The job re-fetches the profile from origin rather than trusting this body.
export const getActorUpdateJobMessage = (
  activity: StatusActivity,
  verifiedSenderActorId: string,
  deduplicationId: string
) => {
  const object: unknown = activity.object
  const objectId = extractActivityPubId(object)
  const isActorObject = isRecord(object)
    ? isActorType(object.type)
    : // A bare id can only be read as a profile update when it names the actor.
      typeof objectId === 'string' &&
      normalizeActorId(objectId) ===
        normalizeActorId(extractActivityPubId(activity.actor))
  if (!isActorObject) return undefined

  const normalizedSenderId = normalizeActorId(verifiedSenderActorId)
  if (
    !normalizedSenderId ||
    activityActorMismatch(activity, verifiedSenderActorId) ||
    normalizeActorId(objectId) !== normalizedSenderId
  ) {
    return null
  }

  return createJobMessage({
    id: deduplicationId,
    name: UPDATE_ACTOR_JOB_NAME,
    data: { actorId: verifiedSenderActorId },
    verifiedSenderActorId
  })
}

export const getJobMessage = (
  activity: StatusActivity,
  verifiedSenderActorId: string
) => {
  if (!activity.id || typeof activity.id !== 'string') {
    return null
  }

  const deduplicationId = getInboxJobId(activity.id)

  if (activity.type === CreateAction) {
    if (
      typeof activity.object === 'object' &&
      activity.object !== null &&
      NOTE_TYPES.includes(activity.object.type)
    ) {
      const object = bindObjectToSender(activity.object, verifiedSenderActorId)
      if (!object) return null

      if (
        activity.object.type === ENTITY_TYPE_NOTE &&
        activity.object.inReplyTo &&
        'name' in activity.object &&
        activity.object.name &&
        !activity.object.content
      ) {
        return createJobMessage({
          id: deduplicationId,
          name: CREATE_POLL_VOTE_JOB_NAME,
          data: object,
          verifiedSenderActorId
        })
      }

      return createJobMessage({
        id: deduplicationId,
        name: CREATE_NOTE_JOB_NAME,
        data: object,
        verifiedSenderActorId
      })
    }

    if (
      typeof activity.object === 'object' &&
      activity.object !== null &&
      activity.object.type === ENTITY_TYPE_QUESTION
    ) {
      const object = bindObjectToSender(activity.object, verifiedSenderActorId)
      if (!object) return null

      return createJobMessage({
        id: deduplicationId,
        name: CREATE_POLL_JOB_NAME,
        data: object,
        verifiedSenderActorId
      })
    }
  }

  if (activity.type === UpdateAction) {
    const actorUpdateMessage = getActorUpdateJobMessage(
      activity,
      verifiedSenderActorId,
      deduplicationId
    )
    if (actorUpdateMessage !== undefined) return actorUpdateMessage

    if (
      typeof activity.object === 'object' &&
      activity.object !== null &&
      activity.object.type === ENTITY_TYPE_QUESTION
    ) {
      const object = bindObjectToSender(activity.object, verifiedSenderActorId)
      if (!object) return null

      return createJobMessage({
        id: deduplicationId,
        name: UPDATE_POLL_JOB_NAME,
        data: object,
        verifiedSenderActorId
      })
    }

    if (
      typeof activity.object === 'object' &&
      activity.object !== null &&
      NOTE_TYPES.includes(activity.object.type)
    ) {
      const object = bindObjectToSender(activity.object, verifiedSenderActorId)
      if (!object) return null

      return createJobMessage({
        id: deduplicationId,
        name: UPDATE_NOTE_JOB_NAME,
        data: object,
        verifiedSenderActorId
      })
    }
  }

  if (isMatch(activity, { type: AnnounceAction })) {
    if (activityActorMismatch(activity, verifiedSenderActorId)) {
      return null
    }

    // A Lemmy/Mbin/Kbin community (a `Group`) relays its members' activity by
    // wrapping the whole activity in an Announce — `Announce(Update(Page))`,
    // `Announce(Delete(id))`, `Announce(Like)` — rather than boosting an
    // object. The group signed the Announce, not the inner activity, so the
    // inner payload is unverified exactly like an inbox-forwarded one: route
    // it through the same origin re-fetch job, which trusts only the object id
    // and only when it lives on the inner actor's own origin. Inner activities
    // that job cannot verify (Like, Dislike, Undo, ...) are dropped rather than
    // being mistaken for a boost of the activity's own id. `Announce(Create)`
    // stays on the boost path below.
    const wrappedActivity = getWrappedActivity(activity.object)
    if (wrappedActivity && wrappedActivity.type !== CreateAction) {
      // The re-fetch job dedups on the inner id, so it must live on the inner
      // actor's origin: otherwise a signer could spend the dedup key of
      // another server's activity with a mangled copy that fails verification.
      if (
        typeof wrappedActivity.id !== 'string' ||
        !isSameActivityPubOrigin(wrappedActivity.id, wrappedActivity.actor)
      ) {
        return null
      }
      return getForwardedJobMessage(wrappedActivity)
    }

    return createJobMessage({
      id: deduplicationId,
      name: CREATE_ANNOUNCE_JOB_NAME,
      data: activity,
      verifiedSenderActorId
    })
  }

  if (
    isMatch(activity, { type: UndoAction, object: { type: AnnounceAction } }) ||
    isMatch(activity, { type: DeleteAction })
  ) {
    if (activityActorMismatch(activity, verifiedSenderActorId)) {
      return null
    }

    return createJobMessage({
      id: deduplicationId,
      name: DELETE_OBJECT_JOB_NAME,
      data: activity.object,
      verifiedSenderActorId
    })
  }

  // Emoji reactions delivered to the shared inbox (Pleroma-family delivery may
  // target it instead of the recipient's personal inbox). Both dialects and the
  // Undo of each route to one job; a plain Like still falls through to `null`.
  if (
    isReactionBearing(activity) ||
    (activity.type === UndoAction && isReactionBearing(activity.object))
  ) {
    if (activityActorMismatch(activity, verifiedSenderActorId)) {
      return null
    }

    return createJobMessage({
      id: deduplicationId,
      name: EMOJI_REACTION_JOB_NAME,
      data: activity,
      verifiedSenderActorId
    })
  }

  // FEP-044f QuoteRequest delivered to the shared inbox (some servers deliver
  // everything here). The job resolves the quoted status's local author.
  if (isMatch(activity, { type: 'QuoteRequest' })) {
    if (activityActorMismatch(activity, verifiedSenderActorId)) {
      return null
    }

    return createJobMessage({
      id: deduplicationId,
      name: HANDLE_QUOTE_REQUEST_JOB_NAME,
      data: activity,
      verifiedSenderActorId
    })
  }

  return null
}
