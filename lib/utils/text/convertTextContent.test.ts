import { convertTextContent } from './convertTextContent'

describe('#convertTextContent', () => {
  it('produces html from markdown text', () => {
    expect(convertTextContent('sample text')).toEqual('<p>sample text</p>')
  })

  it('auto detect link', () => {
    const text = `
This is a text with link

https://www.llun.dev
    `.trim()
    expect(convertTextContent(text)).toEqual(
      '<p>This is a text with link</p>\n<p><a href="https://https//www.llun.dev%3C/p%3E" target="_blank" rel="nofollow noopener noreferrer">https//www.llun.dev%3C/p%3E</a>'
    )
  })

  it('auto detech mention', () => {
    const text = `@null@llun.dev test mention`
    expect(convertTextContent(text)).toEqual(
      '<p><span class="h-card"><a href="https://test.llun.dev/@null@llun.dev" target="_blank" class="u-url mention">@<span>null</span></a></span> test mention</p>'
    )
  })
})
