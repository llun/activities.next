import { rankSearchCandidates } from '@/lib/database/domains/search/statuses'

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 5, 1)

describe('rankSearchCandidates', () => {
  it('returns an empty list for empty input', () => {
    expect(rankSearchCandidates([])).toEqual([])
  })

  it('is scale-independent across positive score multipliers', () => {
    const base = [
      { entityId: 'weak-newest', createdAt: NOW, score: 0.1 },
      { entityId: 'strong-recent', createdAt: NOW - 5 * DAY_MS, score: 0.45 },
      { entityId: 'strong-old', createdAt: NOW - 120 * DAY_MS, score: 0.9 },
      { entityId: 'mid-week', createdAt: NOW - 10 * DAY_MS, score: 0.3 }
    ]

    const baseOrder = rankSearchCandidates(base)
    expect(
      rankSearchCandidates(
        base.map((candidate) => ({
          ...candidate,
          score: candidate.score * 1000
        }))
      )
    ).toEqual(baseOrder)
    expect(
      rankSearchCandidates(
        base.map((candidate) => ({
          ...candidate,
          score: candidate.score / 1000
        }))
      )
    ).toEqual(baseOrder)
  })

  it('orders equal scores newest first', () => {
    expect(
      rankSearchCandidates([
        { entityId: 'oldest', createdAt: NOW - 20 * DAY_MS, score: 2 },
        { entityId: 'newest', createdAt: NOW, score: 2 },
        { entityId: 'middle', createdAt: NOW - 5 * DAY_MS, score: 2 }
      ])
    ).toEqual(['newest', 'middle', 'oldest'])
  })

  it('requires more than 2x the normalized score for a 30-days-older match to win', () => {
    const olderAt = NOW - 30 * DAY_MS

    // At 30 days older, weight is halved (1 / (1 + 30/30) = 0.5).
    // Exactly 2x ties on weight and falls back to newer createdAt.
    expect(
      rankSearchCandidates([
        { entityId: 'older', createdAt: olderAt, score: 2 },
        { entityId: 'newer', createdAt: NOW, score: 1 }
      ])
    ).toEqual(['newer', 'older'])

    // Just below 2x: newer still wins.
    expect(
      rankSearchCandidates([
        { entityId: 'older', createdAt: olderAt, score: 1.99 },
        { entityId: 'newer', createdAt: NOW, score: 1 }
      ])
    ).toEqual(['newer', 'older'])

    // Above 2x: older overtakes newer.
    expect(
      rankSearchCandidates([
        { entityId: 'older', createdAt: olderAt, score: 2.01 },
        { entityId: 'newer', createdAt: NOW, score: 1 }
      ])
    ).toEqual(['older', 'newer'])
  })

  it('breaks weight ties by createdAt descending then entityId descending', () => {
    expect(
      rankSearchCandidates([
        { entityId: 'a', createdAt: NOW, score: 1 },
        { entityId: 'c', createdAt: NOW, score: 1 },
        { entityId: 'b', createdAt: NOW, score: 1 },
        // Same weight as the newest (2x score at 30 days older → 0.5),
        // but older so it sorts after all three newest ties.
        { entityId: 'z-older-tie', createdAt: NOW - 30 * DAY_MS, score: 2 }
      ])
    ).toEqual(['c', 'b', 'a', 'z-older-tie'])
  })

  it('falls back to pure recency when all scores are zero or non-positive', () => {
    expect(
      rankSearchCandidates([
        { entityId: 'older', createdAt: NOW - 2 * DAY_MS, score: 0 },
        { entityId: 'newer-a', createdAt: NOW, score: 0 },
        { entityId: 'newer-b', createdAt: NOW, score: 0 },
        { entityId: 'middle', createdAt: NOW - DAY_MS, score: -5 }
      ])
    ).toEqual(['newer-b', 'newer-a', 'middle', 'older'])
  })
})
