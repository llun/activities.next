import { TEST_DOMAIN } from '@/lib/stub/const'

import { convertMarkdownText } from './convertMarkdownText'

describe('#convertMarkdownText', () => {
  it('detect links in the text and cut the text short', async () => {
    expect(
      convertMarkdownText(
        'Youtube video with time tag https://youtu.be/ODh4cTITV_Y?si=jvQSOW0ecDYC8dLD&t=186'
      )
    ).toEqual(
      '<p>Youtube video with time tag <a href="https://youtu.be/ODh4cTITV_Y?si=jvQSOW0ecDYC8dLD&t=186" target="_blank" rel="noopener noreferrer">youtu.be/ODh4cTITV_Y?si=jvQSOW…</a></p>'
    )
    expect(
      convertMarkdownText(
        'Test linkify string https://www.llun.me/posts/dev/2023-01-07-my-wrong-assumptions-with-activity-pub/ with url'
      )
    ).toEqual(
      '<p>Test linkify string <a href="https://www.llun.me/posts/dev/2023-01-07-my-wrong-assumptions-with-activity-pub/" target="_blank" rel="noopener noreferrer">llun.me/posts/dev/2023-01-07-m…</a> with url</p>'
    )
  })

  it('detect mention and convert to link', () => {
    expect(convertMarkdownText('@test1@somewhere.test')).toEqual(
      `<p><span class="h-card"><a href="https://${TEST_DOMAIN}/@test1@somewhere.test" target="_blank" class="u-url mention">@<span>test1</span></a></span></p>`
    )
  })
})
