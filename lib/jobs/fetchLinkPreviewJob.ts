import { z } from 'zod'

import { createJobHandle } from '@/lib/jobs/createJobHandle'
import { FETCH_LINK_PREVIEW_JOB_NAME } from '@/lib/jobs/names'
import { fetchLinkPreview } from '@/lib/services/link-previews/fetchLinkPreview'
import { resolveStatusPreviewUrl } from '@/lib/services/link-previews/resolveStatusPreviewUrl'
import { JobHandle } from '@/lib/services/queue/type'
import { getResolvedServerSettings } from '@/lib/services/serverSettings'

const FetchLinkPreviewJobData = z.object({
  statusId: z.string().min(1),
  url: z.string().min(1)
})

/**
 * Fetch the preview card for one status's link and attach it.
 *
 * The status is only linked to a card that actually resolved: `fetchLinkPreview`
 * answers null for a page it could not read (and records the failure as its own
 * negative-cache row), so a status never points at a card that would render as
 * an empty box.
 */
export const fetchLinkPreviewJob: JobHandle = createJobHandle(
  FETCH_LINK_PREVIEW_JOB_NAME,
  async (database, message) => {
    const parsed = FetchLinkPreviewJobData.safeParse(message.data)
    if (!parsed.success) return

    const { statusId } = parsed.data

    // Re-check the switch here, not only where the job was scheduled: a remote
    // fetch can sit in the queue for up to a minute (and far longer on a real
    // broker), and an operator turning link previews off expects the outbound
    // requests to stop rather than drain.
    const { network } = await getResolvedServerSettings(database)
    if (!network.linkPreviews) return

    // The status may have been edited or deleted since this job was scheduled,
    // so the URL is resolved from the status as it is NOW rather than trusting
    // the one in the message. An edit enqueues a job for the new URL under a
    // different id, leaving the pre-edit job queued — and because a remote
    // fetch is delayed, "the stale job lands last" is the likely ordering, not
    // the unlucky one.
    //
    // Re-resolving (rather than requiring the message's URL to still match) is
    // what keeps the legitimate cases working too. The scheduler and the job
    // can legitimately disagree on an inbound quote post: the scheduler is
    // handed the in-memory status `database.createNote` returned, which carries
    // no `quote` field at all, while this re-read does — so the two compute
    // different exclusion sets and demanding equality left the post with no
    // card. (It is NOT an ordering problem: the quote edge is written before
    // the scheduler runs. Do not "fix" that ordering.) Fetching the current URL
    // is idempotent, so a duplicate job simply re-confirms the same card.
    const status = await database.getStatus({ statusId, withReplies: false })
    if (!status) return

    const currentUrl = await resolveStatusPreviewUrl({ database, status })
    // An edit removed the last link; the card was already unlinked by the
    // scheduler and must not be put back.
    if (!currentUrl) return

    const card = await fetchLinkPreview({ database, url: currentUrl })
    if (!card) {
      // The status has a link but it yielded no card. Any card still attached
      // is for the PREVIOUS link — an edit from an article to a PDF, a 404 or
      // a non-HTML URL lands here on the first try — and leaving it would show
      // a full-width card for a page the post no longer mentions, forever,
      // since nothing retries. (`fetchLinkPreview` returns a preserved card
      // when one exists, so reaching here means there is genuinely none.)
      await database.deleteStatusLinkPreview({ statusId })
      return
    }

    await database.linkStatusLinkPreview({ statusId, urlHash: card.urlHash })
  }
)
