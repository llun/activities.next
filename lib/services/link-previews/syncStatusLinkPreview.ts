import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'
import { FETCH_LINK_PREVIEW_JOB_NAME } from '@/lib/jobs/names'
import { extractPreviewUrl } from '@/lib/services/link-previews/extractUrl'
import { getQueue } from '@/lib/services/queue'
import { getResolvedServerSettings } from '@/lib/services/serverSettings'
import { Status, StatusType } from '@/lib/types/domain/status'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

// A link shared widely is fetched by every server that receives the post, all
// at once — the "link preview stampede" that has repeatedly knocked over small
// sites. Spreading remote fetches across a minute is the same mitigation
// Mastodon applies.
export const LINK_PREVIEW_REMOTE_JITTER_SECONDS = 60

export type SyncStatusLinkPreviewParams = {
  database: Database
  status: Status
}

/**
 * Decide which link (if any) a status should show a card for and enqueue the
 * fetch.
 *
 * Called wherever a status's text is written: local create and edit, and the
 * inbound federation create and update. Every failure here is swallowed — a
 * preview card is decoration, and losing one must never fail posting or the
 * ingest of someone else's post.
 */
export const syncStatusLinkPreview = async ({
  database,
  status
}: SyncStatusLinkPreviewParams): Promise<void> => {
  try {
    // A boost carries no text of its own; the card belongs to the status it
    // wraps, which was synced when that status was stored.
    if (status.type === StatusType.enum.Announce) return

    const { features } = await getResolvedServerSettings(database)
    if (!features.linkPreviews) return

    const url = extractPreviewUrl({
      text: status.text,
      isLocalActor: status.isLocalActor,
      host: getConfig().host,
      // The quoted post already has its own card on this status; a link card
      // for the same page would render the same thing twice.
      excludeUrls: status.quote?.quotedStatusId
        ? [status.quote.quotedStatusId]
        : []
    })

    if (!url) {
      // An edit can remove the last link, and the card has to go with it.
      await database.deleteStatusLinkPreview({ statusId: status.id })
      return
    }

    // A remote post reaches many servers at once; a local one has an author
    // waiting to see the card, and is a single request either way.
    const shouldDelay = !status.isLocalActor && !getQueue().runsInline
    await getQueue().publish({
      // Stable per (status, url): a redelivered message dedupes, while an edit
      // pointing somewhere new gets its own job.
      id: getHashFromString(`${status.id}:link-preview:${url}`),
      name: FETCH_LINK_PREVIEW_JOB_NAME,
      data: { statusId: status.id, url },
      // NoQueue has no scheduler and silently drops a delayed message, so the
      // delay is only ever attached when something can honour it.
      ...(shouldDelay
        ? {
            delaySeconds:
              1 +
              Math.floor(
                Math.random() * (LINK_PREVIEW_REMOTE_JITTER_SECONDS - 1)
              )
          }
        : {})
    })
  } catch (error) {
    logger.warn({
      message: 'linkPreview: failed to schedule preview card fetch',
      statusId: status.id,
      error: error instanceof Error ? error.message : String(error),
      err: toLoggableError(error)
    })
  }
}
