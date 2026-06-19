import { z } from 'zod'

import { clampedLimit, clampedOffset } from './clampedLimit'

describe('clampedLimit', () => {
  const schema = clampedLimit(40, 20)

  it.each([
    ['absent (undefined)', undefined, 20],
    ['null', null, 20],
    ['empty string', '', 20],
    ['whitespace only', '   ', 20],
    ['non-numeric', 'abc', 20],
    ['within range', '30', 30],
    ['at the max', '40', 40],
    ['above the max clamps down', '41', 40],
    ['far above the max clamps down', '100', 40],
    ['below the min clamps up', '0', 1],
    ['negative clamps up', '-5', 1],
    ['fractional truncates', '40.9', 40],
    ['infinity falls back', 'Infinity', 20],
    ['negative infinity falls back', '-Infinity', 20],
    ['overflow to infinity falls back', '1e500', 20],
    ['NaN string falls back', 'NaN', 20]
  ])('clamps %s to %d', (_label, input, expected) => {
    expect(schema.parse(input)).toBe(expected)
  })

  it('never fails parsing for a well-formed but out-of-range value', () => {
    const result = schema.safeParse('100')
    expect(result.success).toBe(true)
    expect(result.data).toBe(40)
  })

  it('works inside an object schema without failing the whole parse', () => {
    const object = z.object({ limit: clampedLimit(40, 20) })
    const parsed = object.safeParse({ limit: '100' })
    expect(parsed.success).toBe(true)
    expect(parsed.data?.limit).toBe(40)
  })

  it('respects a custom minimum', () => {
    const minTwo = clampedLimit(80, 40, 2)
    expect(minTwo.parse('1')).toBe(2)
  })

  it('clamps an out-of-range fallback into [min, max]', () => {
    // The absent-value path returns the (clamped) fallback even if a caller
    // passes one outside [min, max].
    expect(clampedLimit(40, 1000).parse(undefined)).toBe(40)
    expect(clampedLimit(40, 0).parse(undefined)).toBe(1)
  })
})

describe('clampedOffset', () => {
  const schema = clampedOffset(10000)

  it.each([
    ['absent (undefined)', undefined, 0],
    ['null', null, 0],
    ['empty string', '', 0],
    ['whitespace only', '   ', 0],
    ['non-numeric', 'abc', 0],
    ['within range', '40', 40],
    ['at the max', '10000', 10000],
    ['above the max clamps down', '10001', 10000],
    ['negative clamps up', '-1', 0],
    ['fractional truncates', '40.9', 40],
    ['infinity falls back', 'Infinity', 0],
    ['NaN string falls back', 'NaN', 0]
  ])('clamps %s to %d', (_label, input, expected) => {
    expect(schema.parse(input)).toBe(expected)
  })

  it('defaults to no maximum when none is given', () => {
    const unbounded = clampedOffset()
    expect(unbounded.parse('999999')).toBe(999999)
  })

  it('clamps an out-of-range fallback into [0, max]', () => {
    expect(clampedOffset(100, 500).parse(undefined)).toBe(100)
  })
})
