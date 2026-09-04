import { describe, expect, it } from 'vitest'

import {
  isCollectionPageUrl,
  parseTotalItems
} from '@/lib/activities/getActorCollections'

describe('parseTotalItems', () => {
  it('returns null for undefined, null, and non-number types', () => {
    expect(parseTotalItems(undefined)).toBeNull()
    expect(parseTotalItems(null)).toBeNull()
    expect(parseTotalItems('10')).toBeNull()
    expect(parseTotalItems({})).toBeNull()
    expect(parseTotalItems([])).toBeNull()
    expect(parseTotalItems(true)).toBeNull()
  })

  it('returns null for negative numbers and non-finite values', () => {
    expect(parseTotalItems(-1)).toBeNull()
    expect(parseTotalItems(-0.5)).toBeNull()
    expect(parseTotalItems(Number.NaN)).toBeNull()
    expect(parseTotalItems(Number.POSITIVE_INFINITY)).toBeNull()
    expect(parseTotalItems(Number.NEGATIVE_INFINITY)).toBeNull()
  })

  it('returns non-negative integers', () => {
    expect(parseTotalItems(0)).toBe(0)
    expect(parseTotalItems(42)).toBe(42)
    expect(parseTotalItems(10.8)).toBe(10)
  })
})

describe('isCollectionPageUrl', () => {
  it('returns true when page url matches collection url exactly', () => {
    expect(
      isCollectionPageUrl(
        'https://example.com/users/alice/followers',
        'https://example.com/users/alice/followers'
      )
    ).toBe(true)
  })

  it('returns true when page url is subpath of collection url', () => {
    expect(
      isCollectionPageUrl(
        'https://example.com/users/alice/followers/page/1',
        'https://example.com/users/alice/followers'
      )
    ).toBe(true)
  })

  it('returns false when host or protocol does not match', () => {
    expect(
      isCollectionPageUrl(
        'https://other.com/users/alice/followers',
        'https://example.com/users/alice/followers'
      )
    ).toBe(false)
  })
})
