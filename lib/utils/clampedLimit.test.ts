import { z } from 'zod'

import { clampedLimit, clampedOffset } from './clampedLimit'

describe('clampedLimit', () => {
  const schema = clampedLimit(40, 20)

  it.each([
    ['absent (undefined)', undefined, 20],
    ['empty string', '', 20],
    ['non-numeric', 'abc', 20],
    ['within range', '30', 30],
    ['at the max', '40', 40],
    ['above the max clamps down', '41', 40],
    ['far above the max clamps down', '100', 40],
    ['below the min clamps up', '0', 1],
    ['negative clamps up', '-5', 1],
    ['fractional truncates', '40.9', 40]
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
})

describe('clampedOffset', () => {
  const schema = clampedOffset(10000)

  it.each([
    ['absent (undefined)', undefined, 0],
    ['non-numeric', 'abc', 0],
    ['within range', '40', 40],
    ['at the max', '10000', 10000],
    ['above the max clamps down', '10001', 10000],
    ['negative clamps up', '-1', 0]
  ])('clamps %s to %d', (_label, input, expected) => {
    expect(schema.parse(input)).toBe(expected)
  })

  it('defaults to no maximum when none is given', () => {
    const unbounded = clampedOffset()
    expect(unbounded.parse('999999')).toBe(999999)
  })
})
