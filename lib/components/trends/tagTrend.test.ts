import {
  getTagPeoplePast2Days,
  getTagUsesHistory
} from '@/lib/components/trends/tagTrend'
import type { Tag } from '@/lib/types/mastodon/tag'

const tag = (history: { uses: string; accounts: string }[]): Tag => ({
  name: 'fediverse',
  url: 'https://llun.test/tags/fediverse',
  history: history.map((point, index) => ({
    day: String(1_700_000_000 - index * 86_400),
    uses: point.uses,
    accounts: point.accounts
  }))
})

describe('getTagUsesHistory', () => {
  it('reverses the newest-first history into oldest→newest daily uses', () => {
    const result = getTagUsesHistory(
      tag([
        { uses: '84', accounts: '40' },
        { uses: '72', accounts: '30' },
        { uses: '60', accounts: '20' }
      ])
    )
    expect(result).toEqual([60, 72, 84])
  })

  it('coerces missing or non-numeric values to zero', () => {
    const result = getTagUsesHistory(
      tag([
        { uses: 'not-a-number', accounts: '1' },
        { uses: '', accounts: '1' }
      ])
    )
    expect(result).toEqual([0, 0])
  })
})

describe('getTagPeoplePast2Days', () => {
  it('sums distinct accounts across the two most recent days', () => {
    const result = getTagPeoplePast2Days(
      tag([
        { uses: '84', accounts: '40' },
        { uses: '72', accounts: '30' },
        { uses: '60', accounts: '20' }
      ])
    )
    expect(result).toBe(70)
  })

  it('returns zero when there is no history', () => {
    expect(getTagPeoplePast2Days(tag([]))).toBe(0)
  })
})
