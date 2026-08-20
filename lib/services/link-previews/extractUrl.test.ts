import {
  extractPreviewUrl,
  normalizePreviewUrl
} from '@/lib/services/link-previews/extractUrl'

describe('normalizePreviewUrl', () => {
  it.each([
    {
      description: 'drops the fragment',
      input: 'https://example.com/post#section',
      expected: 'https://example.com/post'
    },
    {
      description: 'keeps the query string',
      input: 'https://example.com/post?id=7',
      expected: 'https://example.com/post?id=7'
    },
    {
      description: 'lowercases the host but not the path',
      input: 'https://Example.COM/Path',
      expected: 'https://example.com/Path'
    },
    {
      description: 'drops a default https port',
      input: 'https://example.com:443/a',
      expected: 'https://example.com/a'
    },
    {
      description: 'keeps a non-default port',
      input: 'https://example.com:8443/a',
      expected: 'https://example.com:8443/a'
    }
  ])('$description', ({ input, expected }) => {
    expect(normalizePreviewUrl(input)).toBe(expected)
  })

  it.each([
    { description: 'rejects a javascript url', input: 'javascript:alert(1)' },
    { description: 'rejects a data url', input: 'data:text/html,<b>x</b>' },
    { description: 'rejects a mailto url', input: 'mailto:a@example.com' },
    { description: 'rejects a non-url string', input: 'not a url' },
    { description: 'rejects an empty string', input: '' }
  ])('$description', ({ input }) => {
    expect(normalizePreviewUrl(input)).toBeNull()
  })

  it('rejects a url longer than the storage cap', () => {
    expect(
      normalizePreviewUrl(`https://example.com/${'a'.repeat(3000)}`)
    ).toBeNull()
  })
})

describe('extractPreviewUrl', () => {
  const host = 'test.llun.dev'

  describe('local statuses (markdown)', () => {
    const fromMarkdown = (text: string, excludeUrls: string[] = []) =>
      extractPreviewUrl({ text, isLocalActor: true, host, excludeUrls })

    it('finds a bare url', () => {
      expect(fromMarkdown('Look at https://example.com/article today')).toBe(
        'https://example.com/article'
      )
    })

    it('finds the url inside a markdown link', () => {
      expect(fromMarkdown('Read [the article](https://example.com/a)')).toBe(
        'https://example.com/a'
      )
    })

    it('returns the first url when several are present', () => {
      expect(
        fromMarkdown(
          'https://first.example.com/ and https://second.example.com/'
        )
      ).toBe('https://first.example.com/')
    })

    it('returns null for a status with no link', () => {
      expect(fromMarkdown('Just some words')).toBeNull()
    })

    it('ignores a mention', () => {
      expect(fromMarkdown('Hello @someone@remote.example.com')).toBeNull()
    })

    it('ignores a hashtag', () => {
      expect(fromMarkdown('Riding today #cycling')).toBeNull()
    })

    it('picks the link that follows a mention and a hashtag', () => {
      expect(
        fromMarkdown('@someone@a.example.com #tag https://example.com/x')
      ).toBe('https://example.com/x')
    })

    it('skips an excluded url and takes the next one', () => {
      expect(
        fromMarkdown(
          'https://example.com/quoted and https://example.com/other',
          ['https://example.com/quoted']
        )
      ).toBe('https://example.com/other')
    })

    it('returns null when the only url is excluded', () => {
      expect(
        fromMarkdown('https://example.com/quoted', [
          'https://example.com/quoted'
        ])
      ).toBeNull()
    })

    it('normalizes the returned url', () => {
      expect(fromMarkdown('https://Example.com/Path#frag')).toBe(
        'https://example.com/Path'
      )
    })

    it('finds a url inside a blockquote', () => {
      expect(fromMarkdown('> quoting https://example.com/deep')).toBe(
        'https://example.com/deep'
      )
    })

    it('finds a url inside a list item', () => {
      expect(fromMarkdown('- one\n- https://example.com/list')).toBe(
        'https://example.com/list'
      )
    })
  })

  describe('remote statuses (html)', () => {
    const fromHtml = (text: string, excludeUrls: string[] = []) =>
      extractPreviewUrl({ text, isLocalActor: false, host, excludeUrls })

    it('finds the href of a plain anchor', () => {
      expect(
        fromHtml('<p>Look at <a href="https://example.com/a">example</a></p>')
      ).toBe('https://example.com/a')
    })

    it('ignores a Mastodon mention anchor', () => {
      expect(
        fromHtml(
          '<p><span class="h-card"><a href="https://remote.example.com/@bob" class="u-url mention">@bob</a></span></p>'
        )
      ).toBeNull()
    })

    it('ignores a hashtag anchor marked with rel=tag', () => {
      expect(
        fromHtml(
          '<p><a href="https://remote.example.com/tags/x" rel="tag">#x</a></p>'
        )
      ).toBeNull()
    })

    it('ignores a hashtag anchor marked by class', () => {
      expect(
        fromHtml(
          '<p><a href="https://remote.example.com/tags/x" class="mention hashtag">#x</a></p>'
        )
      ).toBeNull()
    })

    it('picks the real link that follows a mention', () => {
      expect(
        fromHtml(
          '<p><a href="https://remote.example.com/@bob" class="u-url mention">@bob</a> see <a href="https://example.com/real">this</a></p>'
        )
      ).toBe('https://example.com/real')
    })

    it('ignores a relative href', () => {
      expect(fromHtml('<p><a href="/local/path">here</a></p>')).toBeNull()
    })

    it('ignores a javascript href', () => {
      expect(
        fromHtml('<p><a href="javascript:alert(1)">click</a></p>')
      ).toBeNull()
    })

    it('returns null for html with no anchors', () => {
      expect(fromHtml('<p>Just text</p>')).toBeNull()
    })

    it('skips an excluded url', () => {
      expect(
        fromHtml(
          '<p><a href="https://example.com/quoted">q</a> <a href="https://example.com/other">o</a></p>',
          ['https://example.com/quoted']
        )
      ).toBe('https://example.com/other')
    })

    it('matches an excluded url regardless of fragment or case', () => {
      expect(
        fromHtml('<p><a href="https://Example.com/quoted#top">q</a></p>', [
          'https://example.com/quoted'
        ])
      ).toBeNull()
    })
  })

  it('returns null for empty text', () => {
    expect(
      extractPreviewUrl({ text: '', isLocalActor: true, host, excludeUrls: [] })
    ).toBeNull()
  })
})
