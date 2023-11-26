import { getConfig } from '../../config'
import { linkifyText } from './linkifyText'

describe('#linkifyText', () => {
  const config = getConfig()

  it('links mention with user url', async () => {
    const message = linkifyText('@test1@somewhere.test')
    expect(message).toEqual(
      `<span class="h-card"><a href="https://${
        getConfig().host
      }/@test1@somewhere.test" target="_blank" class="u-url mention">@<span>test1</span></a></span>`
    )
  })

  it('links multiple mentions with user url', async () => {
    const message = linkifyText(
      'With multiple mentions @test1@somewhere.test and @test2@llun.test tags'
    )
    expect(message).toEqual(
      `With multiple mentions <span class="h-card"><a href="https://${config.host}/@test1@somewhere.test" target="_blank" class="u-url mention">@<span>test1</span></a></span> and <span class="h-card"><a href="https://${config.host}/@test2@llun.test" target="_blank" class="u-url mention">@<span>test2</span></a></span> tags`
    )
  })

  it('linkify http link', async () => {
    const message = linkifyText(
      'Test linkify string https://www.llun.me/posts/dev/2023-01-07-my-wrong-assumptions-with-activity-pub/ with url'
    )
    expect(message).toEqual(
      'Test linkify string <a href="https://www.llun.me/posts/dev/2023-01-07-my-wrong-assumptions-with-activity-pub/" target="_blank" rel="nofollow noopener noreferrer">llun.me/posts/dev/2023-01-07-my-…</a> with url'
    )
  })

  it('linkify link without protocol and pathname', async () => {
    const message = linkifyText(
      'Test linkify string llun.me, without protocol and pathname'
    )
    expect(message).toEqual(
      'Test linkify string <a href="https://llun.me/" target="_blank" rel="nofollow noopener noreferrer">llun.me</a>, without protocol and pathname'
    )
  })

  it('linkify link without protocol', async () => {
    const message = linkifyText(
      'Test linkify string llun.me/pathname, without pathname'
    )
    expect(message).toEqual(
      'Test linkify string <a href="https://llun.me/pathname" target="_blank" rel="nofollow noopener noreferrer">llun.me/pathname</a>, without pathname'
    )
  })

  it('linkify link without protocol with very long pathname', async () => {
    const message = linkifyText(
      'Test linkify string www.llun.me/posts/dev/2023-01-07-my-wrong-assumptions-with-activity-pub/, without pathname'
    )
    expect(message).toEqual(
      'Test linkify string <a href="https://www.llun.me/posts/dev/2023-01-07-my-wrong-assumptions-with-activity-pub/" target="_blank" rel="nofollow noopener noreferrer">llun.me/posts/dev/2023-01-07-my-…</a>, without pathname'
    )
  })

  it('linkify link include query', async () => {
    const message = linkifyText(
      'Test linkify with query in url https://www.youtube.com/watch?v=mroK84Y2GwM'
    )
    expect(message).toEqual(
      'Test linkify with query in url <a href="https://www.youtube.com/watch?v=mroK84Y2GwM" target="_blank" rel="nofollow noopener noreferrer">youtube.com/watch?v=mroK84Y2GwM</a>'
    )
  })

  it('linkify cuts query short', async () => {
    const message = linkifyText(
      'Linkify with long query https://www.google.com/search?q=noreferrer&sourceid=chrome&ie=UTF-8'
    )
    expect(message).toEqual(
      'Linkify with long query <a href="https://www.google.com/search?q=noreferrer&sourceid=chrome&ie=UTF-8" target="_blank" rel="nofollow noopener noreferrer">google.com/search?q=noreferrer&sour…</a>'
    )
  })
})
