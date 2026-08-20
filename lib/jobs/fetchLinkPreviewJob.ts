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

    const { statusId, url } = parsed.data

    // Re-check the switch here, not only where the job was scheduled: a remote
    // fetch can sit in the queue for up to a minute (and far longer on a real
    // broker), and an operator turning link previews off expects the outbound
    // requests to stop rather than drain.
    const { network } = await getResolvedServerSettings(database)
    if (!network.linkPreviews) return

    // The status may have been edited or deleted since this job was scheduled.
    // An edit enqueues a job for the NEW url under a different id, so without
    // this check the older job can land afterwards and re-attach the pre-edit
    // card permanently — and the same re-check is what stops an in-flight job
    // from resurrecting a card an edit just removed.
    const status = await database.getStatus({ statusId, withReplies: false })
    if (!status) return
    if ((await resolveStatusPreviewUrl({ database, status })) !== url) return

    const card = await fetchLinkPreview({ database, url })
    if (!card) return

    await database.linkStatusLinkPreview({ statusId, urlHash: card.urlHash })
  }
)
