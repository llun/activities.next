import { TEST_DOMAIN } from '@/lib/stub/const'

import { convertTextContent } from './convertTextContent'

describe('#convertTextContent', () => {
  it('produces html from markdown text', () => {
    expect(convertTextContent(TEST_DOMAIN, 'sample text')).toEqual(
      '<p>sample text</p>'
    )
  })

  it('auto detect link', () => {
    const text = `
This is a text with link

https://www.llun.dev
    `.trim()
    expect(convertTextContent(TEST_DOMAIN, text)).toEqual(
      '<p>This is a text with link</p>\n<p><a href="https://www.llun.dev/" rel="nofollow noopener noreferrer">llun.dev</a></p>'
    )
  })

  it('auto detech mention', () => {
    const text = `@null@llun.dev test mention`
    expect(convertTextContent(TEST_DOMAIN, text)).toEqual(
      '<p><span class="h-card"><a href="https://test.llun.dev/@null@llun.dev" class="u-url mention">@<span>null</span></a></span> test mention</p>'
    )
  })
})
