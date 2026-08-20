import { StatusLinkPreview } from '@/lib/types/domain/status'
import { PreviewCard } from '@/lib/types/mastodon/previewCard'

const CARD_TYPES = new Set(['link', 'photo', 'video', 'rich'])

/**
 * Map a stored link preview onto Mastodon's PreviewCard entity.
 *
 * Every string field in that entity is declared non-nullable, and
 * `Mastodon.Status.parse` runs once per status inside a handler that catches
 * and skips a status it cannot serialize — so a card with a missing key does
 * not lose the card, it loses the whole status from the timeline. Hence the
 * `''`/`0` defaults on every optional field rather than omitting them.
 *
 * `html` and `embed_url` are always empty: this server does not consume oEmbed,
 * and emitting remote-authored markup for clients to inject is a hazard with no
 * upside while nothing renders it.
 */
export const getMastodonPreviewCard = (
  linkPreview: StatusLinkPreview | null | undefined
): PreviewCard | null => {
  if (!linkPreview) return null

  return {
    url: linkPreview.url,
    title: linkPreview.title,
    description: linkPreview.description ?? '',
    type:
      linkPreview.type && CARD_TYPES.has(linkPreview.type)
        ? (linkPreview.type as PreviewCard['type'])
        : 'link',
    author_name: linkPreview.authorName ?? '',
    author_url: linkPreview.authorUrl ?? '',
    provider_name: linkPreview.siteName ?? '',
    // Mastodon fills this from oEmbed, which this server does not consume.
    provider_url: '',
    html: '',
    width: linkPreview.imageWidth ?? 0,
    height: linkPreview.imageHeight ?? 0,
    image: linkPreview.imageUrl ?? null,
    embed_url: '',
    // Set once preview images are stored locally; a hotlinked thumbnail has no
    // decoded bytes here to hash.
    blurhash: null
  }
}
