import { z } from 'zod'

import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'
import { createNotificationWithPolicy } from '@/lib/services/notifications/createNotificationWithPolicy'
import { sendNotificationAlerts } from '@/lib/services/notifications/sendNotificationAlerts'
import { shouldCreateNotification } from '@/lib/services/notifications/shouldNotify'
import { getReactionGroupKey } from '@/lib/services/reactions/reactionGroupKey'
import {
  MAX_REACTION_NAME_LENGTH,
  MAX_STORED_REACTION_NAME_LENGTH
} from '@/lib/services/statuses/reactionLimits'
import { EmojiReact, Like } from '@/lib/types/activitypub'
import { NotificationType } from '@/lib/types/database/operations'
import { logger } from '@/lib/utils/logger'

// A reaction-bearing activity is either a litepub `EmojiReact` (Pleroma/Akkoma,
// FEP-c0e0) or a Misskey-style `Like` carrying the emoji. Both are handled
// identically once the reaction string is extracted.
type ReactionActivity = Like | EmojiReact

interface EmojiReactionRequestParams {
  activity: ReactionActivity
  database: Database
}

// Remote emoji images render straight into an <img> in the client, so the URL is
// bounded and scheme-checked before it is ever stored.
const MAX_EMOJI_URL_LENGTH = 2048
const HTTP_PROTOCOLS = new Set(['http:', 'https:'])

// Liberal narrowing of an `Emoji` tag: the shared `Emoji` schema requires
// `updated`, which Pleroma omits, so those tags arrive as the `Tag` union's
// loose-object fallback. Model only what is consumed (AGENTS.md → ActivityPub &
// JSON-LD).
const ReactionEmojiTag = z.looseObject({
  type: z.literal('Emoji'),
  name: z.string(),
  icon: z.looseObject({ url: z.string() })
})

const stripColons = (value: string) => value.replace(/^:+|:+$/g, '')

// A custom-emoji reference is normally colon-wrapped (`:blobcat:`), but a sender
// can omit the colons — and a bare shortcode MUST NOT be stored unqualified, or
// the rollup would resolve it against our own `customEmojis` table and let a
// remote actor pick which local emoji image its chip renders. A shortcode is
// exactly `[A-Za-z0-9_]+`; no unicode emoji matches that (keycaps such as `1️⃣`
// carry U+FE0F/U+20E3, so they never do either).
const SHORTCODE_PATTERN = /^[A-Za-z0-9_]+$/

const isCustomEmojiReference = (reaction: string) =>
  (reaction.startsWith(':') && reaction.endsWith(':') && reaction.length > 2) ||
  SHORTCODE_PATTERN.test(reaction)

const getHost = (url: string): string | null => {
  try {
    return new URL(url).host
  } catch {
    return null
  }
}

/**
 * The reaction string an activity carries, or null when it is a plain favourite
 * (or carries something unusable). `_misskey_reaction` wins over `content`:
 * Misskey sets both to the same value, and the extension property is the
 * unambiguous one. Validation stays liberal on the inbound path — senders
 * disagree about what a reaction may be, and storage is opaque.
 */
export const getReactionContent = (
  activity: Pick<ReactionActivity, 'content' | '_misskey_reaction'>
): string | null => {
  const raw = (activity._misskey_reaction ?? activity.content ?? '').trim()
  if (!raw || raw.length > MAX_REACTION_NAME_LENGTH) return null
  return raw
}

/**
 * Map an inbound reaction string to the stored `(name, url)` pair.
 *
 * - A unicode emoji is stored verbatim and ignores any tags.
 * - A custom emoji (`:shortcode:`) from a remote sender is namespaced
 *   `shortcode@senderdomain`, the convention Misskey and Pleroma both use. It is
 *   deliberately never stored as a bare shortcode: that would resolve against
 *   *our* `customEmojis` table and let a remote actor render any local emoji it
 *   names.
 * - The image URL is taken from the activity's matching `Emoji` tag only when it
 *   is http(s), bounded, and served from the sending actor's own host. Anything
 *   else is stored without a URL and renders as text.
 */
const resolveReactionEmoji = (
  reaction: string,
  activity: ReactionActivity
): { name: string; url: string | null } | null => {
  if (!isCustomEmojiReference(reaction)) return { name: reaction, url: null }

  const shortcode = stripColons(reaction)
  if (!shortcode) return null

  const senderHost = getHost(activity.actor)
  if (!senderHost) {
    logger.warn({
      message: 'Dropping custom emoji reaction from an unparseable actor id',
      activityId: activity.id,
      actorId: activity.actor
    })
    return null
  }

  const name = (() => {
    // Already namespaced by the sender (a third instance's emoji relayed on).
    if (shortcode.includes('@')) return shortcode
    // A local actor's reaction references our own emoji table directly.
    if (senderHost === getConfig().host) return shortcode
    return `${shortcode}@${senderHost}`
  })()

  // The raw reaction is bounded, but the namespaced name is not: a long
  // shortcode plus a long hostname can overrun the varchar(255) columns it is
  // stored in (`status_reactions.name`, `notifications.reactionName`, and the
  // notification `groupKey` built from it). Postgres rejects the write, which
  // the shared-inbox job would surface as a failed job rather than a 400.
  if (name.length > MAX_STORED_REACTION_NAME_LENGTH) {
    logger.warn({
      message: 'Dropping emoji reaction whose namespaced name is too long',
      activityId: activity.id,
      actorId: activity.actor,
      nameLength: name.length
    })
    return null
  }

  return {
    name,
    url: getReactionEmojiUrl({ activity, shortcode, name, senderHost })
  }
}

