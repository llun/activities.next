import { describe, expect, it } from 'vitest'

import { parseArgs } from './backfillGifvMetadata'

describe('backfillGifvMetadata parseArgs', () => {
  it('defaults to live run with batch size 50', () => {
    expect(parseArgs([])).toEqual({ dryRun: false, batchSize: 50 })
  })

  it('accepts --dry-run flag', () => {
    expect(parseArgs(['--dry-run'])).toEqual({ dryRun: true, batchSize: 50 })
  })

  it('accepts --batch-size flag', () => {
    expect(parseArgs(['--batch-size', '100'])).toEqual({
      dryRun: false,
      batchSize: 100
    })
  })
})
