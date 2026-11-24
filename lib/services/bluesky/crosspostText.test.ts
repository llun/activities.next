import sharp from 'sharp'

import {
  BLUESKY_MAX_IMAGE_BYTES,
  BlueskyImageFormatError,
  buildCrosspostText,
  fitImageForBluesky,
  markdownToBlueskyPlainText
} from '@/lib/services/bluesky/crosspostText'
import {
  BLUESKY_MAX_GRAPHEMES,
  BLUESKY_MAX_UTF8_BYTES,
  countBlueskyGraphemes,
  countBlueskyUtf8Bytes
} from '@/lib/utils/blueskyText'

const URL = 'https://social.example/users/alice/statuses/1'

// Deterministic noise, so a re-encode test does not flake on a lucky seed.
const noise = (width: number, height: number, channels: number) => {
  const buffer = Buffer.alloc(width * height * channels)
  let state = 0x9e3779b9
  for (let index = 0; index < buffer.length; index += 1) {
    state ^= state << 13
    state >>>= 0
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    buffer[index] = state & 0xff
  }
  return buffer
}

describe('markdownToBlueskyPlainText', () => {
  it('turns a link into its label and URL', () => {
    expect(
      markdownToBlueskyPlainText('Read [the post](https://example.com/post)')
    ).toBe('Read the post https://example.com/post')
  })

  it('keeps only the URL when the label is the URL', () => {
    expect(
      markdownToBlueskyPlainText(
        '[https://example.com/post](https://example.com/post)'
      )
    ).toBe('https://example.com/post')
  })

  it('strips emphasis markers and keeps their text', () => {
    expect(
      markdownToBlueskyPlainText('**bold** _italic_ ~~strike~~ *also*')
    ).toBe('bold italic strike also')
  })

  it('strips code fences and backticks but keeps the code text', () => {
    expect(markdownToBlueskyPlainText('```js\nconst a = 1\n```')).toBe(
      'const a = 1'
    )
    expect(markdownToBlueskyPlainText('Run `yarn test` now')).toBe(
      'Run yarn test now'
    )
  })

  it('does not read Markdown inside code', () => {
    expect(markdownToBlueskyPlainText('`[a](b)`')).toBe('[a](b)')
  })

  it('leaves bare URLs, #tags and @mentions as they are', () => {
    expect(
      markdownToBlueskyPlainText(
        'See https://example.com/a_b_c #tag @alice@example.com'
      )
    ).toBe('See https://example.com/a_b_c #tag @alice@example.com')
  })

  it('keeps snake_case and line breaks', () => {
    expect(markdownToBlueskyPlainText('some_snake_case\nsecond line')).toBe(
      'some_snake_case\nsecond line'
    )
  })

  it('turns an image into its alt text and URL', () => {
    expect(
      markdownToBlueskyPlainText('![a cat](https://example.com/cat.png)')
    ).toBe('a cat https://example.com/cat.png')
  })

  it('strips heading, blockquote and list markers but keeps the text', () => {
    expect(
      markdownToBlueskyPlainText('# Title\n> quoted\n- one\n* two\n1. three')
    ).toBe('Title\nquoted\none\ntwo\nthree')
  })

  it('turns an autolink into the bare URL', () => {
    expect(markdownToBlueskyPlainText('See <https://example.com/a>')).toBe(
      'See https://example.com/a'
    )
  })

  it('resolves a reference link with its definition', () => {
    expect(
      markdownToBlueskyPlainText(
        'Read [the post][1]\n\n[1]: https://example.com/post'
      )
    ).toBe('Read the post https://example.com/post')
  })
})

