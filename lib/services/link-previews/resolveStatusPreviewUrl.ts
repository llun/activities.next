import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'
import { extractPreviewUrl } from '@/lib/services/link-previews/extractUrl'
import { Status, StatusType } from '@/lib/types/domain/status'

export type ResolveStatusPreviewUrlParams = {
  database: Database
  status: Status
}

/**
 * The URL a status should show a preview card for, or null when it should show
 * none.
 *
 * One implementation on purpose: the scheduler decides what to enqueue and the
 * job re-checks it before attaching, so if the two computed this differently an
 * edit could permanently attach a card for a link the status no longer has.
 */
export const resolveStatusPreviewUrl = async ({
  database,
  status
}: ResolveStatusPreviewUrlParams): Promise<string | null> => {
  // A boost carries no text of its own; the card belongs to the status it
  // wraps, which was resolved when that status was stored.
  if (status.type === StatusType.enum.Announce) return null

  const excludeUrls: string[] = []
  if (status.quote?.quotedStatusId) {
    // The quoted post already has its own card on this status, so a link card
    // for the same page would render it twice.
    //
    // Both forms are excluded. `quotedStatusId` is the ActivityPub object id
    // (`https://host/users/alice/statuses/123`), but what a remote quote post
    // actually puts in its content HTML is the human URL
    // (`https://host/@alice/123`). Those are only the same string for local
    // statuses, so excluding the id alone matched almost no remote quote.
    excludeUrls.push(status.quote.quotedStatusId)
    const quotedStatus = await database.getStatus({
      statusId: status.quote.quotedStatusId,
      withReplies: false
    })
    const quotedUrl =
      quotedStatus && quotedStatus.type !== StatusType.enum.Announce
        ? quotedStatus.url
        : null
    if (quotedUrl) excludeUrls.push(quotedUrl)
  }

  return extractPreviewUrl({
    text: status.text,
    isLocalActor: status.isLocalActor,
    host: getConfig().host,
    // Not optional in practice. The custom-emoji substitution happens between
    // the two sanitize passes and can EMPTY an anchor the extractor would
    // otherwise have counted as visible, so an extractor that cannot see the
    // tags is measuring text the renderer is about to rewrite.
    tags: status.tags,
    excludeUrls
  })
}
