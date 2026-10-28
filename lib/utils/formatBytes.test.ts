import { describe, expect, it } from 'vitest'

import { formatBytes } from './formatBytes'

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [23, '23 B'],
    [1024, '1.0 KB'],
    [1536, '1.5 KB'],
    [1024 ** 2, '1.0 MB'],
    [2.4 * 1024 ** 3, '2.4 GB']
  ])('formats %i bytes as %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected)
  })
})