// Whether the sender is entitled to supply the image for this reaction name.
// Only the instance that owns the namespace is: otherwise a hostile peer could
// relay `:blobcat@good.test:` with an image on its own host, pass the
// same-host URL check, and — because the rollup unwraps one url per
// (statusId, name) group — have its image displace the real one that
// good.test's own reactors stored.
const ownsReactionNamespace = (name: string, senderHost: string) =>
  name.endsWith(`@${senderHost}`)

const getReactionEmojiUrl = ({
  activity,
  shortcode,
  name,
  senderHost
}: {
  activity: ReactionActivity
  shortcode: string
  name: string
  senderHost: string
}): string | null => {
  if (!ownsReactionNamespace(name, senderHost)) return null

  const candidateNames = new Set([shortcode, name])
  for (const rawTag of activity.tag ?? []) {
    const tag = ReactionEmojiTag.safeParse(rawTag)
    if (!tag.success) continue
    if (!candidateNames.has(stripColons(tag.data.name))) continue

    const url = tag.data.icon.url
    if (url.length > MAX_EMOJI_URL_LENGTH) return null

    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return null
    }
    if (!HTTP_PROTOCOLS.has(parsed.protocol)) return null
    // The emoji must be served by the sender itself. A third-party host would
    // let an attacker render arbitrary remote images inside a reaction chip.
    if (parsed.host !== senderHost) {
      logger.warn({
        message: 'Ignoring reaction emoji url from outside the sender domain',
        activityId: activity.id,
        actorId: activity.actor,
        emojiHost: parsed.host
      })
      return null
    }
    return url
  }
  return null
}

const getReactionTarget = (activity: ReactionActivity) =>
  typeof activity.object === 'string' ? activity.object : activity.object.id

/**
 * Store an inbound emoji reaction. A reaction is never a favourite: it writes no
 * `likes` row and never moves `favourites_count`.
 */
export const emojiReactionRequest = async ({
  activity,
  database
}: EmojiReactionRequestParams) => {
  const reaction = getReactionContent(activity)
  if (!reaction) return

  const resolved = resolveReactionEmoji(reaction, activity)
  if (!resolved) return

  const statusId = getReactionTarget(activity)
  const { name, url } = resolved
  const stored = await database.createStatusReaction({
    statusId,
    actorId: activity.actor,
    name,
    url
  })
  // Nothing changed — an unknown status, a redelivery of a reaction we already
  // hold, or an actor past the per-status cap. Notifying anyway would let a
  // sender replay one activity into unbounded notifications.
  if (!stored) return

  const status = await database.getStatus({ statusId, withReplies: false })
  if (!status) return
  if (
    !(await shouldCreateNotification(database, status.actorId, activity.actor))
  ) {
    return
  }

  const notification = await createNotificationWithPolicy(database, {
    actorId: status.actorId,
    type: NotificationType.enum.emoji_reaction,
    sourceActorId: activity.actor,
    statusId: status.id,
    reactionName: name,
    groupKey: getReactionGroupKey(status.id, name)
  })
  if (!notification || notification.filtered) return

  // Fan out the push alert, mirroring `likeRequest`. Without this an inbound
  // federated reaction records a notification row but never reaches the
  // recipient's device — so the whole reaction push path would only ever fire
  // for a local actor reacting to a local post. Fire-and-forget: alert delivery
  // must not fail the inbound activity. No email content: there is no reaction
  // email template yet, and sendNotificationAlerts only mails events with one.
  database
    .getActorFromId({ id: activity.actor })
    .then((sourceActor) => {
      if (!sourceActor) return
      sendNotificationAlerts({
        database,
        actorId: status.actorId,
        sourceActorId: activity.actor,
        sourceActor,
        statusId: status.id,
        events: [
          {
            type: NotificationType.enum.emoji_reaction,
            notificationId: notification.id
          }
        ]
      })
    })
    .catch(() => undefined)
}

/**
 * Remove an inbound reaction. The undone activity is the original reaction
 * (Misskey embeds the rendered Like, Pleroma its own EmojiReact), so the
 * reaction string resolves exactly as it did on the way in.
 */
export const undoEmojiReactionRequest = async ({
  activity,
  database
}: EmojiReactionRequestParams) => {
  const reaction = getReactionContent(activity)
  if (!reaction) return

  const resolved = resolveReactionEmoji(reaction, activity)
  if (!resolved) return

  await database.deleteStatusReaction({
    statusId: getReactionTarget(activity),
    actorId: activity.actor,
    name: resolved.name
  })
}
