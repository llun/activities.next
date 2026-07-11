import {
  STUCK_PROCESSING_THRESHOLD_MS,
  isFitnessImportStuck,
  isFitnessProcessingStuck
} from './processingState'

describe('isFitnessProcessingStuck', () => {
  const now = 1_700_000_000_000

  it('returns true when a file has been processing past the threshold', () => {
    expect(
      isFitnessProcessingStuck(
        {
          processingStatus: 'processing',
          updatedAt: now - STUCK_PROCESSING_THRESHOLD_MS - 1
        },
        now
      )
    ).toBe(true)
  })

  it('returns true at exactly the threshold boundary', () => {
    expect(
      isFitnessProcessingStuck(
        {
          processingStatus: 'processing',
          updatedAt: now - STUCK_PROCESSING_THRESHOLD_MS
        },
        now
      )
    ).toBe(true)
  })

  it('returns false while a file is still within the threshold', () => {
    expect(
      isFitnessProcessingStuck(
        { processingStatus: 'processing', updatedAt: now - 1_000 },
        now
      )
    ).toBe(false)
  })

  it.each(['pending', 'completed', 'failed'] as const)(
    'returns false for %s status no matter how old it is',
    (processingStatus) => {
      expect(
        isFitnessProcessingStuck(
          {
            processingStatus,
            updatedAt: now - STUCK_PROCESSING_THRESHOLD_MS - 1
          },
          now
        )
      ).toBe(false)
    }
  )

  it('returns false when processingStatus is missing', () => {
    expect(
      isFitnessProcessingStuck(
        { updatedAt: now - STUCK_PROCESSING_THRESHOLD_MS - 1 },
        now
      )
    ).toBe(false)
  })

  it('defaults to the current time when no clock is provided', () => {
    expect(
      isFitnessProcessingStuck({
        processingStatus: 'processing',
        updatedAt: Date.now() - STUCK_PROCESSING_THRESHOLD_MS - 1_000
      })
    ).toBe(true)
  })
})

describe('isFitnessImportStuck', () => {
  const now = 1_700_000_000_000
  const stuck = {
    importStatus: 'pending' as const,
    statusId: null,
    importBatchId: 'strava-activity:1',
    updatedAt: now - STUCK_PROCESSING_THRESHOLD_MS - 1
  }

  it('returns true for a batch import pending past the threshold with no status', () => {
    expect(isFitnessImportStuck(stuck, now)).toBe(true)
  })

  it('returns true at exactly the threshold boundary', () => {
    expect(
      isFitnessImportStuck(
        { ...stuck, updatedAt: now - STUCK_PROCESSING_THRESHOLD_MS },
        now
      )
    ).toBe(true)
  })

  it('returns false while still within the threshold', () => {
    expect(
      isFitnessImportStuck({ ...stuck, updatedAt: now - 1_000 }, now)
    ).toBe(false)
  })

  it.each(['completed', 'failed'] as const)(
    'returns false for importStatus %s no matter how old it is',
    (importStatus) => {
      expect(isFitnessImportStuck({ ...stuck, importStatus }, now)).toBe(false)
    }
  )

  it('returns false when a status was already assigned', () => {
    expect(
      isFitnessImportStuck({ ...stuck, statusId: 'https://x/statuses/1' }, now)
    ).toBe(false)
  })

  it('returns false when there is no import batch to retry', () => {
    expect(isFitnessImportStuck({ ...stuck, importBatchId: null }, now)).toBe(
      false
    )
  })

  it('returns false when importStatus is missing', () => {
    const { importStatus: _omitted, ...withoutStatus } = stuck
    expect(isFitnessImportStuck(withoutStatus, now)).toBe(false)
  })

  it('defaults to the current time when no clock is provided', () => {
    expect(
      isFitnessImportStuck({
        ...stuck,
        updatedAt: Date.now() - STUCK_PROCESSING_THRESHOLD_MS - 1_000
      })
    ).toBe(true)
  })
})
