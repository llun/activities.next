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
})
