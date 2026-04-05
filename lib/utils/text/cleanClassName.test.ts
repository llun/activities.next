import { renderToStaticMarkup } from 'react-dom/server'

import { cleanClassName, extractTagFromHref } from './cleanClassName'

describe('extractTagFromHref', () => {
  it('extracts tag from absolute remote URL', () => {
    expect(extractTagFromHref('https://mastodon.social/tags/hello')).toBe(
      'hello'
    )
  })

  it('extracts tag from local relative path', () => {
    expect(extractTagFromHref('/tags/hello')).toBe('hello')
  })

  it('lowercases the tag name', () => {
    expect(extractTagFromHref('https://example.com/tags/CamelCase')).toBe(
      'camelcase'
    )
  })

  it('handles URL-encoded tag names within the supported character set', () => {
    expect(extractTagFromHref('/tags/hello%5Fworld')).toBe('hello_world')
  })

  it('returns undefined for non-ASCII tags unsupported by local routes', () => {
    expect(extractTagFromHref('/tags/caf%C3%A9')).toBeUndefined()
  })

  it('returns undefined for non-tag URLs', () => {
    expect(extractTagFromHref('https://example.com/about')).toBeUndefined()
  })

  it('returns undefined for undefined', () => {
    expect(extractTagFromHref(undefined)).toBeUndefined()
  })

  it('returns undefined for empty string', () => {
    expect(extractTagFromHref('')).toBeUndefined()
  })

  it('handles URL with query params', () => {
    expect(extractTagFromHref('/tags/hello?page=1')).toBe('hello')
  })

  it('handles URL with fragment', () => {
    expect(extractTagFromHref('/tags/hello#section')).toBe('hello')
  })

  it('returns undefined for purely numeric tags', () => {
    expect(extractTagFromHref('/tags/12345')).toBeUndefined()
  })
})

describe('cleanClassName', () => {
  const renderToHtml = (input: string) => {
    const result = cleanClassName(input)
    if (typeof result === 'string') return result
    if (Array.isArray(result)) {
      return result.map((el) => renderToStaticMarkup(el)).join('')
    }
    return renderToStaticMarkup(result)
  }

  describe('hashtag links', () => {
    it('rewrites remote hashtag links to local paths', () => {
      const html =
        '<a href="https://mastodon.social/tags/hello" class="mention hashtag" rel="tag">#<span>hello</span></a>'
      const output = renderToHtml(html)
      expect(output).toContain('href="/tags/hello"')
      expect(output).not.toContain('target="_blank"')
      expect(output).not.toContain('mastodon.social')
    })

    it('keeps local hashtag links pointing to /tags/', () => {
      const html =
        '<a href="/tags/world" class="hashtag" rel="tag">#<span>world</span></a>'
      const output = renderToHtml(html)
      expect(output).toContain('href="/tags/world"')
      expect(output).not.toContain('target="_blank"')
    })

    it('lowercases tag name in rewritten URL', () => {
      const html =
        '<a href="https://remote.server/tags/CamelCase" class="hashtag" rel="tag">#<span>CamelCase</span></a>'
      const output = renderToHtml(html)
      expect(output).toContain('href="/tags/camelcase"')
    })

    it('handles class="mention hashtag" from Mastodon', () => {
      const html =
        '<a href="https://mastodon.example/tags/test" class="mention hashtag" rel="tag">#<span>test</span></a>'
      const output = renderToHtml(html)
      expect(output).toContain('href="/tags/test"')
      expect(output).not.toContain('target="_blank"')
    })

    it('preserves remote href with target="_blank" for unsupported non-ASCII tags', () => {
      const html =
        '<a href="https://mastodon.social/tags/caf%C3%A9" class="hashtag" rel="tag">#<span>café</span></a>'
      const output = renderToHtml(html)
      expect(output).toContain('href="https://mastodon.social/tags/caf%C3%A9"')
      expect(output).toContain('target="_blank"')
      expect(output).toContain('noopener')
    })

    it('does not match class substrings like "not-hashtag"', () => {
      const html =
        '<a href="https://example.com/tags/test" class="not-hashtag" rel="tag">test</a>'
      const output = renderToHtml(html)
      expect(output).toContain('target="_blank"')
      expect(output).toContain('href="https://example.com/tags/test"')
    })
  })

  describe('non-hashtag links', () => {
    it('adds target="_blank" to regular links', () => {
      const html = '<a href="https://example.com">Example</a>'
      const output = renderToHtml(html)
      expect(output).toContain('target="_blank"')
      expect(output).toContain('href="https://example.com"')
    })

    it('adds noopener noreferrer to regular links', () => {
      const html = '<a href="https://example.com">Example</a>'
      const output = renderToHtml(html)
      expect(output).toContain('noopener')
      expect(output).toContain('noreferrer')
    })

    it('preserves existing rel tokens while adding noopener noreferrer', () => {
      const html = '<a href="https://example.com" rel="nofollow">Example</a>'
      const output = renderToHtml(html)
      expect(output).toContain('nofollow')
      expect(output).toContain('noopener')
      expect(output).toContain('noreferrer')
    })

    it('does not duplicate noopener if already present', () => {
      const html = '<a href="https://example.com" rel="noopener">Example</a>'
      const output = renderToHtml(html)
      const relMatch = output.match(/rel="([^"]*)"/)
      const relTokens = relMatch?.[1].split(/\s+/) ?? []
      expect(relTokens.filter((t) => t === 'noopener')).toHaveLength(1)
    })

    it('adds target="_blank" to mention links without hashtag class', () => {
      const html =
        '<a href="https://example.com/@user" class="u-url mention">@user</a>'
      const output = renderToHtml(html)
      expect(output).toContain('target="_blank"')
    })
  })

  describe('span transformations', () => {
    it('replaces invisible class with hidden', () => {
      const html = '<span class="invisible">hidden text</span>'
      const output = renderToHtml(html)
      expect(output).toContain('class="hidden"')
      expect(output).not.toContain('class="invisible"')
    })

    it('replaces ellipsis class', () => {
      const html = '<span class="ellipsis">text</span>'
      const output = renderToHtml(html)
      expect(output).toContain('after:content-')
    })
  })

  describe('emoji images', () => {
    it('replaces emoji class with size-5 inline', () => {
      const html = '<img class="emoji" src="https://example.com/emoji.png">'
      const output = renderToHtml(html)
      expect(output).toContain('class="size-5 inline"')
    })
  })
})
