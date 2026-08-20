import {
  getDeclaredCharset,
  parseOpenGraphMetadata
} from '@/lib/services/link-previews/parseOpenGraph'

const BASE_URL = 'https://example.com/article'

const page = (head: string) =>
  `<!doctype html><html><head>${head}</head><body><p>body</p></body></html>`

describe('parseOpenGraphMetadata', () => {
  it('reads a complete OpenGraph set', () => {
    const result = parseOpenGraphMetadata(
      page(`
        <meta property="og:title" content="The best bike computers">
        <meta property="og:description" content="We tested twelve head units.">
        <meta property="og:site_name" content="The Verge">
        <meta property="og:image" content="https://cdn.example.com/hero.jpg">
        <meta property="og:image:width" content="1200">
        <meta property="og:image:height" content="630">
        <meta property="og:type" content="article">
        <meta property="article:published_time" content="2026-03-04T10:00:00Z">
      `),
      BASE_URL
    )

    expect(result).toMatchObject({
      title: 'The best bike computers',
      description: 'We tested twelve head units.',
      siteName: 'The Verge',
      imageUrl: 'https://cdn.example.com/hero.jpg',
      imageWidth: 1200,
      imageHeight: 630,
      type: 'link'
    })
    expect(result?.publishedAt).toBe(Date.parse('2026-03-04T10:00:00Z'))
  })

  it('falls back to twitter card tags when OpenGraph is absent', () => {
    const result = parseOpenGraphMetadata(
      page(`
        <meta name="twitter:title" content="Twitter title">
        <meta name="twitter:description" content="Twitter description">
        <meta name="twitter:image" content="https://cdn.example.com/t.jpg">
      `),
      BASE_URL
    )

    expect(result).toMatchObject({
      title: 'Twitter title',
      description: 'Twitter description',
      imageUrl: 'https://cdn.example.com/t.jpg'
    })
  })

  it('falls back to the document title and meta description', () => {
    const result = parseOpenGraphMetadata(
      `<html><head><title>Plain title</title>
       <meta name="description" content="Plain description"></head><body></body></html>`,
      BASE_URL
    )

    expect(result).toMatchObject({
      title: 'Plain title',
      description: 'Plain description'
    })
  })

  it('prefers OpenGraph over twitter and the document title', () => {
    const result = parseOpenGraphMetadata(
      `<html><head><title>Doc title</title>
        <meta name="twitter:title" content="Twitter title">
        <meta property="og:title" content="OG title">
       </head><body></body></html>`,
      BASE_URL
    )

    expect(result?.title).toBe('OG title')
  })

  it('returns null when the page has no usable title', () => {
    expect(
      parseOpenGraphMetadata(
        page('<meta name="keywords" content="x">'),
        BASE_URL
      )
    ).toBeNull()
  })

  it('returns null for html that is not a document', () => {
    expect(parseOpenGraphMetadata('', BASE_URL)).toBeNull()
  })

  it('decodes html entities in metadata', () => {
    const result = parseOpenGraphMetadata(
      page(
        '<meta property="og:title" content="Bikes &amp; Boots &lt;2026&gt;">'
      ),
      BASE_URL
    )
    expect(result?.title).toBe('Bikes & Boots <2026>')
  })

  it('collapses whitespace and newlines in metadata', () => {
    const result = parseOpenGraphMetadata(
      page('<meta property="og:title" content="A  title\n   over lines">'),
      BASE_URL
    )
    expect(result?.title).toBe('A title over lines')
  })

  it('strips bidi override characters from metadata', () => {
    const result = parseOpenGraphMetadata(
      page('<meta property="og:title" content="Safe‮title">'),
      BASE_URL
    )
    expect(result?.title).toBe('Safetitle')
  })

  it('truncates an overlong title and description', () => {
    const result = parseOpenGraphMetadata(
      page(
        `<meta property="og:title" content="${'t'.repeat(900)}">
         <meta property="og:description" content="${'d'.repeat(2000)}">`
      ),
      BASE_URL
    )
    expect(result?.title?.length).toBeLessThanOrEqual(500)
    expect(result?.description?.length).toBeLessThanOrEqual(1000)
  })

  it('resolves a relative image against the page url', () => {
    const result = parseOpenGraphMetadata(
      page(
        '<meta property="og:title" content="T"><meta property="og:image" content="/img/hero.png">'
      ),
      'https://example.com/section/article'
    )
    expect(result?.imageUrl).toBe('https://example.com/img/hero.png')
  })

  it('drops a non-https image', () => {
    const result = parseOpenGraphMetadata(
      page(
        '<meta property="og:title" content="T"><meta property="og:image" content="http://insecure.example.com/x.png">'
      ),
      BASE_URL
    )
    expect(result?.imageUrl).toBeNull()
  })

  it('drops a javascript image url', () => {
    const result = parseOpenGraphMetadata(
      page(
        '<meta property="og:title" content="T"><meta property="og:image" content="javascript:alert(1)">'
      ),
      BASE_URL
    )
    expect(result?.imageUrl).toBeNull()
  })

  it('ignores non-numeric image dimensions', () => {
    const result = parseOpenGraphMetadata(
      page(
        `<meta property="og:title" content="T">
         <meta property="og:image" content="https://cdn.example.com/a.png">
         <meta property="og:image:width" content="wide">`
      ),
      BASE_URL
    )
    expect(result?.imageWidth).toBeNull()
  })

  it('ignores dimensions when there is no image', () => {
    const result = parseOpenGraphMetadata(
      page(
        '<meta property="og:title" content="T"><meta property="og:image:width" content="1200">'
      ),
      BASE_URL
    )
    expect(result?.imageWidth).toBeNull()
  })

  it.each([
    {
      description: 'maps article to link',
      ogType: 'article',
      expected: 'link'
    },
    {
      description: 'maps website to link',
      ogType: 'website',
      expected: 'link'
    },
    {
      description: 'maps video.other to video',
      ogType: 'video.other',
      expected: 'video'
    },
    {
      description: 'maps an unknown type to link',
      ogType: 'book',
      expected: 'link'
    }
  ])('$description', ({ ogType, expected }) => {
    const result = parseOpenGraphMetadata(
      page(
        `<meta property="og:title" content="T"><meta property="og:type" content="${ogType}">`
      ),
      BASE_URL
    )
    expect(result?.type).toBe(expected)
  })

  it('defaults the type to link when og:type is absent', () => {
    const result = parseOpenGraphMetadata(
      page('<meta property="og:title" content="T">'),
      BASE_URL
    )
    expect(result?.type).toBe('link')
  })

  it('reads an author name and url', () => {
    const result = parseOpenGraphMetadata(
      page(
        `<meta property="og:title" content="T">
         <meta name="author" content="Ada Lovelace">
         <meta property="article:author" content="https://example.com/ada">`
      ),
      BASE_URL
    )
    expect(result).toMatchObject({
      authorName: 'Ada Lovelace',
      authorUrl: 'https://example.com/ada'
    })
  })

  it('treats a non-url article:author as the author name', () => {
    const result = parseOpenGraphMetadata(
      page(
        '<meta property="og:title" content="T"><meta property="article:author" content="Ada Lovelace">'
      ),
      BASE_URL
    )
    expect(result).toMatchObject({
      authorName: 'Ada Lovelace',
      authorUrl: null
    })
  })

  it('ignores an unparsable published date', () => {
    const result = parseOpenGraphMetadata(
      page(
        '<meta property="og:title" content="T"><meta property="article:published_time" content="sometime">'
      ),
      BASE_URL
    )
    expect(result?.publishedAt).toBeNull()
  })

  it('reads og tags declared with the name attribute', () => {
    const result = parseOpenGraphMetadata(
      page('<meta name="og:title" content="Named OG">'),
      BASE_URL
    )
    expect(result?.title).toBe('Named OG')
  })

  it('ignores a meta tag with no content', () => {
    const result = parseOpenGraphMetadata(
      `<html><head><title>Doc</title><meta property="og:title"></head><body></body></html>`,
      BASE_URL
    )
    expect(result?.title).toBe('Doc')
  })

  it('ignores a whitespace-only title', () => {
    expect(
      parseOpenGraphMetadata(
        page('<meta property="og:title" content="   ">'),
        BASE_URL
      )
    ).toBeNull()
  })
  // htmlToDOM is quadratic in nesting depth, so the fetch's byte cap bounds
  // transfer but not CPU: a 1 MiB page of nested divs was measured blocking the
  // event loop for ~9 SECONDS of synchronous, non-cancellable work — which on
  // the default in-process queue happens inside the request that created the
  // status. Parsing only <head> removes the entire class of hostile <body>
  // payloads; the same page now parses in single-digit milliseconds.
  it('is not slowed down by a deeply nested body', () => {
    const depth = 95_000
    const html =
      '<html><head><meta property="og:title" content="Deep"></head><body>' +
      '<div>'.repeat(depth) +
      '</div>'.repeat(depth) +
      '</body></html>'

    const start = Date.now()
    const result = parseOpenGraphMetadata(html, BASE_URL)
    const elapsed = Date.now() - start

    expect(result?.title).toBe('Deep')
    // Generous against CI jitter and still three orders of magnitude under the
    // unbounded parse.
    expect(elapsed).toBeLessThan(1_000)
  })

  it('reads metadata from a page with no head element', () => {
    const result = parseOpenGraphMetadata(
      '<html><meta property="og:title" content="Headless"></html>',
      BASE_URL
    )
    expect(result?.title).toBe('Headless')
  })

  describe('getDeclaredCharset', () => {
    it.each([
      {
        description: 'reads an html5 meta charset',
        html: '<html><head><meta charset="windows-1251"></head></html>',
        expected: 'windows-1251'
      },
      {
        description: 'reads a charset from a legacy http-equiv',
        html: '<html><head><meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1"></head></html>',
        expected: 'iso-8859-1'
      },
      {
        description: 'lowercases the charset',
        html: '<html><head><meta charset="UTF-8"></head></html>',
        expected: 'utf-8'
      },
      {
        description: 'answers null when none is declared',
        html: '<html><head><title>x</title></head></html>',
        expected: null
      }
    ])('$description', ({ html, expected }) => {
      expect(getDeclaredCharset(html)).toBe(expected)
    })
  })
})
