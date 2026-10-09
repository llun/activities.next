import { describe, expect, it } from 'vitest'

import {
  clampFocalPoint,
  focalPointToCssObjectPosition,
  isValidFocalPoint
} from './focalPoint'

describe('focalPoint', () => {
  describe('clampFocalPoint', () => {
    it('keeps values within [-1, 1] unchanged', () => {
      expect(clampFocalPoint(0, 0)).toEqual({ x: 0, y: 0 })
      expect(clampFocalPoint(-0.5, 0.75)).toEqual({ x: -0.5, y: 0.75 })
      expect(clampFocalPoint(-1, 1)).toEqual({ x: -1, y: 1 })
      expect(clampFocalPoint(1, -1)).toEqual({ x: 1, y: -1 })
    })

    it('clamps values exceeding [-1, 1]', () => {
      expect(clampFocalPoint(-2, 3)).toEqual({ x: -1, y: 1 })
      expect(clampFocalPoint(1.5, -1.8)).toEqual({ x: 1, y: -1 })
    })

    it('falls back to 0 for non-finite values', () => {
      expect(clampFocalPoint(NaN, Infinity)).toEqual({ x: 0, y: 0 })
    })
  })

  describe('isValidFocalPoint', () => {
    it('returns true for valid coordinates', () => {
      expect(isValidFocalPoint(0, 0)).toBe(true)
      expect(isValidFocalPoint(-1, 1)).toBe(true)
      expect(isValidFocalPoint(1, -1)).toBe(true)
      expect(isValidFocalPoint(0.5, -0.5)).toBe(true)
    })

    it('returns false for out-of-range or non-finite values', () => {
      expect(isValidFocalPoint(-1.1, 0)).toBe(false)
      expect(isValidFocalPoint(0, 1.1)).toBe(false)
      expect(isValidFocalPoint(NaN, 0)).toBe(false)
      expect(isValidFocalPoint(0, Infinity)).toBe(false)
    })
  })

  describe('focalPointToCssObjectPosition', () => {
    it('defaults to 50% 50% when no focus is provided', () => {
      expect(focalPointToCssObjectPosition(null)).toBe('50% 50%')
      expect(focalPointToCssObjectPosition(undefined)).toBe('50% 50%')
    })

    it.each([
      { focus: { x: 0, y: 0 }, expected: '50% 50%', name: 'center' },
      { focus: { x: -1, y: 1 }, expected: '0% 0%', name: 'top-left' },
      { focus: { x: 1, y: -1 }, expected: '100% 100%', name: 'bottom-right' },
      { focus: { x: 1, y: 1 }, expected: '100% 0%', name: 'top-right' },
      { focus: { x: -1, y: -1 }, expected: '0% 100%', name: 'bottom-left' },
      { focus: { x: -0.5, y: 0.5 }, expected: '25% 25%', name: 'fractional' },
      { focus: { x: 0.5, y: -0.5 }, expected: '75% 75%', name: 'fractional' }
    ])(
      'converts $name ($focus.x, $focus.y) to $expected',
      ({ focus, expected }) => {
        expect(focalPointToCssObjectPosition(focus)).toBe(expected)
      }
    )
  })
})
