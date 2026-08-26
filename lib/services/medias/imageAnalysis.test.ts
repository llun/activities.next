import { decode, encode, isBlurhashValid } from 'blurhash'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import {
  analyzeImageBuffer,
  computeBlurhash,
  computeSmartFocus,
  normalizeBlurhash
} from './imageAnalysis'

describe('imageAnalysis', () => {
  describe('normalizeBlurhash', () => {
    const VALID_HASH = 'L6PZfSi_.AyE_3t7t7R**0o#DgR4'

    it('returns standard blurhash strings unchanged', () => {
      expect(normalizeBlurhash('LEHV6nWB2yk8pyo0adR*.7kCMdnj')).toBe(
        'LEHV6nWB2yk8pyo0adR*.7kCMdnj'
      )
      expect(normalizeBlurhash('LGF5]+Yk^6#M@-5c,1J5@[or[Q6.')).toBe(
        'LGF5]+Yk^6#M@-5c,1J5@[or[Q6.'
      )
    })

    it('rejects invalid, empty, or non-string inputs', () => {
      expect(normalizeBlurhash('')).toBeNull()
      expect(normalizeBlurhash('abc')).toBeNull() // too short (< 6 chars)
      expect(normalizeBlurhash(null)).toBeNull()
      expect(normalizeBlurhash(undefined)).toBeNull()
      expect(normalizeBlurhash('invalid spaces in hash')).toBeNull()
    })

    // The value stored has to be the value checked. The check has always
    // compared the trimmed form, so answering with a boolean let the caller
    // persist the padded original: approved here, undecodable at render time.
    it.each([
      { description: 'a trailing space', padded: `${VALID_HASH} ` },
      { description: 'a leading space', padded: ` ${VALID_HASH}` },
      { description: 'a leading newline', padded: `\n${VALID_HASH}` },
      { description: 'padding on both sides', padded: `  ${VALID_HASH}  ` }
    ])(
      'returns the decodable form of a hash with $description',
      ({ padded }) => {
        // The premise: the padded form is the one `decode` cannot read.
        expect(() => decode(padded, 32, 32)).toThrow()

        const normalized = normalizeBlurhash(padded)
        expect(normalized).toBe(VALID_HASH)
        expect(() => decode(normalized as string, 32, 32)).not.toThrow()
      }
    )

    // The charset alone says nothing about structure: the required length is
    // `4 + 2 * componentX * componentY`, derived from the size flag in the
    // first character. Each of these is legal base83 of a legal length and
    // throws inside `decode`, so a charset-only check stored a value that
    // failed every time a client rendered the post.
    it.each([
      {
        description: 'too short for its size flag',
        blurhash: 'aaaaaa',
        requiredLength: 14
      },
      {
        description: 'too long for its size flag',
        blurhash: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        requiredLength: 12
      },
      {
        description: 'a truncated real hash',
        blurhash: 'LEHV6nWB2yk8',
        requiredLength: 28
      }
    ])('rejects a hash $description', ({ blurhash, requiredLength }) => {
      // The premise: legal charset, legal length, and still undecodable.
      expect(blurhash).toMatch(/^[0-9a-zA-Z#$%*+,\-.:;=?@[\]^_{|}~]{6,166}$/)
      expect(() => decode(blurhash, 32, 32)).toThrow(
        new RegExp(`should be ${requiredLength}`)
      )

      expect(normalizeBlurhash(blurhash)).toBeNull()
    })

    // The structural check does NOT look at the alphabet, so the regex is not
    // redundant: each of these has the right length for its size flag and
    // `decode` returns pixels for characters outside base83.
    //
    // The space is INTERIOR deliberately. A trailing one is trimmed away
    // before the regex sees it, leaving a 27-character body that the regex
    // accepts and the structural half rejects for its length - which would
    // pin the opposite of what this block claims.
    it.each([
      {
        description: 'an exclamation mark',
        blurhash: 'L6PZfSi_.AyE_3t7t7R**0o#DgR!'
      },
      { description: 'a backslash', blurhash: 'L6PZfSi_.AyE_3t7t7R**0o#DgR\\' },
      {
        description: 'an interior space',
        blurhash: 'L6PZfSi_.AyE_3t7 7R**0o#DgR4'
      }
    ])(
      'rejects a right-length hash containing $description',
      ({ blurhash }) => {
        expect(isBlurhashValid(blurhash).result).toBe(true)
        expect(normalizeBlurhash(blurhash)).toBeNull()
      }
    )

    // The length cap used to be 100 characters, two short of a 7x7 hash, so a
    // remote encoding at more than 48 components had its blurhash dropped even
    // though `decode` reads it fine.
    it.each([
      {
        description: '6x8, the widest the old 100-character cap allowed',
        componentX: 6,
        componentY: 8
      },
      {
        description: '7x7, two characters past it',
        componentX: 7,
        componentY: 7
      },
      {
        description: '9x9, the most components encode accepts',
        componentX: 9,
        componentY: 9
      }
    ])(
      'accepts a hash encoded at $description',
      ({ componentX, componentY }) => {
        const pixels = new Uint8ClampedArray(64 * 64 * 4).fill(128)
        const hash = encode(pixels, 64, 64, componentX, componentY)

        expect(() => decode(hash, 32, 32)).not.toThrow()
        expect(normalizeBlurhash(hash)).toBe(hash)
      }
    )

    it('accepts a hash this instance encoded itself', async () => {
      const image = await sharp({
        create: {
          width: 64,
          height: 64,
          channels: 3,
          background: { r: 120, g: 80, b: 40 }
        }
      })
        .png()
        .toBuffer()

      const hash = await computeBlurhash(image)
      expect(hash).not.toBeNull()
      expect(normalizeBlurhash(hash)).toBe(hash)
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
      expect(normalizeBlurhash(hash)).toBe(hash)
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
      expect(normalizeBlurhash(result.blurhash)).toBe(result.blurhash)
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
