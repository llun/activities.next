import type {
  GetStatusEditHistoryParams,
  StatusEditRevision
} from '@/lib/database/domains/status/types'
import type { Db } from '@/lib/database/kysely'
import { getCompatibleJSON } from '@/lib/database/utils/getCompatibleJSON'
import { getCompatibleTime } from '@/lib/database/utils/getCompatibleTime'
import { Attachment } from '@/lib/types/domain/attachment'

// The superseded revisions of a status, oldest first. Status hydration reads
// them for each Note and Poll it builds. Deleting them (deleteStatusEditHistory)
// is in ./deletion.ts.
export const getStatusEditHistory = async (
  db: Db,
  { statusId }: GetStatusEditHistoryParams
): Promise<StatusEditRevision[]> => {
  // Each row holds the content of a prior version; `updatedAt` is when that
  // version was superseded. Order by the recorded transition time and then
  // row id so equal timestamps still produce a stable revision timeline.
  const rows = await db
    .selectFrom('status_history')
    .selectAll()
    .where('statusId', '=', statusId)
    .orderBy('updatedAt', 'asc')
    .orderBy('id', 'asc')
    .execute()
  return rows.map((row) => {
    // `data` is jsonb on PostgreSQL and json on SQLite, so it arrives parsed
    // on both; getCompatibleJSON maps a NULL to an empty object.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const content = getCompatibleJSON<any>(row.data)
    const hasField = (field: string) =>
      content != null && Object.prototype.hasOwnProperty.call(content, field)
    // Rows written before per-revision snapshots only carry text/summary.
    // Keep availability separate from nullable values: explicit `null` is a
    // known empty value for summary or poll options, while a missing key is
    // unknown and must not be reported as a change or no change.
    const attachments = Attachment.array().safeParse(content?.attachments)
    const pollOptions = Array.isArray(content?.pollOptions)
      ? content.pollOptions.filter(
          (option: unknown): option is string => typeof option === 'string'
        )
      : null
    const pollOptionsAvailable =
      content?.pollOptions === null ||
      (Array.isArray(content?.pollOptions) &&
        content.pollOptions.every(
          (option: unknown) => typeof option === 'string'
        ))
    return {
      text: typeof content?.text === 'string' ? content.text : '',
      summary: typeof content?.summary === 'string' ? content.summary : null,
      sensitive:
        typeof content?.sensitive === 'boolean' ? content.sensitive : null,
      attachments: attachments.success ? attachments.data : null,
      pollOptions,
      // A NULL timestamp throws here (getCompatibleTime(null)).
      createdAt: getCompatibleTime(row.createdAt as number),
      available: {
        text: typeof content?.text === 'string',
        summary:
          hasField('summary') &&
          (content.summary === null || typeof content.summary === 'string'),
        sensitive: typeof content?.sensitive === 'boolean',
        attachments: attachments.success,
        pollOptions: pollOptionsAvailable
      },
      supersededAt: getCompatibleTime(row.updatedAt as number)
    }
  })
}
