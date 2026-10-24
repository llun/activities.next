import { getConfig } from '@/lib/config'

import {
  ARCHIVE_QSTASH_SLICE_BUDGET_MS,
  getArchiveSliceBudgetMs
} from './budget'
import { ARCHIVE_SLICE_BUDGET_MS } from './constants'

describe('getArchiveSliceBudgetMs', () => {
  const useQueue = (queue: unknown) =>
    vi.mocked(getConfig).mockReturnValue({
      ...vi.mocked(getConfig)(),
      queue
    } as ReturnType<typeof getConfig>)

  it('stops at 20 seconds on QStash, whose jobs are cut off at 30', () => {
    useQueue({ type: 'qstash' })
    expect(getArchiveSliceBudgetMs()).toBe(ARCHIVE_QSTASH_SLICE_BUDGET_MS)
    expect(ARCHIVE_QSTASH_SLICE_BUDGET_MS).toBeLessThanOrEqual(20_000)
  })

  it('uses the long budget on queues that allow long jobs', () => {
    useQueue({ type: 'sqs' })
    expect(getArchiveSliceBudgetMs()).toBe(ARCHIVE_SLICE_BUDGET_MS)
    useQueue(undefined)
    expect(getArchiveSliceBudgetMs()).toBe(ARCHIVE_SLICE_BUDGET_MS)
  })
})
