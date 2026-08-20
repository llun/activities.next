import { Database } from '@/lib/database/types'
import { FETCH_LINK_PREVIEW_JOB_NAME } from '@/lib/jobs/names'
import { resolveStatusPreviewUrl } from '@/lib/services/link-previews/resolveStatusPreviewUrl'
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

    const url = await resolveStatusPreviewUrl({ database, status })

    if (!url) {
      // An edit can remove the last link, and the card has to go with it. This
      // runs regardless of the switch: turning link previews off stops new
      // FETCHES, and must not also strand a card on a post that no longer
      // links anything.
      await database.deleteStatusLinkPreview({ statusId: status.id })
      return
    }

    // An edit can also SWAP one link for another, which the check above does
    // not cover. Drop a card belonging to the previous link before doing
    // anything else, so the post is never showing a card for a page it no
    // longer mentions — and so this still happens when fetching is turned off,
    // where nothing would otherwise replace it.
    //
    // Compared on `urlHash`, which is the cache key derived from the REQUESTED
    // url. The card's own `url` is where the content came from after redirects,
    // so comparing that would drop a perfectly good card for any shortened or
    // redirecting link.
    const attached = await database.getStatusLinkPreviews({
      statusIds: [status.id]
    })
    const attachedHash = attached.get(status.id)?.urlHash
    if (attachedHash && attachedHash !== getHashFromString(url)) {
      await database.deleteStatusLinkPreview({ statusId: status.id })
    }

    const { network } = await getResolvedServerSettings(database)
    if (!network.linkPreviews) return

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
