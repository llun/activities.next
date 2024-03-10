import { TEST_DOMAIN } from '@/lib/stub/const'

import { formatText } from './formatText'

describe('#formatText', () => {
  it('convert markdown text and linkify', async () => {
    const text =
      'Youtube video with time tag https://youtu.be/ODh4cTITV_Y?si=jvQSOW0ecDYC8dLD&t=186'
    const message = formatText(TEST_DOMAIN, text)
    expect(message).toEqual(
      '<p>Youtube video with time tag <a href="https://youtu.be/ODh4cTITV_Y?si=jvQSOW0ecDYC8dLD&t=186" target="_blank" rel="nofollow noopener noreferrer">youtu.be/ODh4cTITV_Y?si=jvQSOW0ec…</a></p>'
    )
    console.log(message)
  })
})