describe('buildCrosspostText', () => {
  it('returns text that fits unchanged', () => {
    expect(buildCrosspostText({ text: 'Hello Bluesky', fullUrl: URL })).toEqual(
      {
        text: 'Hello Bluesky',
        truncated: false
      }
    )
  })

  it('returns text at exactly the grapheme limit unchanged', () => {
    const text = 'a'.repeat(BLUESKY_MAX_GRAPHEMES)
    expect(buildCrosspostText({ text, fullUrl: URL })).toEqual({
      text,
      truncated: false
    })
  })

  it('cuts long ASCII text at a sentence end and appends the link', () => {
    const sentence = 'This is a sentence that ends here. '
    const text = sentence.repeat(20)
    const result = buildCrosspostText({ text, fullUrl: URL })

    expect(result.truncated).toBe(true)
    expect(result.text.endsWith(`… ${URL}`)).toBe(true)
    expect(result.text.startsWith('This is a sentence that ends here.')).toBe(
      true
    )
    expect(countBlueskyGraphemes(result.text)).toBeLessThanOrEqual(
      BLUESKY_MAX_GRAPHEMES
    )
    expect(countBlueskyUtf8Bytes(result.text)).toBeLessThanOrEqual(
      BLUESKY_MAX_UTF8_BYTES
    )
  })

  it('cuts CJK text at a CJK sentence end', () => {
    const text = 'これは文です。'.repeat(60)
    const result = buildCrosspostText({ text, fullUrl: URL })

    expect(result.truncated).toBe(true)
    expect(result.text.startsWith('これは文です。')).toBe(true)
    expect(result.text.endsWith(`… ${URL}`)).toBe(true)
    expect(countBlueskyGraphemes(result.text)).toBeLessThanOrEqual(
      BLUESKY_MAX_GRAPHEMES
    )
  })

  it('never splits an emoji grapheme', () => {
    const text = '👨‍👩‍👧‍👦'.repeat(400)
    const result = buildCrosspostText({ text, fullUrl: URL })

    expect(result.truncated).toBe(true)
    expect(countBlueskyGraphemes(result.text)).toBeLessThanOrEqual(
      BLUESKY_MAX_GRAPHEMES
    )
    expect(countBlueskyUtf8Bytes(result.text)).toBeLessThanOrEqual(
      BLUESKY_MAX_UTF8_BYTES
    )
    // A split grapheme would leave a lone surrogate or ZWJ at the cut.
    expect(result.text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)
    expect(result.text).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/)
  })

  it('cuts by bytes when few graphemes are many bytes', () => {
    const text = '👨‍👩‍👧‍👦'.repeat(200)
    expect(countBlueskyGraphemes(text)).toBeLessThanOrEqual(
      BLUESKY_MAX_GRAPHEMES
    )
    expect(countBlueskyUtf8Bytes(text)).toBeGreaterThan(BLUESKY_MAX_UTF8_BYTES)

    const result = buildCrosspostText({ text, fullUrl: URL })
    expect(result.truncated).toBe(true)
    expect(countBlueskyUtf8Bytes(result.text)).toBeLessThanOrEqual(
      BLUESKY_MAX_UTF8_BYTES
    )
  })

  it('cuts at a word when no sentence end is close enough', () => {
    const text = 'word '.repeat(100)
    const result = buildCrosspostText({ text, fullUrl: URL })

    expect(result.truncated).toBe(true)
    expect(result.text.endsWith(`… ${URL}`)).toBe(true)
    expect(result.text).not.toContain('  ')
  })

  it('appends the link on a new paragraph when forced and nothing is cut', () => {
    expect(
      buildCrosspostText({ text: 'Short', fullUrl: URL, forceLink: true })
    ).toEqual({ text: `Short\n\n${URL}`, truncated: false })
  })

  it('cuts and appends the link when forced and the text is long', () => {
    const text = 'a'.repeat(400)
    const result = buildCrosspostText({
      text,
      fullUrl: URL,
      forceLink: true
    })

    expect(result.truncated).toBe(true)
    expect(result.text.endsWith(`… ${URL}`)).toBe(true)
    expect(countBlueskyGraphemes(result.text)).toBeLessThanOrEqual(
      BLUESKY_MAX_GRAPHEMES
    )
  })

  it('honours a smaller maxGraphemes', () => {
    const result = buildCrosspostText({
      text: 'Hello there, this is a longer post that keeps going for a while.',
      fullUrl: URL,
      maxGraphemes: 60
    })

    expect(result.truncated).toBe(true)
    expect(countBlueskyGraphemes(result.text)).toBeLessThanOrEqual(60)
  })

  it('never cuts inside a URL', () => {
    const longUrl = `https://example.com/${'x'.repeat(80)}`
    const text = `${'a'.repeat(200)} ${longUrl}`
    const result = buildCrosspostText({ text, fullUrl: URL })

    expect(result.truncated).toBe(true)
    expect(result.text).not.toContain('https://example.com')
    expect(result.text.endsWith(`… ${URL}`)).toBe(true)
  })

  it('drops a URL that would be cut in the middle', () => {
    // A post that is just a long link: no word boundary saves the cut, so the
    // URL must be dropped rather than left broken.
    const longUrl = `https://example.com/${'x'.repeat(400)}`
    const result = buildCrosspostText({ text: longUrl, fullUrl: URL })

    expect(result.truncated).toBe(true)
    expect(result.text).not.toContain('https://example.com')
    expect(result.text).toBe(URL)
  })
})

