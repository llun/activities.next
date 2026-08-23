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

    it('converts center (0, 0) to 50% 50%', () => {
      expect(focalPointToCssObjectPosition({ x: 0, y: 0 })).toBe('50% 50%')
    })

    it('converts top-left (-1, 1) to 0% 0%', () => {
      expect(focalPointToCssObjectPosition({ x: -1, y: 1 })).toBe('0% 0%')
    })

    it('converts bottom-right (1, -1) to 100% 100%', () => {
      expect(focalPointToCssObjectPosition({ x: 1, y: -1 })).toBe('100% 100%')
    })

    it('converts top-right (1, 1) to 100% 0%', () => {
      expect(focalPointToCssObjectPosition({ x: 1, y: 1 })).toBe('100% 0%')
    })

    it('converts bottom-left (-1, -1) to 0% 100%', () => {
      expect(focalPointToCssObjectPosition({ x: -1, y: -1 })).toBe('0% 100%')
    })

    it('handles fractional coordinates correctly', () => {
      expect(focalPointToCssObjectPosition({ x: -0.5, y: 0.5 })).toBe('25% 25%')
      expect(focalPointToCssObjectPosition({ x: 0.5, y: -0.5 })).toBe('75% 75%')
    })
  })
})
