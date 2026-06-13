import { getConfig } from '@/lib/config'
import {
  AnnouncementData,
  AnnouncementReactionRollup
} from '@/lib/types/database/operations'
import { CustomEmojiData } from '@/lib/types/domain/customEmoji'
import {
  Announcement,
  AnnouncementReaction
} from '@/lib/types/mastodon/announcement'
import { convertMarkdownText } from '@/lib/utils/text/convertMarkdownText'
import {
  sanitizeText,
  sanitizeTrustedStatusText
} from '@/lib/utils/text/sanitizeText'

const toIsoOrNull = (time: number | null): string | null =>
  time === null ? null : new Date(time).toISOString()

// Builds a single Mastodon AnnouncementReaction. When `name` matches a
// custom-emoji shortcode we surface its url/static_url; for a plain unicode
// reaction those fields are omitted entirely.
const toMastodonReaction = (
  reaction: Pick<AnnouncementReactionRollup, 'name' | 'count' | 'me'>,
  emojisByShortcode: Map<string, CustomEmojiData>
): AnnouncementReaction => {
  const emoji = emojisByShortcode.get(reaction.name)
  return {
    name: reaction.name,
    count: reaction.count,
    me: reaction.me,
    ...(emoji ? { url: emoji.url, static_url: emoji.staticUrl } : null)
  }
}

// The single construction point for the Mastodon Announcement entity. `text` is
// rendered to HTML with the same markdown-and-sanitization pipeline status
// content uses (convertMarkdownText -> sanitizeText -> sanitizeTrustedStatusText),
// so admin-entered HTML is stripped to the allowlist before it leaves the
// server. The caller supplies the per-actor `read` flag, the reaction rollups,
// and the custom emojis used to resolve reaction urls.
export const getMastodonAnnouncement = ({
  announcement,
  read,
  reactions,
  customEmojis
}: {
  announcement: AnnouncementData
  read: boolean
  reactions: Pick<AnnouncementReactionRollup, 'name' | 'count' | 'me'>[]
  customEmojis: CustomEmojiData[]
}): Announcement => {
  const { host } = getConfig()
  const emojisByShortcode = new Map(
    customEmojis.map((emoji) => [emoji.shortcode, emoji])
  )
  return {
    id: announcement.id,
    content: sanitizeTrustedStatusText(
      sanitizeText(convertMarkdownText(host)(announcement.text))
    ),
    starts_at: toIsoOrNull(announcement.startsAt),
    ends_at: toIsoOrNull(announcement.endsAt),
    all_day: announcement.allDay,
    published_at: new Date(
      announcement.publishedAt ?? announcement.createdAt
    ).toISOString(),
    updated_at: new Date(announcement.updatedAt).toISOString(),
    read,
    mentions: [],
    statuses: [],
    tags: [],
    emojis: [],
    reactions: reactions.map((reaction) =>
      toMastodonReaction(reaction, emojisByShortcode)
    )
  }
}
