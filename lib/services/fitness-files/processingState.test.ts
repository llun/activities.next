import {
  STUCK_PROCESSING_THRESHOLD_MS,
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
