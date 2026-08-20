import { z } from 'zod'

import { createJobHandle } from '@/lib/jobs/createJobHandle'
import { FETCH_LINK_PREVIEW_JOB_NAME } from '@/lib/jobs/names'
import { fetchLinkPreview } from '@/lib/services/link-previews/fetchLinkPreview'
import { JobHandle } from '@/lib/services/queue/type'

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
    const card = await fetchLinkPreview({ database, url })
    if (!card) return

    await database.linkStatusLinkPreview({ statusId, urlHash: card.urlHash })
  }
)
