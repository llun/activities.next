import { getConfig } from '@/lib/config'

import { ARCHIVE_SLICE_BUDGET_MS } from './constants'

/**
 * QStash cuts a job off after 30 seconds, so a slice there stops at 20 and
 * keeps the rest for saving the cursor and publishing the next slice (the same
 * sizing as the route heatmap job). Other queues allow long jobs.
 */
export const ARCHIVE_QSTASH_SLICE_BUDGET_MS = 20_000

export const getArchiveSliceBudgetMs = (): number =>
  getConfig().queue?.type === 'qstash'
    ? ARCHIVE_QSTASH_SLICE_BUDGET_MS
    : ARCHIVE_SLICE_BUDGET_MS
