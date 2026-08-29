import { trace } from '@opentelemetry/api'

import { extractActivityPubId, normalizeActorId } from '@/lib/utils/activitypub'
import { isRecord } from '@/lib/utils/typeGuards'

const MAX_ATTRIBUTE_LENGTH = 500

const bound = (value: string): string =>
  value.length > MAX_ATTRIBUTE_LENGTH
    ? value.slice(0, MAX_ATTRIBUTE_LENGTH)
    : value

/**
 * Extracts standard ActivityPub trace attributes from an activity payload.
 */
export const getActivityTraceAttributes = (
  body: unknown
): Record<string, string | undefined> => {
  if (!isRecord(body)) return {}

  const activityId =
    typeof body.id === 'string' ? extractActivityPubId(body.id) : undefined

  const activityType =
    typeof body.type === 'string'
      ? body.type
      : Array.isArray(body.type)
        ? body.type.filter((t): t is string => typeof t === 'string').join(',')
        : undefined

  const rawActor = extractActivityPubId(body.actor)
  const activityActor = rawActor
    ? (normalizeActorId(rawActor) ?? rawActor)
    : undefined

  let objectId: string | undefined
  let objectType: string | undefined

  if (typeof body.object === 'string') {
    objectId = extractActivityPubId(body.object)
  } else if (isRecord(body.object)) {
    if (typeof body.object.id === 'string') {
      objectId = extractActivityPubId(body.object.id)
    }
    if (typeof body.object.type === 'string') {
      objectType = body.object.type
    } else if (Array.isArray(body.object.type)) {
      objectType = body.object.type
        .filter((t): t is string => typeof t === 'string')
        .join(',')
    }
  }

  let targetId: string | undefined
  if (typeof body.target === 'string') {
    targetId = extractActivityPubId(body.target)
  } else if (isRecord(body.target) && typeof body.target.id === 'string') {
    targetId = extractActivityPubId(body.target.id)
  }

  return {
    activity_id: activityId,
    activity_type: activityType,
    activity_actor: activityActor,
    activity_object_id: objectId,
    activity_object_type: objectType,
    activity_target_id: targetId
  }
}

/**
 * Stamps the rejection reason for an ActivityPub inbox request onto the
 * request's existing traceApiRoute span (api.sharedInbox /
 * api.actorInbox). Never creates a span; a missing or non-recording
 * active span makes this a no-op, matching the repo-wide "tracing off is
 * free" rule in lib/utils/trace.ts.
 */
export const annotateInboxRejection = (
  reason: string,
  extra: Record<string, string | number | boolean | string[] | undefined> = {}
): void => {
  try {
    const span = trace.getActiveSpan()
    if (!span || !span.isRecording()) return
    span.setAttribute('inbox.reject_reason', reason)
    for (const [key, value] of Object.entries(extra)) {
      if (value === undefined) continue
      span.setAttribute(
        `inbox.${key}`,
        typeof value === 'string'
          ? bound(value)
          : Array.isArray(value)
            ? value.map((item) => bound(item))
            : value
      )
    }
  } catch {
    // Tracing failures must never alter response handling
  }
}

/**
 * Stamps a forwarded (accepted, signer !== activity actor) delivery onto the
 * request's span. Attributes only — a forwarded delivery is not a rejection,
 * so it must not read as one in traces.
 */
export const annotateInboxForwarded = ({
  verifiedSender,
  activityActor
}: {
  verifiedSender: string
  activityActor?: string
}): void => {
  try {
    const span = trace.getActiveSpan()
    if (!span || !span.isRecording()) return
    span.setAttribute('inbox.forwarded', true)
    span.setAttribute('inbox.verified_sender', bound(verifiedSender))
    if (activityActor) {
      span.setAttribute('inbox.activity_actor', bound(activityActor))
    }
  } catch {
    // Tracing failures must never alter response handling
  }
}
