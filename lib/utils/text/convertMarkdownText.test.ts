import { TEST_DOMAIN } from '@/lib/stub/const'

import { convertMarkdownText } from './convertMarkdownText'

describe('#convertMarkdownText', () => {
  it('detect links in the text and cut the text short', async () => {
    expect(
      convertMarkdownText(TEST_DOMAIN)(
        'Youtube video with time tag https://youtu.be/ODh4cTITV_Y?si=jvQSOW0ecDYC8dLD&t=186'
      )
    ).toEqual(
      '<p>Youtube video with time tag <a href="https://youtu.be/ODh4cTITV_Y?si=jvQSOW0ecDYC8dLD&t=186" target="_blank" rel="noopener noreferrer">youtu.be/ODh4cTITV_Y?si=jvQSOW…</a></p>'
    )
    expect(
      convertMarkdownText(TEST_DOMAIN)(
        'Test linkify string https://www.llun.me/posts/dev/2023-01-07-my-wrong-assumptions-with-activity-pub/ with url'
      )
    ).toEqual(
      '<p>Test linkify string <a href="https://www.llun.me/posts/dev/2023-01-07-my-wrong-assumptions-with-activity-pub/" target="_blank" rel="noopener noreferrer">llun.me/posts/dev/2023-01-07-m…</a> with url</p>'
    )
  })

  it('detect mention and convert to link', () => {
    expect(convertMarkdownText(TEST_DOMAIN)('@test1@somewhere.test')).toEqual(
      `<p><span class="h-card"><a href="https://${TEST_DOMAIN}/@test1@somewhere.test" target="_blank" class="u-url mention">@<span>test1</span></a></span></p>`
    )
  })

  it('links multiple mentions with user url', async () => {
    const message = convertMarkdownText(TEST_DOMAIN)(
      'With multiple mentions @test1@somewhere.test and @test2@llun.test tags'
    )
    expect(message).toEqual(
      `<p>With multiple mentions <span class="h-card"><a href="https://${TEST_DOMAIN}/@test1@somewhere.test" target="_blank" class="u-url mention">@<span>test1</span></a></span> and <span class="h-card"><a href="https://${TEST_DOMAIN}/@test2@llun.test" target="_blank" class="u-url mention">@<span>test2</span></a></span> tags</p>`
    )
  })

  it('should not convert invalid mention to link', async () => {
    expect(
      convertMarkdownText(TEST_DOMAIN)('With invalid mention @@something')
    ).toEqual(`<p>With invalid mention @@something</p>`)

    expect(
      convertMarkdownText(TEST_DOMAIN)('@something@ is invalid mention')
    ).toEqual(`<p>@something@ is invalid mention</p>`)

    expect(
      convertMarkdownText(TEST_DOMAIN)(
        'Invalid is in the middle @something@ of the text'
      )
    ).toEqual(`<p>Invalid is in the middle @something@ of the text</p>`)
  })

  it('detect hashtag and convert to link', () => {
    expect(convertMarkdownText(TEST_DOMAIN)('Hello #world')).toEqual(
      '<p>Hello <a href="/tags/world" class="hashtag" rel="tag">#<span>world</span></a></p>'
    )
  })

  it('links multiple hashtags', () => {
    const message = convertMarkdownText(TEST_DOMAIN)('#hello and #world tags')
    expect(message).toEqual(
      '<p><a href="/tags/hello" class="hashtag" rel="tag">#<span>hello</span></a> and <a href="/tags/world" class="hashtag" rel="tag">#<span>world</span></a> tags</p>'
    )
  })

  it('lowercases hashtag URLs', () => {
    expect(convertMarkdownText(TEST_DOMAIN)('#CamelCase')).toEqual(
      '<p><a href="/tags/camelcase" class="hashtag" rel="tag">#<span>CamelCase</span></a></p>'
    )
  })

  it('handles mention and hashtag together', () => {
    const message = convertMarkdownText(TEST_DOMAIN)('@user@example.com #topic')
    expect(message).toContain('class="u-url mention"')
    expect(message).toContain('class="hashtag"')
  })

  it('links hashtag followed by punctuation', () => {
    expect(convertMarkdownText(TEST_DOMAIN)('#tag, and more')).toContain(
      '<a href="/tags/tag" class="hashtag" rel="tag">#<span>tag</span></a>, and more'
    )
    expect(convertMarkdownText(TEST_DOMAIN)('#tag.')).toContain(
      '<a href="/tags/tag" class="hashtag" rel="tag">#<span>tag</span></a>.'
    )
  })
})
