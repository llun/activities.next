import sharp from 'sharp'

import {
  BLUESKY_MAX_IMAGE_BYTES,
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

    const result = await fitImageForBluesky(png, 'image/png')
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

    const result = await fitImageForBluesky(jpeg, 'image/jpeg')
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

    const result = await fitImageForBluesky(png, 'image/png')
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

    const result = await fitImageForBluesky(png, 'image/png')
    expect(result.mimeType).toBe('image/jpeg')
    expect(result.bytes.byteLength).toBeLessThanOrEqual(BLUESKY_MAX_IMAGE_BYTES)
  })
})
