import { convertMarkdownText } from './convertMarkdownText'

describe('#convertMarkdownText', () => {
  it('convert markdown text and linkify', async () => {
    const text =
      'Youtube video with time tag https://youtu.be/ODh4cTITV_Y?si=jvQSOW0ecDYC8dLD&t=186'
    const message = convertMarkdownText(text)
    expect(message).toEqual(
      '<p>Youtube video with time tag <a href="https://youtu.be/ODh4cTITV_Y?si=jvQSOW0ecDYC8dLD&t=186" target="_blank" rel="noopener noreferrer">youtu.be/ODh4cTITV_Y?si=jvQSOW…</a></p>'
    )
  })
})
