import { QUOTE_CONTEXT_TERMS } from '@/lib/activities/quoteContext'
import { ACTIVITY_STREAM_URL } from '@/lib/utils/activitystream'

/**
 * JSON-LD term map for every extension this instance writes onto a Note.
 *
 * A receiver that runs real JSON-LD processing resolves each property through
 * the document's own `@context`, and the ActivityStreams context this instance
 * used to send alone declares none of these — it sets `"@vocab": "_:"`, so an
 * undefined key expands to a blank node the processor then drops. Our own
 * inbound pipeline does exactly that (see `stripJsonLdArtifacts` in
 * `lib/activities/jsonld`), which is what made this invisible: two
 * activities.next instances federating lost the terms in both directions, and
 * Mastodon kept them only because it reads the JSON without processing it.
 *
 * `interactionPolicy` is on every Note this instance emits, so this is not a
 * quote-only or attachment-only concern — a plain text post loses who may
 * quote it.
 *
 * Mirrors the inbound aliases in `CANONICAL_CONTEXT`: a term we accept from
 * peers is a term we have to declare when we are the sender.
 */
export const NOTE_CONTEXT_TERMS = {
  ...QUOTE_CONTEXT_TERMS,

  toot: 'http://joinmastodon.org/ns#',
  // Attachment extensions. `focalPoint` is a two-number list, so it needs the
  // `@list` container or a processor reorders or unwraps it.
  blurhash: 'toot:blurhash',
  focalPoint: { '@id': 'toot:focalPoint', '@container': '@list' },

  // Declared ahead of use, the way Mastodon's own outbound context carries the
  // full vocabulary: nothing emits these on a Note today (a content warning
  // federates as `summary`, and polls do not go through `getNoteFromStatus`),
  // so whoever adds them does not have to rediscover this file.
  sensitive: 'as:sensitive',
  votersCount: 'toot:votersCount'
} as const

/**
 * The `@context` for any activity or object that carries a Note this instance
 * built — `sendNote`'s Create, `sendUpdateNote`'s Update, the outbox page, and
 * the AP representation of a single status.
 */
export const NOTE_ACTIVITY_CONTEXT = [ACTIVITY_STREAM_URL, NOTE_CONTEXT_TERMS]