describe('fitImageForBluesky', () => {
  it('keeps a small PNG as it is', async () => {
    const png = await sharp({
      create: {
        width: 20,
        height: 10,
        channels: 4,
        background: { r: 10, g: 20, b: 30, alpha: 1 }
      }
    })
      .png()
      .toBuffer()

    const result = await fitImageForBluesky(png)
    expect(result.mimeType).toBe('image/png')
    expect(result.bytes.equals(png)).toBe(true)
    expect(result.width).toBe(20)
    expect(result.height).toBe(10)
  })

  it('keeps a small JPEG as it is', async () => {
    const jpeg = await sharp({
      create: {
        width: 20,
        height: 10,
        channels: 3,
        background: { r: 10, g: 20, b: 30 }
      }
    })
      .jpeg()
      .toBuffer()

    const result = await fitImageForBluesky(jpeg)
    expect(result.mimeType).toBe('image/jpeg')
    expect(result.bytes.equals(jpeg)).toBe(true)
  })

  it('re-encodes a big noisy PNG to a JPEG under the limit', async () => {
    const png = await sharp(noise(1400, 1400, 3), {
      raw: { width: 1400, height: 1400, channels: 3 }
    })
      .png()
      .toBuffer()
    expect(png.byteLength).toBeGreaterThan(BLUESKY_MAX_IMAGE_BYTES)

    const result = await fitImageForBluesky(png)
    expect(result.mimeType).toBe('image/jpeg')
    expect(result.bytes.byteLength).toBeLessThanOrEqual(BLUESKY_MAX_IMAGE_BYTES)
    expect(result.width).toBeLessThanOrEqual(1400)
    expect(result.height).toBeLessThanOrEqual(1400)
  })

  it('flattens a transparent image onto white when re-encoding', async () => {
    const png = await sharp(noise(1400, 1400, 4), {
      raw: { width: 1400, height: 1400, channels: 4 }
    })
      .png()
      .toBuffer()

    const result = await fitImageForBluesky(png)
    expect(result.mimeType).toBe('image/jpeg')
    expect(result.bytes.byteLength).toBeLessThanOrEqual(BLUESKY_MAX_IMAGE_BYTES)
  })

  it('rejects an SVG', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>'
    )

    await expect(fitImageForBluesky(svg)).rejects.toBeInstanceOf(
      BlueskyImageFormatError
    )
  })

  it('re-encodes a GIF to a JPEG', async () => {
    const gif = await sharp({
      create: { width: 20, height: 10, channels: 3, background: '#0f0' }
    })
      .gif()
      .toBuffer()

    const result = await fitImageForBluesky(gif)
    expect(result.mimeType).toBe('image/jpeg')
  })

  it('refuses an image over the pixel limit', async () => {
    // A valid PNG whose IHDR declares 12000x12000 (144 MP): over this
    // instance's 100 MP cap, but under sharp's own default, so only the
    // explicit limit refuses it.
    const png = await sharp({
      create: { width: 4, height: 4, channels: 3, background: '#fff' }
    })
      .png()
      .toBuffer()
    const huge = Buffer.from(png)
    huge.writeUInt32BE(12_000, 16)
    huge.writeUInt32BE(12_000, 20)
    huge.writeUInt32BE(pngCrc32(huge.subarray(12, 29)), 29)

    await expect(fitImageForBluesky(huge)).rejects.toBeInstanceOf(
      BlueskyImageFormatError
    )
  })
})

// CRC-32 of a PNG chunk, so a patched IHDR stays a readable PNG header.
const pngCrc32 = (buffer: Buffer): number => {
  const table: number[] = []
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (const byte of buffer) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
