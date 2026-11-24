import {
  blueskyActorId,
  blueskyImagesFromEmbed,
  blueskyPostId,
  blueskyPostToHtml,
  isBlueskyId,
  parseAtUri
} from '@/lib/services/bluesky/records'

const DID = 'did:plc:abc123'

// The UTF-8 byte range of `part` inside `text`, as Bluesky facets index it.
const byteRange = (text: string, part: string) => {
  const encoder = new TextEncoder()
  const byteStart = encoder.encode(text.slice(0, text.indexOf(part))).length
  return { byteStart, byteEnd: byteStart + encoder.encode(part).length }
}

describe('Bluesky ids', () => {
  it('builds actor and post ids', () => {
    expect(blueskyActorId(DID)).toBe(`https://bsky.app/profile/${DID}`)
    expect(blueskyPostId(DID, '3kxyz')).toBe(
      `https://bsky.app/profile/${DID}/post/3kxyz`
    )
    expect(isBlueskyId(blueskyPostId(DID, '3kxyz'))).toBe(true)
    expect(isBlueskyId('https://example.com/profile/x')).toBe(false)
  })

  it('parses at:// URIs keyed on a DID', () => {
    expect(parseAtUri(`at://${DID}/app.bsky.feed.post/3kxyz`)).toEqual({
      did: DID,
      collection: 'app.bsky.feed.post',
      rkey: '3kxyz'
    })
    expect(parseAtUri('at://alice.bsky.social/app.bsky.feed.post/3k')).toBe(
      null
    )
    expect(parseAtUri(`at://${DID}/app.bsky.feed.post`)).toBeNull()
    expect(parseAtUri(`https://${DID}/a/b`)).toBeNull()
  })
})

describe('blueskyPostToHtml', () => {
  it('escapes text and keeps line breaks', () => {
    expect(blueskyPostToHtml('a <b> & "c"\nnext')).toBe(
      '<p>a &lt;b&gt; &amp; &quot;c&quot;<br>next</p>'
    )
    expect(blueskyPostToHtml('')).toBe('')
  })

  it('links facets by UTF-8 byte offsets after emoji and Thai text', () => {
    const text = '🎉 สวัสดี @alice.bsky.social see example.com #ทดสอบ'
    const facets = [
      {
        index: byteRange(text, '@alice.bsky.social'),
        features: [{ $type: 'app.bsky.richtext.facet#mention', did: DID }]
      },
      {
        index: byteRange(text, 'example.com'),
        features: [
          {
            $type: 'app.bsky.richtext.facet#link',
            uri: 'https://example.com/?a=1&b=2'
          }
        ]
      },
      {
        index: byteRange(text, '#ทดสอบ'),
        features: [{ $type: 'app.bsky.richtext.facet#tag', tag: 'ทดสอบ' }]
      }
    ]
    const attrs = 'rel="nofollow noopener noreferrer" target="_blank"'
    expect(blueskyPostToHtml(text, facets)).toBe(
      `<p>🎉 สวัสดี <a href="https://bsky.app/profile/${DID}" ${attrs}>@alice.bsky.social</a>` +
        ` see <a href="https://example.com/?a=1&amp;b=2" ${attrs}>example.com</a>` +
        ` <a href="https://bsky.app/hashtag/${encodeURIComponent('ทดสอบ')}" ${attrs}>#ทดสอบ</a></p>`
    )
  })

  it('renders unsafe or malformed facets as plain text', () => {
    const text = 'click <here>'
    expect(
      blueskyPostToHtml(text, [
        {
          index: byteRange(text, '<here>'),
          features: [
            {
              $type: 'app.bsky.richtext.facet#link',
              uri: 'javascript:alert(1)'
            }
          ]
        },
        { index: { byteStart: 0, byteEnd: 999 }, features: [] },
        'not a facet'
      ])
    ).toBe('<p>click &lt;here&gt;</p>')
  })
})

describe('blueskyImagesFromEmbed', () => {
  const imagesView = {
    $type: 'app.bsky.embed.images#view',
    images: [
      {
        thumb: 'https://cdn.bsky.app/img/feed_thumbnail/plain/x/1@jpeg',
        fullsize: 'https://cdn.bsky.app/img/feed_fullsize/plain/x/1@jpeg',
        alt: 'A cat',
        aspectRatio: { width: 4, height: 3 }
      },
      { fullsize: 'javascript:alert(1)', thumb: '', alt: '' },
      { fullsize: 'https://cdn.bsky.app/img/feed_fullsize/plain/x/2@jpeg' }
    ]
  }

  it('maps an images view and skips images without a web URL', () => {
    expect(blueskyImagesFromEmbed(imagesView)).toEqual([
      {
        url: 'https://cdn.bsky.app/img/feed_fullsize/plain/x/1@jpeg',
        thumbnailUrl: 'https://cdn.bsky.app/img/feed_thumbnail/plain/x/1@jpeg',
        mediaType: 'image/jpeg',
        width: 4,
        height: 3,
        description: 'A cat'
      },
      {
        url: 'https://cdn.bsky.app/img/feed_fullsize/plain/x/2@jpeg',
        thumbnailUrl: null,
        mediaType: 'image/jpeg'
      }
    ])
  })

  it('reads the media of a quote with media', () => {
    expect(
      blueskyImagesFromEmbed({
        $type: 'app.bsky.embed.recordWithMedia#view',
        media: imagesView,
        record: {}
      })
    ).toHaveLength(2)
  })

  it('gives none for other embeds', () => {
    expect(
      blueskyImagesFromEmbed({ $type: 'app.bsky.embed.external#view' })
    ).toEqual([])
    expect(blueskyImagesFromEmbed(undefined)).toEqual([])
  })
})
