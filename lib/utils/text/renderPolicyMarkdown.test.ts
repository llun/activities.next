import { renderPolicyMarkdown } from './renderPolicyMarkdown'

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

  describe('for a page', () => {
    const renderForPage = (markdown: string) =>
      renderPolicyMarkdown(markdown, {
        domain: 'llun.test',
        forPage: { title: 'Terms of service' }
      })

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
          '<h2>Our terms</h2>',
          '<p>Intro</p>',
          '<h2>Changes</h2>',
          '<blockquote>',
          '<h2>Quoted</h2>',
          '</blockquote>',
          '<h2>Already two</h2>'
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
  })
})
