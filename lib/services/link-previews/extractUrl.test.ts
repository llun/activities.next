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

    // The "a card is only for a link the reader can see" rule applied only to
    // remote HTML, so a local author could get a full-width card from a link
    // whose text renders as nothing. Same rule, both paths.
    it('ignores a markdown link with no visible text', () => {
      expect(
        fromMarkdown('Look at this [](https://evil.example/phish)')
      ).toBeNull()
    })

    it('ignores a markdown link whose text is zero-width', () => {
      expect(
        fromMarkdown('Look [\u200b](https://evil.example/phish)')
      ).toBeNull()
    })

    // The check reads the markdown SOURCE, but that source can itself be HTML
    // that renders to nothing — so these produce exactly the empty anchor the
    // rule exists to catch, and the HTML path already catches their equivalent.
    it.each([
      { description: 'an html comment', text: '<!-- hi -->' },
      { description: 'an empty span', text: '<span></span>' },
      { description: 'a hidden span', text: '<span class="hidden">x</span>' },
      {
        description: 'an invisible span',
        text: '<span class="invisible">x</span>'
      }
    ])('ignores a markdown link whose text is $description', ({ text }) => {
      expect(
        fromMarkdown(`Look ${'['}${text}](https://evil.example/phish)`)
      ).toBeNull()
    })

    // The hidden-ancestor rule was only ever applied to the remote path.
    // marked flattens raw inline HTML into flat sibling tokens, so a per-link
    // text check cannot see that the link sits inside a hidden span — and the
    // hidden one comes FIRST, so it beat the genuinely visible link below it.
    it('ignores a markdown link wrapped in a hidden span', () => {
      expect(
        fromMarkdown(
          'Look <span class="hidden">[phish](https://evil.example/phish)</span>' +
            ' and [real](https://good.example/real)'
        )
      ).toBe('https://good.example/real')
    })

    it('ignores a markdown link wrapped in an invisible span', () => {
      expect(
        fromMarkdown(
          'Look <span class="invisible">[phish](https://evil.example/phish)</span>' +
            ' and [real](https://good.example/real)'
        )
      ).toBe('https://good.example/real')
    })

    it('ignores a markdown link inside a script element', () => {
      expect(
        fromMarkdown(
          'Look <script>[phish](https://evil.example/phish)</script>'
        )
      ).toBeNull()
    })

    // An entity is exactly the case where source text differs from rendered
    // text without containing a '<', so a fast path keyed on '<' skipped the
    // measurement entirely.
    it.each([
      { description: 'a zero-width space entity', text: '&#8203;' },
      { description: 'a hex zero-width entity', text: '&#x200b;' },
      { description: 'a soft hyphen entity', text: '&shy;' },
      { description: 'a non-breaking space entity', text: '&nbsp;' }
    ])('ignores a markdown link whose text is $description', ({ text }) => {
      expect(
        fromMarkdown(`Look [${text}](https://evil.example/phish)`)
      ).toBeNull()
    })

    it.each([
      { description: 'an ampersand entity', text: 'Search &amp; Rescue' },
      { description: 'a bare ampersand', text: 'AT&T' },
      { description: 'an escaped angle bracket', text: '&lt;tag&gt;' }
    ])('keeps a markdown link whose text is $description', ({ text }) => {
      expect(fromMarkdown(`Look [${text}](https://example.com/ok)`)).toBe(
        'https://example.com/ok'
      )
    })

    it('keeps a markdown link whose text is emphasised', () => {
      expect(fromMarkdown('Look [**bold**](https://example.com/b)')).toBe(
        'https://example.com/b'
      )
    })

    it('keeps a markdown link that has visible text', () => {
      expect(fromMarkdown('Look at [the article](https://example.com/a)')).toBe(
        'https://example.com/a'
      )
    })

    // A URL in backticks is not a link the reader can click, and the renderer
    // does not make one — extraction follows the renderer, so it agrees.
    it('ignores a url inside a code span', () => {
      expect(fromMarkdown('Run `https://example.com/in-code` now')).toBeNull()
    })

    it('ignores a url inside a fenced code block', () => {
      expect(fromMarkdown('```\nhttps://example.com/in-fence\n```')).toBeNull()
    })

    it('takes the real link over one that is only shown as code', () => {
      expect(
        fromMarkdown(
          'Run `https://code.example/x` then see https://real.example/y'
        )
      ).toBe('https://real.example/y')
    })

    // The renderer HTML-encodes `&` in an href and the parser decodes it back.
    // Getting that round trip wrong would silently corrupt every query string.
    it('preserves a query string through the render and parse round trip', () => {
      expect(fromMarkdown('See https://example.com/a?b=c&d=e here')).toBe(
        'https://example.com/a?b=c&d=e'
      )
    })

    it('excludes trailing sentence punctuation from a bare url', () => {
      expect(fromMarkdown('See https://example.com/a. Next.')).toBe(
        'https://example.com/a'
      )
    })

    it('finds a url inside a blockquote', () => {
      expect(fromMarkdown('> quoting https://example.com/deep')).toBe(
        'https://example.com/deep'
      )
    })

    // Regression: walking a table's `header` with the generic token walker
    // recursed into TableCell objects, whose own `header` is a BOOLEAN — the
    // walker then tried to iterate `true`, threw, and the catch turned the
    // whole status into "no links". A table anywhere in the post killed the
    // card, including for links nowhere near it.
    it('finds a url in a table cell', () => {
      expect(
        fromMarkdown(
          '| a | b |\n| --- | --- |\n| [cell](https://cell.example/one) | plain |'
        )
      ).toBe('https://cell.example/one')
    })

    it('finds a url in a table header cell', () => {
      expect(
        fromMarkdown(
          '| [head](https://head.example/one) | b |\n| --- | --- |\n| x | y |'
        )
      ).toBe('https://head.example/one')
    })

    it('still finds a url in a post that also contains a table', () => {
      expect(
        fromMarkdown(
          'See https://outside.example/page\n\n| a | b |\n| --- | --- |\n| x | y |'
        )
      ).toBe('https://outside.example/page')
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

    // Remote status text is stored RAW and only sanitized at render, so an
    // extractor that walks the stored HTML sees markup the reader never will.
    // A card is a full-width clickable block with an attacker-controlled title,
    // description and thumbnail — so picking a link that is invisible in the
    // rendered post is a ready-made phishing surface.
    describe('links the reader cannot see', () => {
      it('ignores an anchor with no visible text', () => {
        expect(
          fromHtml(
            '<p>Great read, thoughts?</p><a href="https://evil.example/phish"></a>'
          )
        ).toBeNull()
      })

      it('ignores an anchor whose only content is whitespace', () => {
        expect(
          fromHtml('<p>hi</p><a href="https://evil.example/phish">   </a>')
        ).toBeNull()
      })

      it('ignores an anchor the app renders as hidden', () => {
        expect(
          fromHtml(
            '<p><a href="https://evil.example/phish" class="hidden">x</a></p>'
          )
        ).toBeNull()
      })

      it('ignores an anchor marked invisible', () => {
        expect(
          fromHtml(
            '<p><a href="https://evil.example/phish" class="invisible">x</a></p>'
          )
        ).toBeNull()
      })

      // <template> is NOT a hiding place once the text is sanitized: the tag is
      // dropped and its anchor is unwrapped into the rendered post as an
      // ordinary visible link. Extracting it is therefore correct — the reader
      // sees that link, and the card names its real domain. Pinned so nobody
      // "fixes" this into skipping a link that is genuinely on screen.
      it('takes an unwrapped template anchor, which the reader does see', () => {
        expect(
          fromHtml(
            '<template><a href="https://evil.example/phish">x</a></template>' +
              '<p>see <a href="https://real.example/">real.example</a></p>'
          )
        ).toBe('https://evil.example/phish')
      })

      it('ignores an anchor inside a script element', () => {
        expect(
          fromHtml(
            '<script><a href="https://evil.example/phish">x</a></script>' +
              '<p>see <a href="https://real.example/">real.example</a></p>'
          )
        ).toBe('https://real.example/')
      })

      // The dangerous shape: the anchor HAS descendant text, but every one of
      // those descendants is hidden, so `cleanClassName` renders the whole
      // anchor as nothing. Counting all descendant text cannot tell this apart
      // from Mastodon's split below — the visible text has to be computed with
      // hidden descendants removed.
      it('ignores an anchor whose every child is invisible', () => {
        expect(
          fromHtml(
            '<p>Nothing to see here <a href="https://evil.example/phish">' +
              '<span class="invisible">https://evil.example/phish</span>' +
              '</a></p>'
          )
        ).toBeNull()
      })

      it('ignores an anchor split across two invisible spans', () => {
        expect(
          fromHtml(
            '<p>text <a href="https://evil.example/phish">' +
              '<span class="invisible">https://evil.example</span>' +
              '<span class="invisible">/phish</span></a></p>'
          )
        ).toBeNull()
      })

      // getVisibleText starts AT the anchor, so it never saw a hidden
      // ANCESTOR. Worse than a false negative: the hidden anchor comes first in
      // document order, so it won over the genuinely visible link below it and
      // the reader got the attacker's card while seeing only the real link.
      it('ignores an anchor inside a hidden ancestor', () => {
        expect(
          fromHtml(
            '<p>Nothing to see here <span class="invisible">' +
              '<a href="https://evil.example/phish">click here</a>' +
              '</span></p>'
          )
        ).toBeNull()
      })

      it('prefers the visible link over one hidden by an ancestor', () => {
        expect(
          fromHtml(
            '<p><span class="hidden"><a href="https://evil.example/phish">x</a></span>' +
              ' real: <a href="https://good.example/post">good.example/post</a></p>'
          )
        ).toBe('https://good.example/post')
      })

      // trim() does not remove U+200B and friends — they are format characters,
      // not ECMAScript whitespace — so a zero-width-only anchor passed the
      // "has visible text" check while rendering as nothing.
      it('ignores an anchor whose only text is zero-width', () => {
        expect(
          fromHtml('<p><a href="https://evil.example/phish">\u200b</a></p>')
        ).toBeNull()
      })

      it('ignores an anchor whose only text is a word joiner', () => {
        expect(
          fromHtml('<p><a href="https://evil.example/phish">\u2060</a></p>')
        ).toBeNull()
      })

      // A hand-written list of the obvious few left these one character away
      // from the same phishing surface; the check uses Unicode's own
      // default-ignorable property so the whole class is covered at once.
      it.each([
        { description: 'a soft hyphen', text: '\u00AD' },
        { description: 'a Hangul filler', text: '\u3164' },
        { description: 'a Hangul choseong filler', text: '\u115F' },
        { description: 'a halfwidth Hangul filler', text: '\uFFA0' }
      ])('ignores an anchor whose only text is $description', ({ text }) => {
        expect(
          fromHtml(`<p><a href="https://evil.example/phish">${text}</a></p>`)
        ).toBeNull()
      })

      // The emptiness test strips zero-width characters, which includes ZWJ
      // (U+200D) — the joiner inside emoji sequences and Persian/Indic
      // spelling. Stripping it must not make a legitimate anchor look empty:
      // only the joiners go, never the characters they join.
      it.each([
        {
          description: 'keeps an emoji-only anchor',
          text: '\uD83D\uDC4D'
        },
        {
          description: 'keeps a ZWJ emoji sequence anchor',
          text: '\uD83D\uDC68\u200D\uD83D\uDC69\u200D\uD83D\uDC67'
        },
        {
          description: 'keeps a Persian anchor written with ZWNJ',
          text: '\u0645\u06CC\u200C\u062E\u0648\u0627\u0647\u0645'
        },
        {
          description: 'keeps a Thai anchor',
          text: '\u0e2a\u0e27\u0e31\u0e2a\u0e14\u0e35'
        },
        { description: 'keeps a CJK anchor', text: '\u4e2d\u6587' }
      ])('$description', ({ text }) => {
        expect(
          fromHtml(`<p><a href="https://example.com/ok">${text}</a></p>`)
        ).toBe('https://example.com/ok')
      })

      it('ignores an anchor whose children are all hidden', () => {
        expect(
          fromHtml(
            '<p>text <a href="https://evil.example/phish">' +
              '<span class="hidden">click</span></a></p>'
          )
        ).toBeNull()
      })

      // Mastodon splits a link's display text into invisible/ellipsis spans on
      // the anchor's CHILDREN. The anchor itself is visible and must still win.
      it('keeps a Mastodon-style truncated link whose spans are invisible', () => {
        expect(
          fromHtml(
            '<p><a href="https://example.com/very/long/path">' +
              '<span class="invisible">https://</span>' +
              '<span class="ellipsis">example.com/very</span>' +
              '<span class="invisible">/long/path</span></a></p>'
          )
        ).toBe('https://example.com/very/long/path')
      })
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
