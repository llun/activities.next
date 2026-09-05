import { describe, expect, it } from 'vitest'

import { calculatePolynomialBackoffSeconds } from './retry'

describe('calculatePolynomialBackoffSeconds', () => {
  it('returns base delay of 15 seconds for attempt 0', () => {
    const delay = calculatePolynomialBackoffSeconds(0, { jitter: false })
    expect(delay).toBe(15)
  })

  it('calculates (count^4) + 15 without jitter', () => {
    expect(calculatePolynomialBackoffSeconds(1, { jitter: false })).toBe(16)
    expect(calculatePolynomialBackoffSeconds(2, { jitter: false })).toBe(31)
    expect(calculatePolynomialBackoffSeconds(3, { jitter: false })).toBe(96)
    expect(calculatePolynomialBackoffSeconds(4, { jitter: false })).toBe(271)
  })

  it('adds jitter within [0, 0.5 * count^4] when jitter is enabled', () => {
    for (let attempt = 1; attempt <= 5; attempt++) {
      const base = Math.pow(attempt, 4) + 15
      const maxJitter = 0.5 * Math.pow(attempt, 4)
      const delay = calculatePolynomialBackoffSeconds(attempt, { jitter: true })
      expect(delay).toBeGreaterThanOrEqual(base)
      expect(delay).toBeLessThanOrEqual(base + maxJitter)
    }
  })

  it('caps delay at maxDelaySeconds', () => {
    const delay = calculatePolynomialBackoffSeconds(15, {
      maxDelaySeconds: 3600
    })
    expect(delay).toBeLessThanOrEqual(3600)
  })
})
