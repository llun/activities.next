import { htmlToPlainText } from './htmlToPlainText'

describe('htmlToPlainText', () => {
  it('decodes entities after stripping HTML tags', () => {
    expect(htmlToPlainText('<p>Tom &amp; Jerry &lt;run&gt; fast</p>')).toBe(
      'Tom & Jerry <run> fast'
    )
  })

  it('separates adjacent block tags with spaces', () => {
    expect(htmlToPlainText('<p>Line one</p><p>Line two</p>')).toBe(
      'Line one Line two'
    )
  })

  it('separates line breaks with spaces', () => {
    expect(htmlToPlainText('<p>Line one<br>Line two</p>')).toBe(
      'Line one Line two'
    )
  })

  it('treats empty input as empty text', () => {
    expect(htmlToPlainText(null)).toBe('')
    expect(htmlToPlainText(undefined)).toBe('')
  })

  it('drops script and style contents', () => {
    expect(
      htmlToPlainText(
        '<p>Hello</p><script>alert("x")</script><style>.hidden{display:none}</style>'
      )
    ).toBe('Hello')
  })
})
