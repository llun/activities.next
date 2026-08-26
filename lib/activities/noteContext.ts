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

  // Tag TYPES a Note carries. Neither is in the bundled ActivityStreams
  // context, so an undeclared one expands to a blank-node type: our own
  // `stripJsonLdArtifacts` recovers that for a `type` value, but a receiver
  // that does not is left with a tag it cannot classify — a hashtag that stops
  // being a hashtag, a custom emoji that stops rendering. Same IRIs as the
  // inbound aliases: a term we accept from peers is one we declare when we send.
  Hashtag: 'as:Hashtag',
  Emoji: 'toot:Emoji',
  // Attachment extensions. `focalPoint` is a two-number list, so it needs the
  // `@list` container or a processor reorders or unwraps it.
  blurhash: 'toot:blurhash',
  focalPoint: { '@id': 'toot:focalPoint', '@container': '@list' },

  // `votersCount` is emitted: `toActivityPubObject` puts it on a poll Question,
  // which the status route and the replies collection both serve. `sensitive`
  // is declared ahead of use — a content warning federates as `summary` today —
  // the way Mastodon's own outbound context carries its full vocabulary, so
  // whoever adds it does not have to rediscover this file.
  votersCount: 'toot:votersCount',
  sensitive: 'as:sensitive'
} as const

/**
 * The `@context` for any activity or object that carries a Note this instance
 * built. Six surfaces: `sendNote`'s Create, `sendUpdateNote`'s Update, the
 * outbox page, the AP representation of a single status, the AP replies
 * collection, and `sendQuoteRequest`'s `instrument`. The other quote
 * activities echo ids rather than Notes and keep `QUOTE_ACTIVITY_CONTEXT`.
 *
 * On the outbox page the context sits on the `OrderedCollectionPage`, so the
 * embedded Notes inherit it only from a receiver that processes the page as
 * one document — `getActorPosts` compacts each entry on its own and does not.
 */
export const NOTE_ACTIVITY_CONTEXT = [ACTIVITY_STREAM_URL, NOTE_CONTEXT_TERMS]
