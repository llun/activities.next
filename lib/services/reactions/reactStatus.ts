import { sendReaction, sendUndoReaction } from '@/lib/activities'
import { Database } from '@/lib/database/types'
import { createNotificationWithPolicy } from '@/lib/services/notifications/createNotificationWithPolicy'
import { sendNotificationAlerts } from '@/lib/services/notifications/sendNotificationAlerts'
import { shouldCreateNotification } from '@/lib/services/notifications/shouldNotify'
import {
  getCustomEmojiShortcode,
  isUnicodeEmojiReaction,
  normalizeStoredReactionName
} from '@/lib/services/reactions/reactionName'
import { getReadableStatus } from '@/lib/services/statusRouteAccess'
import { MAX_REACTIONS_PER_ACTOR } from '@/lib/services/statuses/reactionLimits'
import { NotificationType } from '@/lib/types/database/operations'
import { Actor } from '@/lib/types/domain/actor'
import { CustomEmojiData } from '@/lib/types/domain/customEmoji'
import { Status, getOriginalStatus } from '@/lib/types/domain/status'

import { getReactionGroupKey } from './reactionGroupKey'

interface ReactStatusParams {
  database: Database
  currentActor: Actor
  statusId: string
  name: string
}

export type ReactStatusResult =
  | { ok: true; changed: boolean; status: Status }
  // The status does not exist, or the actor cannot read it. Both answer 404 so
  // an unreadable status is indistinguishable from a missing one.
  | { ok: false; reason: 'not-found' }
  // Not something this instance can render or federate: not a single emoji
  // grapheme, and not a shortcode naming an enabled local custom emoji.
  | { ok: false; reason: 'invalid-emoji' }
  // The actor already holds MAX_REACTIONS_PER_ACTOR distinct reactions here.
  // Reported rather than silently dropped: the storage layer would no-op, and
  // the client would see a 200 whose Status does not contain its reaction.
  | { ok: false; reason: 'cap-reached' }

type ResolvedReaction = { name: string; customEmoji: CustomEmojiData | null }

/**
 * Resolve what a locally-authored reaction is allowed to be. Inbound federation
 * is deliberately liberal, but a reaction we originate has to round-trip: a
 * unicode emoji is stored as itself, a shortcode only when it names an enabled
 * custom emoji on this instance (which is also what supplies the outbound
 * `Emoji` tag). A `shortcode@domain` reference is rejected — this instance
 * cannot vouch for another's emoji.
 */
const resolveLocalReaction = async (
  database: Database,
  name: string
): Promise<ResolvedReaction | null> => {
  if (isUnicodeEmojiReaction(name)) return { name, customEmoji: null }

  const shortcode = getCustomEmojiShortcode(name)
  if (!shortcode) return null

  const customEmoji = await database.getCustomEmojiByShortcode(shortcode)
  if (!customEmoji || customEmoji.disabled) return null
  return { name: customEmoji.shortcode, customEmoji }
}

// A reaction on a status this instance hosts notifies the author directly; one
// on a remote status federates to its author's inbox. The two are exclusive:
// federating to a local author would post to our own inbox, and the inbound
// handler would then find the reaction already stored and skip the notification.
const announceReaction = async ({
  database,
  currentActor,
  status,
  reaction,
  customEmoji
}: {
  database: Database
  currentActor: Actor
  status: Status
  reaction: string
  customEmoji: CustomEmojiData | null
}) => {
  if (!status.isLocalActor) {
    await sendReaction({ currentActor, status, reaction, customEmoji })
    return
  }

  if (
    !(await shouldCreateNotification(database, status.actorId, currentActor.id))
  ) {
    return
  }

  const notification = await createNotificationWithPolicy(database, {
    actorId: status.actorId,
    type: NotificationType.enum.emoji_reaction,
    sourceActorId: currentActor.id,
    statusId: status.id,
    reactionName: reaction,
    groupKey: getReactionGroupKey(status.id, reaction)
  })
  if (!notification || notification.filtered) return

  // Already fire-and-forget internally: alert delivery must never fail the
  // reaction itself.
  sendNotificationAlerts({
    database,
    actorId: status.actorId,
    sourceActorId: currentActor.id,
    sourceActor: currentActor,
    statusId: status.id,
    events: [
      {
        type: NotificationType.enum.emoji_reaction,
        notificationId: notification.id
      }
    ]
  })
}

