import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import {
  analyzeImageBuffer,
  computeBlurhash,
  computeSmartFocus,
  isValidBlurhash
} from './imageAnalysis'

describe('imageAnalysis', () => {
  describe('isValidBlurhash', () => {
    it('validates standard blurhash strings', () => {
      expect(isValidBlurhash('LEHV6nWB2yk8pyo0adR*.7kCMdnj')).toBe(true)
      expect(isValidBlurhash('LGF5]+Yk^6#M@-5c,1J5@[or[Q6.')).toBe(true)
    })

    it('rejects invalid, empty, or non-string inputs', () => {
      expect(isValidBlurhash('')).toBe(false)
      expect(isValidBlurhash('abc')).toBe(false) // too short (< 6 chars)
      expect(isValidBlurhash(null)).toBe(false)
      expect(isValidBlurhash(undefined)).toBe(false)
      expect(isValidBlurhash('invalid spaces in hash')).toBe(false)
    })
  })

  describe('computeBlurhash', () => {
    it('computes a valid blurhash for a PNG image', async () => {
      const svg =
        '<svg width="200" height="100"><rect width="200" height="100" fill="blue"/><circle cx="50" cy="50" r="30" fill="red"/></svg>'
      const buffer = await sharp(Buffer.from(svg)).png().toBuffer()

      const hash = await computeBlurhash(buffer)
      expect(hash).not.toBeNull()
      expect(typeof hash).toBe('string')
      expect(isValidBlurhash(hash)).toBe(true)
    })

    it('returns null on a corrupt buffer without throwing', async () => {
      const corruptBuffer = Buffer.from('not-an-image-payload')
      const hash = await computeBlurhash(corruptBuffer)
      expect(hash).toBeNull()
    })
  })

  describe('computeSmartFocus', () => {
    it('detects top-left focal point for an image with subject at top-left', async () => {
      const svg =
        '<svg width="200" height="100"><rect width="200" height="100" fill="white"/><circle cx="20" cy="20" r="15" fill="black"/></svg>'
      const buffer = await sharp(Buffer.from(svg)).png().toBuffer()

      const focus = await computeSmartFocus(buffer)
      expect(focus).not.toBeNull()
      expect(focus!.x).toBeLessThan(0) // left
      expect(focus!.y).toBeGreaterThan(0) // top
    })

    it('detects bottom-right focal point for an image with subject at bottom-right', async () => {
      const svg =
        '<svg width="200" height="100"><rect width="200" height="100" fill="white"/><circle cx="180" cy="80" r="15" fill="black"/></svg>'
      const buffer = await sharp(Buffer.from(svg)).png().toBuffer()

      const focus = await computeSmartFocus(buffer)
      expect(focus).not.toBeNull()
      expect(focus!.x).toBeGreaterThan(0) // right
      expect(focus!.y).toBeLessThan(0) // bottom
    })

    it('returns center or valid point for uniform image', async () => {
      const svg =
        '<svg width="100" height="100"><rect width="100" height="100" fill="white"/></svg>'
      const buffer = await sharp(Buffer.from(svg)).png().toBuffer()

      const focus = await computeSmartFocus(buffer)
      expect(focus).not.toBeNull()
      expect(focus!.x).toBeGreaterThanOrEqual(-1)
      expect(focus!.x).toBeLessThanOrEqual(1)
      expect(focus!.y).toBeGreaterThanOrEqual(-1)
      expect(focus!.y).toBeLessThanOrEqual(1)
    })

    it('handles EXIF orientation swapping dimensions correctly', async () => {
      // 200 wide x 100 high image with orientation 6 (90 deg rotate) becomes 100 wide x 200 high
      const svg =
        '<svg width="200" height="100"><rect width="200" height="100" fill="white"/><circle cx="180" cy="80" r="15" fill="black"/></svg>'
      const buffer = await sharp(Buffer.from(svg))
        .jpeg()
        .withMetadata({ orientation: 6 })
        .toBuffer()

      const focus = await computeSmartFocus(buffer)
      expect(focus).not.toBeNull()
      expect(focus!.x).toBeGreaterThanOrEqual(-1)
      expect(focus!.x).toBeLessThanOrEqual(1)
      expect(focus!.y).toBeGreaterThanOrEqual(-1)
      expect(focus!.y).toBeLessThanOrEqual(1)
    })

    it('returns null on a corrupt buffer without throwing', async () => {
      const corruptBuffer = Buffer.from('corrupt-bytes')
      const focus = await computeSmartFocus(corruptBuffer)
      expect(focus).toBeNull()
    })
  })

  describe('analyzeImageBuffer', () => {
    it('returns both blurhash and smart focus for a valid image', async () => {
      const svg =
        '<svg width="150" height="200"><rect width="150" height="200" fill="green"/><circle cx="75" cy="50" r="25" fill="yellow"/></svg>'
      const buffer = await sharp(Buffer.from(svg)).jpeg().toBuffer()

      const result = await analyzeImageBuffer(buffer)
      expect(result.blurhash).not.toBeNull()
      expect(isValidBlurhash(result.blurhash)).toBe(true)
      expect(result.focus).not.toBeNull()
      expect(result.focus!.x).toBeGreaterThanOrEqual(-1)
      expect(result.focus!.x).toBeLessThanOrEqual(1)
      expect(result.focus!.y).toBeGreaterThanOrEqual(-1)
      expect(result.focus!.y).toBeLessThanOrEqual(1)
    })

    it('preserves manual focus when provided', async () => {
      const svg =
        '<svg width="100" height="100"><rect width="100" height="100" fill="white"/></svg>'
      const buffer = await sharp(Buffer.from(svg)).png().toBuffer()

      const manualFocus = { x: 0.8, y: -0.4 }
      const result = await analyzeImageBuffer(buffer, { manualFocus })
      expect(result.blurhash).not.toBeNull()
      expect(result.focus).toEqual(manualFocus)
    })

    it('returns nulls for corrupt data without throwing', async () => {
      const corruptBuffer = Buffer.from('garbage-data')
      const result = await analyzeImageBuffer(corruptBuffer)
      expect(result).toEqual({ blurhash: null, focus: null })
    })
  })
})
