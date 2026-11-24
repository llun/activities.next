import sharp from 'sharp'

import {
  BLUESKY_MAX_IMAGE_BYTES,
  BlueskyImageFormatError,
  buildCrosspostText,
  fitImageForBluesky,
  markdownToBlueskyPlainText,
  pollHtmlToBlueskyPlainText
} from '@/lib/services/bluesky/crosspostText'
import { buildBlueskyFacets } from '@/lib/services/bluesky/richText'
import {
  BLUESKY_MAX_GRAPHEMES,
  BLUESKY_MAX_UTF8_BYTES,
  countBlueskyGraphemes,
  countBlueskyUtf8Bytes
} from '@/lib/utils/blueskyText'
import { convertMarkdownText } from '@/lib/utils/text/convertMarkdownText'

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

describe('pollHtmlToBlueskyPlainText', () => {
  const renderPollHtml = convertMarkdownText('llun.test')

  it.each([
    {
      description: 'keeps paragraphs as blank lines',
      html: '<p>First</p>\n<p>Second</p>',
      expected: 'First\n\nSecond'
    },
    {
      description: 'keeps br as a line break',
      html: '<p>Line one<br>Line two</p>',
      expected: 'Line one\nLine two'
    },
    {
      description:
        'drops tags and decodes entities, keeping hashtags and mentions',
      html: '<p>Best <a href="/tags/tea" class="hashtag" rel="tag">#<span>tea</span></a> &amp; <span class="h-card"><a href="https://llun.test/@alice" class="u-url mention">@<span>alice</span></a></span>?</p>',
      expected: 'Best #tea & @alice?'
    },
    {
      description: 'passes plain text through',
      html: 'Which one?',
      expected: 'Which one?'
    }
  ])('$description', ({ html, expected }) => {
    expect(pollHtmlToBlueskyPlainText(html)).toBe(expected)
  })

  it('keeps https:// on a bare short URL and produces a link facet', async () => {
    const markdown = 'Check https://example.com/docs for info'
    const text = pollHtmlToBlueskyPlainText(renderPollHtml(markdown))

    expect(text).toBe('Check https://example.com/docs for info')
    expect(text).toBe(markdownToBlueskyPlainText(markdown))
    await expect(buildBlueskyFacets(text)).resolves.toEqual([
      {
        index: { byteStart: 6, byteEnd: 30 },
        features: [
          {
            $type: 'app.bsky.richtext.facet#link',
            uri: 'https://example.com/docs'
          }
        ]
      }
    ])
  })

  it.each([
    {
      description: 'does not truncate a long bare URL',
      markdown:
        'Read https://www.example.com/very/long/path/that/exceeds/thirty/characters?a=1&b=2',
      expected:
        'Read https://www.example.com/very/long/path/that/exceeds/thirty/characters?a=1&b=2'
    },
    {
      description: 'keeps label and URL for markdown links',
      markdown: 'See [the docs](https://example.com/docs) for details',
      expected: 'See the docs https://example.com/docs for details'
    },
    {
      description: 'turns an image with alt text into alt and src',
      markdown: '![a cat](https://example.com/cat.png)',
      expected: 'a cat https://example.com/cat.png'
    },
    {
      description: 'turns an image without alt text into its src',
      markdown: '![](https://example.com/cat.png)',
      expected: 'https://example.com/cat.png'
    },
    {
      description: 'puts each list item on its own line',
      markdown: '- one\n- two\n- three',
      expected: 'one\ntwo\nthree'
    },
    {
      description:
        'separates fenced code from a following paragraph and keeps indentation',
      markdown: '```js\nconst a = 1\n  const b = 2\n```\n\nAfter code',
      expected: 'const a = 1\n  const b = 2\n\nAfter code'
    },
    {
      description: 'separates a heading from a following paragraph',
      markdown: '# Poll question\n\nPick an option',
      expected: 'Poll question\n\nPick an option'
    },
    {
      description: 'keeps remote mention domains intact',
      markdown: 'Ask @alice@mastodon.social about this',
      expected: 'Ask @alice@mastodon.social about this'
    },
    {
      description: 'decodes entities alongside hashtags',
      markdown: 'Best #tea & coffee?',
      expected: 'Best #tea & coffee?'
    },
    {
      description: 'keeps blockquotes separated from following paragraphs',
      markdown: '> quoted line\n\nAfter quote',
      expected: 'quoted line\n\nAfter quote'
    }
  ])('$description (via convertMarkdownText)', ({ markdown, expected }) => {
    const html = renderPollHtml(markdown)
    const text = pollHtmlToBlueskyPlainText(html)
    expect(text).toBe(expected)
    expect(text).toBe(markdownToBlueskyPlainText(markdown))
  })

  it('does not leak markup when a link title contains <br> and </p>', () => {
    const markdown =
      'See [the docs](https://example.com/docs "line <br> break </p> end") for details'
    const text = pollHtmlToBlueskyPlainText(renderPollHtml(markdown))

    expect(text).toBe('See the docs https://example.com/docs for details')
    expect(text).not.toContain('<br>')
    expect(text).not.toContain('</p>')
    expect(text).not.toContain('title=')
  })

  it('keeps &lt;script&gt; as literal <script> text', () => {
    const markdown = 'Use &lt;script&gt; carefully'
    const text = pollHtmlToBlueskyPlainText(renderPollHtml(markdown))

    expect(text).toBe('Use <script> carefully')
  })

  it.each([
    {
      description: 'omits mailto: href from email autolinks',
      markdown: 'Email alice@example.com',
      expected: 'Email alice@example.com'
    },
    {
      description: 'omits javascript: href from links',
      markdown: '[click](javascript:alert(1))',
      expected: 'click'
    },
    {
      description: 'omits data: href from links',
      markdown: '[data](data:text/html,hi)',
      expected: 'data'
    },
    {
      description: 'omits relative hrefs like /tags/x and /@user',
      markdown: '[tag](/tags/x) and [user](/@user)',
      expected: 'tag and user'
    },
    {
      description: 'omits non-http relative img src and keeps alt text',
      markdown: '![cat](/uploads/cat.png)',
      expected: 'cat'
    },
    {
      description: 'omits data: img src and keeps alt text',
      markdown: '![logo](data:image/png;base64,abc)',
      expected: 'logo'
    },
    {
      description: 'omits relative img without alt text',
      markdown: '![](/uploads/cat.png)',
      expected: ''
    }
  ])('$description (via convertMarkdownText)', ({ markdown, expected }) => {
    expect(pollHtmlToBlueskyPlainText(renderPollHtml(markdown))).toBe(expected)
  })

  it.each([
    {
      description: 'does not add blank lines for nested unordered lists',
      markdown: '- parent\n  - child 1\n  - child 2\n- sibling',
      expected: 'parent\nchild 1\nchild 2\nsibling'
    },
    {
      description: 'does not add blank lines for nested ordered lists',
      markdown: '1. parent\n   1. child 1\n   2. child 2\n2. sibling',
      expected: 'parent\nchild 1\nchild 2\nsibling'
    },
    {
      description:
        'keeps blank lines around outer lists while keeping nested lists tight',
      markdown: 'Intro\n\n- parent\n  - child 1\n- sibling\n\nOutro',
      expected: 'Intro\n\nparent\nchild 1\nsibling\n\nOutro'
    }
  ])('$description (via convertMarkdownText)', ({ markdown, expected }) => {
    const text = pollHtmlToBlueskyPlainText(renderPollHtml(markdown))
    expect(text).toBe(expected)
    expect(text).toBe(markdownToBlueskyPlainText(markdown))
  })

  it.each([
    {
      description: 'preserves trailing whitespace inside anchor text',
      markdown: '[link ](https://example.com)next',
      expected: 'link https://example.com next'
    },
    {
      description: 'preserves leading whitespace inside anchor text',
      markdown: 'before[ link](https://example.com)',
      expected: 'before link https://example.com'
    },
    {
      description:
        'preserves leading and trailing whitespace inside anchor text',
      markdown: 'before[ link ](https://example.com)next',
      expected: 'before link https://example.com next'
    },
    {
      description: 'collapses double spaces around anchor edge whitespace',
      markdown: 'before [ link ](https://example.com) next',
      expected: 'before link https://example.com next'
    },
    {
      description: 'drops anchor trailing whitespace before a full stop',
      markdown: '[link ](https://example.com).',
      expected: 'link https://example.com.'
    },
    {
      description: 'drops anchor trailing whitespace before a closing bracket',
      markdown: '([link ](https://example.com))',
      expected: '(link https://example.com)'
    }
  ])('$description (via convertMarkdownText)', ({ markdown, expected }) => {
    expect(pollHtmlToBlueskyPlainText(renderPollHtml(markdown))).toBe(expected)
  })

  it('keeps each item of a deeply nested list on its own line', () => {
    const markdown = [
      '- l1',
      '  - l2',
      '    - l3',
      '      - l4',
      '        - l5',
      '          - l6',
      '            - l7',
      '              - l8'
    ].join('\n')

    expect(pollHtmlToBlueskyPlainText(renderPollHtml(markdown))).toBe(
      'l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8'
    )
  })

  it('keeps a line break in deeply nested markup', () => {
    const html = renderPollHtml(`${'<b>'.repeat(15000)}a<br>b`)

    expect(pollHtmlToBlueskyPlainText(html)).toBe('a\nb')
  })

  it('handles deeply nested tags without overflowing the stack', () => {
    const html = renderPollHtml(`${'<b>'.repeat(15000)}x`)

    expect(pollHtmlToBlueskyPlainText(html)).toBe('x')
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
