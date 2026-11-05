import { addQuoteFallbackToContent } from '@/lib/activities/quoteNoteFields'
import { getConfig } from '@/lib/config'
import { Status, getOriginalStatus } from '@/lib/types/domain/status'
import { convertMarkdownText } from '@/lib/utils/text/convertMarkdownText'

/**
 * Builds the ActivityPub wire `content` HTML for a status across both inbox
 * delivery (`getNoteFromStatus`) and fetch/archive surfaces (`toActivityPubObject`).
 *
 * Local statuses store Markdown source in `text` (or HTML on polls and on
 * statuses imported from a Mastodon archive, which `convertMarkdownText` passes
 * through), while stored remote statuses hold HTML that is never sanitized on
 * write (only when read for display) and must not be run through Markdown.
 */
export const getStatusWireContent = (status: Status): string => {
  const actualStatus = getOriginalStatus(status)
  const renderedText = actualStatus.isLocalActor
    ? convertMarkdownText(getConfig().host)(actualStatus.text)
    : actualStatus.text
  return addQuoteFallbackToContent(renderedText, actualStatus.quote)
}
