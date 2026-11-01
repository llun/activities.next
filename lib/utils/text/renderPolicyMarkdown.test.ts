import { renderPolicyMarkdown, renderPolicyPage } from './renderPolicyMarkdown'

const render = (markdown: string) =>
  renderPolicyMarkdown(markdown, { domain: 'llun.test' })

describe('renderPolicyMarkdown', () => {
  it('renders Markdown blocks and inline formatting', () => {
    expect(
      render('## Data\n\n- **Posts** are *public*\n- ~~Ads~~\n\n> `code`')
    ).toBe(
      [
        '<h2>Data</h2>',
        '<ul>',
        '<li><strong>Posts</strong> are <em>public</em></li>',
        '<li><del>Ads</del></li>',
        '</ul>',
        '<blockquote>',
        '<p><code>code</code></p>',
        '</blockquote>'
      ].join('\n')
    )
  })

  it('shows task list items with their brackets, as Redcarpet does', () => {
    expect(render('- [ ] open\n- [x] done')).toBe(
      '<ul>\n<li>[ ] open</li>\n<li>[x] done</li>\n</ul>'
    )
  })

  it('wraps plain text in paragraphs split on blank lines', () => {
    expect(render('Be excellent.\nTo everyone.\n\nThank you.')).toBe(
      '<p>Be excellent.\nTo everyone.</p>\n<p>Thank you.</p>'
    )
  })

  it.each([
    {
      name: 'a script block',
      markdown: '<script>alert(1)</script>',
      expected: '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>'
    },
    {
      name: 'inline tags',
      markdown: 'Read <b onclick="x()">this</b>',
      expected: '<p>Read &lt;b onclick="x()"&gt;this&lt;/b&gt;</p>'
    },
    {
      name: 'a block element',
      markdown: '<div style="display:none">hidden</div>',
      expected: '<p>&lt;div style="display:none"&gt;hidden&lt;/div&gt;</p>'
    }
  ])('shows raw HTML as text: $name', ({ markdown, expected }) => {
    expect(render(markdown)).toBe(expected)
  })

  it('drops images, keeping their alt text', () => {
    expect(render('Our logo: ![the logo](https://llun.test/logo.png)')).toBe(
      '<p>Our logo: the logo</p>'
    )
  })

  it.each([
    ['javascript:alert(1)'],
    ['JAVASCRIPT:alert(1)'],
    ['data:text/html,<script>alert(1)</script>'],
    ['//evil.example/path']
  ])('strips the unsafe link target %s', (href) => {
    const html = render(`[click](${href})`)
    expect(html).not.toContain('href')
    expect(html).toContain('>click</a>')
  })

  it('marks links nofollow and keeps their title', () => {
    expect(render('[Rules](https://llun.test/about "Server rules")')).toBe(
      '<p><a href="https://llun.test/about" title="Server rules" rel="nofollow noopener noreferrer">Rules</a></p>'
    )
  })

  it('links bare URLs and email addresses', () => {
    expect(render('Write to admin@llun.test or see https://llun.test')).toBe(
      '<p>Write to <a href="mailto:admin@llun.test" rel="nofollow noopener noreferrer">admin@llun.test</a> or see <a href="https://llun.test" rel="nofollow noopener noreferrer">https://llun.test</a></p>'
    )
  })

  it('replaces %{domain} with the visited domain', () => {
    expect(
      renderPolicyMarkdown('%{domain} is run by %{domain}.', {
        domain: 'run.example'
      })
    ).toBe('<p>run.example is run by run.example.</p>')
  })

  it('leaves level-1 headings alone for the API', () => {
    expect(render('# Terms of service\n\n# Changes')).toBe(
      '<h1>Terms of service</h1>\n<h1>Changes</h1>'
    )
  })

  it('pins the API HTML without page ids, classes or title normalization', () => {
    expect(
      render('# Terms of service\n\n## A &amp; B\n\n**Note**\n\n# Changes')
    ).toBe(
      '<h1>Terms of service</h1>\n<h2>A &amp; B</h2>\n<p><strong>Note</strong></p>\n<h1>Changes</h1>'
    )
  })

  describe('for a page', () => {
    const page = (markdown: string) =>
      renderPolicyPage(markdown, {
        domain: 'llun.test',
        title: 'Terms of service'
      })
    const renderForPage = (markdown: string) =>
      renderPolicyPage(markdown, {
        domain: 'llun.test',
        title: 'Terms of service'
      }).html

    it('drops a leading heading that repeats the page title', () => {
      expect(renderForPage('\n# Terms of  Service\n\nBe excellent.')).toBe(
        '<p>Be excellent.</p>'
      )
    })

    it('demotes every other level-1 heading so the page keeps one h1', () => {
      expect(
        renderForPage(
          '# Our terms\n\nIntro\n\n# Changes\n\n> # Quoted\n\n## Already two'
        )
      ).toBe(
        [
          '<h2 id="section-our-terms">Our terms</h2>',
          '<p>Intro</p>',
          '<h2 id="section-changes">Changes</h2>',
          '<blockquote>',
          '<h2 id="section-quoted">Quoted</h2>',
          '</blockquote>',
          '<h2 id="section-already-two">Already two</h2>'
        ].join('\n')
      )
    })

    it('keeps reference links working after dropping the title', () => {
      expect(
        renderForPage(
          '# Terms of service\n\nSee [rules][1].\n\n[1]: https://a.b'
        )
      ).toBe(
        '<p>See <a href="https://a.b" rel="nofollow noopener noreferrer">rules</a>.</p>'
      )
    })

    it('uses decoded display text for ids and index labels', () => {
      const { html, headings } = page(
        '## Café &amp; **bold** _x_ [label](https://a.b) `code` %{domain}\n\n## <b>x</b>\n\n## &#65; &amp;lt;b&amp;gt;'
      )
      expect(headings).toEqual([
        {
          id: 'section-cafe-bold-x-label-code-llun-test',
          text: 'Café & bold x label code llun.test'
        },
        { id: 'section-b-x-b', text: '<b>x</b>' },
        { id: 'section-a-lt-b-gt', text: 'A &lt;b&gt;' }
      ])
      for (const { id } of headings) expect(html).toContain(`id="${id}"`)
      expect(html).toContain('&lt;b&gt;x&lt;/b&gt;')
    })

    it('de-duplicates slugs against every used id, including suffix collisions', () => {
      expect(
        page('## Foo\n\n## Foo\n\n## Foo 2\n\n## Foo\n\n## Foo 2').headings.map(
          ({ id }) => id
        )
      ).toEqual([
        'section-foo',
        'section-foo-2',
        'section-foo-2-2',
        'section-foo-3',
        'section-foo-2-3'
      ])
    })

    it('counts empty h2s for fallback positions but does not index them', () => {
      const { html, headings } = page('##\n\n## ไทย\n\n## 2\n\n## !!!')
      expect(headings).toEqual([
        { id: 'section-2', text: 'ไทย' },
        { id: 'section-2-2', text: '2' },
        { id: 'section-4', text: '!!!' }
      ])
      expect(html).toContain('<h2></h2>')
    })

    it('indexes demoted h1s, omits the dropped title and ignores h3s', () => {
      const { headings } = page(
        '# Terms of service\n\n# Changes\n\n### Detail\n\n## Data'
      )
      expect(headings).toEqual([
        { id: 'section-changes', text: 'Changes' },
        { id: 'section-data', text: 'Data' }
      ])
    })

    it.each(['**Note:**', '  **Note:**  ', '**A _formatted_ label**'])(
      'marks a paragraph containing only one strong token: %s',
      (markdown) => {
        expect(page(markdown).html).toMatch(/^<p class="policy-label">/)
      }
    )

    it.each(['**Note:** text', '**a** **b**', '*Note*', '`**Note**`'])(
      'does not mark other paragraphs as labels: %s',
      (markdown) => {
        expect(page(markdown).html).not.toContain('class=')
      }
    )

    it('marks nested labels without allowing author-controlled attributes', () => {
      const { html, headings } = page(
        '<h2 id="x">Raw</h2>\n\n<p class="policy-label">Raw label</p>\n\n## Heading {#custom}\n\n## A "quote"\n\n## "><script>alert(1)</script>\n\n> **Quote**\n\n- **Loose**\n\n  More'
      )
      expect(html).toContain('&lt;h2 id="x"&gt;Raw&lt;/h2&gt;')
      expect(html).toContain(
        '&lt;p class="policy-label"&gt;Raw label&lt;/p&gt;'
      )
      expect(html).not.toContain('<h2 id="x">')
      expect(html).not.toContain('<script>')
      expect(html).toContain('<blockquote>\n<p class="policy-label">')
      expect(html).toContain('<li><p class="policy-label">')
      expect(headings).toEqual([
        { id: 'section-heading-custom', text: 'Heading {#custom}' },
        { id: 'section-a-quote', text: 'A "quote"' },
        {
          id: 'section-script-alert-1-script',
          text: '"><script>alert(1)</script>'
        }
      ])
      expect(
        [...html.matchAll(/<h2 id="([^"]+)">/g)].map((match) => match[1])
      ).toEqual(headings.map(({ id }) => id))
    })
  })
})
