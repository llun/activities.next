import { z } from 'zod'

import { createJobHandle } from '@/lib/jobs/createJobHandle'
import { RENAME_STATUS_URLS_JOB_NAME } from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import { JobHandle } from '@/lib/services/queue/type'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { withSpan } from '@/lib/utils/trace'

// A handle rename keeps every id-derived URL, but a status's permalink
// (`statuses.url`, and its `urlHash` twin) embeds the handle it was minted
// with: `https://<domain>/@<username>/<publicId>` (createNote, createPoll and
// the fitness imports all build it that way). This job rewrites the renamed
// actor's permalinks from the old profile prefix to the new one, in bounded
// keyset pages so a long history cannot hold a worker.

// statuses.url = `https://${domain}/@${username}/${publicId}`, so both
// prefixes carry the trailing slash the publicId hangs off. With it, a
// rewritten url (new prefix + suffix) can never still match the old prefix:
// that would need the new username to start with the old one plus a `/`,
// which a username cannot contain.
export const getStatusUrlPrefix = ({
  domain,
  username
}: {
  domain: string
  username: string
}) => `https://${domain.toLowerCase()}/@${username}/`

export const RENAME_STATUS_URLS_BUDGET_MS = 20_000
export const RENAME_STATUS_URLS_PAGE_SIZE = 200

const JobData = z.object({
  handleId: z.string(),
  actorId: z.string(),
  fromPrefix: z.string(),
  toPrefix: z.string(),
  after: z.string().nullable()
})

// The ids the job publishes under: the start job the route queues after the
// rename commit, then one continuation per page that ran out of budget. Both
// are deterministic, so a queue that redelivers (or a retry after a queue
// failure) re-runs the same page instead of duplicating it — and a
// re-run of an already-rewritten page matches no rows and changes nothing.
export const renameStatusUrlsJobId = (
  handleId: string,
  lastId?: string | null
) =>
  lastId === undefined || lastId === null
    ? `${handleId}:statusUrls:start`
    : `${handleId}:statusUrls:${lastId}`

export const renameStatusUrlsJob: JobHandle = createJobHandle(
  RENAME_STATUS_URLS_JOB_NAME,
  async (database, message) => {
    await withSpan('job', 'renameStatusUrls', {}, async (span) => {
      const parsed = JobData.safeParse(message.data)
      if (!parsed.success) {
        span.recordException(new Error('Malformed rename status URLs job'))
        return
      }
      const { handleId, actorId, fromPrefix, toPrefix, after } = parsed.data
      span.setAttribute('actorId', actorId)

      // The deadline is read through Date.now() on every page, so the suite's
      // fake timers decide when the budget runs out.
      const deadline = Date.now() + RENAME_STATUS_URLS_BUDGET_MS
      let cursor = after
      while (true) {
        const rows = await database.getStatusesForUrlRewrite({
          actorId,
          urlPrefix: fromPrefix,
          after: cursor,
          limit: RENAME_STATUS_URLS_PAGE_SIZE
        })
        if (rows.length === 0) return

        for (const row of rows) {
          const url = `${toPrefix}${row.url.slice(fromPrefix.length)}`
          await database.rewriteStatusUrl({
            statusId: row.id,
            url,
            urlHash: getHashFromString(url)
          })
        }
        cursor = rows[rows.length - 1].id

        if (rows.length < RENAME_STATUS_URLS_PAGE_SIZE) return
        if (Date.now() >= deadline) {
          await getQueue().publish({
            id: renameStatusUrlsJobId(handleId, cursor),
            name: RENAME_STATUS_URLS_JOB_NAME,
            data: { handleId, actorId, fromPrefix, toPrefix, after: cursor }
          })
          return
        }
      }
    })
  }
)