export const reactStatus = async ({
  database,
  currentActor,
  statusId,
  name
}: ReactStatusParams): Promise<ReactStatusResult> => {
  const status = await getReadableStatus({
    database,
    statusId,
    currentActor,
    withReplies: false
  })
  if (!status) return { ok: false, reason: 'not-found' }

  const resolved = await resolveLocalReaction(database, name)
  if (!resolved) return { ok: false, reason: 'invalid-emoji' }

  // Reacting to a boost reacts to the post it boosts. The serializer renders an
  // Announce wrapper with empty reactions by design (they belong to the
  // original, and surface on `reblog`), so storing against the wrapper would
  // federate a reaction that is then invisible on every Status entity.
  const target = getOriginalStatus(status)

  // The storage layer drops a reaction past the cap silently, which would make
  // this look like a success that did nothing. Check first so the caller gets a
  // real error. Racy under concurrency, but the cap is advisory anyway.
  const existing = await database.getStatusReactionRollups({
    statusIds: [target.id],
    currentActorId: currentActor.id
  })
  const mine = existing.filter((rollup) => rollup.me)
  if (
    mine.length >= MAX_REACTIONS_PER_ACTOR &&
    !mine.some((rollup) => rollup.name === resolved.name)
  ) {
    return { ok: false, reason: 'cap-reached' }
  }

  const changed = await database.createStatusReaction({
    statusId: target.id,
    actorId: currentActor.id,
    name: resolved.name
  })
  // Re-reacting with the same emoji, or reacting past the per-status cap,
  // changes nothing — so it must not re-federate or re-notify either.
  if (changed) {
    await announceReaction({
      database,
      currentActor,
      status: target,
      reaction: resolved.name,
      customEmoji: resolved.customEmoji
    })
  }

  return { ok: true, changed, status }
}

export const unreactStatus = async ({
  database,
  currentActor,
  statusId,
  name
}: ReactStatusParams): Promise<ReactStatusResult> => {
  const status = await getReadableStatus({
    database,
    statusId,
    currentActor,
    withReplies: false
  })
  if (!status) return { ok: false, reason: 'not-found' }

  // Removal accepts whatever is stored rather than re-validating: an emoji that
  // was legal when it was added must stay removable after an admin disables it.
  const storedName = normalizeStoredReactionName(name)
  const target = getOriginalStatus(status)

  const changed = await database.deleteStatusReaction({
    statusId: target.id,
    actorId: currentActor.id,
    name: storedName
  })
  if (changed && !target.isLocalActor) {
    // A vanilla-Mastodon receiver resolves `Undo{Like}` by (account, status),
    // not by activity id, and it collapsed everything we sent for this status —
    // every reaction Like plus any real favourite — into ONE favourite row.
    // Sending the Undo would therefore delete the representation of whatever is
    // left. Withhold it while anything should still be represented there; the
    // reaction is already gone locally either way.
    const [stillFavourited, remaining] = await Promise.all([
      database.isActorLikedStatus({
        statusId: target.id,
        actorId: currentActor.id
      }),
      database.getStatusReactionRollups({
        statusIds: [target.id],
        currentActorId: currentActor.id
      })
    ])
    if (stillFavourited || remaining.some((rollup) => rollup.me)) {
      return { ok: true, changed, status }
    }

    const shortcode = getCustomEmojiShortcode(storedName)
    const customEmoji = shortcode
      ? await database.getCustomEmojiByShortcode(shortcode)
      : null
    await sendUndoReaction({
      currentActor,
      status: target,
      reaction: storedName,
      customEmoji
    })
  }

  return { ok: true, changed, status }
}
