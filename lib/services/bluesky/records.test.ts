import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import {
  blueskyActorId,
  blueskyEmbedLinksHtml,
  blueskyImagesFromEmbed,
  blueskyPostId,
  blueskyPostToHtml,
  isBlueskyId,
  isBlueskyPostSensitive,
  parseAtUri,
  parseBlueskyPostView,
  storeBlueskyAuthor,
  storeBlueskyPostView
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
    expect(parseAtUri(`at://${DID}/app.bsky.feed.post/a b`)).toBeNull()
    expect(
      parseAtUri(`at://${DID}/app.bsky.feed.post/${'k'.repeat(513)}`)
    ).toBeNull()
    expect(
      parseAtUri(`at://${DID}/app.bsky.feed.post/${'k'.repeat(512)}`)
    ).not.toBeNull()
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

describe('blueskyEmbedLinksHtml', () => {
  const attrs = 'rel="nofollow noopener noreferrer" target="_blank"'
  const postUrl = blueskyPostId(DID, '3kpost')

  it('renders an external link card with its title or URI fallback', () => {
    expect(
      blueskyEmbedLinksHtml(
        {
          $type: 'app.bsky.embed.external#view',
          external: {
            uri: 'https://example.com/article',
            title: 'Example Article'
          }
        },
        postUrl
      )
    ).toBe(
      `<p><a href="https://example.com/article" ${attrs}>Example Article</a></p>`
    )

    expect(
      blueskyEmbedLinksHtml(
        {
          $type: 'app.bsky.embed.external#view',
          external: {
            uri: 'https://example.com/no-title',
            title: ''
          }
        },
        postUrl
      )
    ).toBe(
      `<p><a href="https://example.com/no-title" ${attrs}>https://example.com/no-title</a></p>`
    )
  })

  it('escapes HTML in external card titles and URIs', () => {
    expect(
      blueskyEmbedLinksHtml(
        {
          $type: 'app.bsky.embed.external#view',
          external: {
            uri: 'https://example.com/a?x=1&y=2',
            title: 'See <script>"xss"</script> & more'
          }
        },
        postUrl
      )
    ).toBe(
      `<p><a href="https://example.com/a?x=1&amp;y=2" ${attrs}>See &lt;script&gt;&quot;xss&quot;&lt;/script&gt; &amp; more</a></p>`
    )
  })

  it('drops external cards with non-http(s) URIs', () => {
    for (const uri of [
      'javascript:alert(1)',
      'ftp://example.com/file',
      'data:text/html,hi',
      'not a url'
    ]) {
      expect(
        blueskyEmbedLinksHtml(
          {
            $type: 'app.bsky.embed.external#view',
            external: { uri, title: 'Unsafe' }
          },
          postUrl
        )
      ).toBe('')
    }
  })

  it('cuts an external card title to 300 characters', () => {
    const title = '😀'.repeat(400)
    expect(
      blueskyEmbedLinksHtml(
        {
          $type: 'app.bsky.embed.external#view',
          external: { uri: 'https://example.com/long-title', title }
        },
        postUrl
      )
    ).toBe(
      `<p><a href="https://example.com/long-title" ${attrs}>${'😀'.repeat(300)}</a></p>`
    )
  })

  it('drops an external card whose URI is longer than 2048 characters', () => {
    const uri = `https://example.com/${'a'.repeat(2048)}`
    expect(uri.length).toBeGreaterThan(2048)
    expect(
      blueskyEmbedLinksHtml(
        {
          $type: 'app.bsky.embed.external#view',
          external: { uri, title: 'Long' }
        },
        postUrl
      )
    ).toBe('')
  })

  it('skips an external card whose URI already appears as a link in the post HTML', () => {
    const text = 'See example.com'
    const postHtml = blueskyPostToHtml(text, [
      {
        index: byteRange(text, 'example.com'),
        features: [
          {
            $type: 'app.bsky.richtext.facet#link',
            uri: 'https://example.com/?a=1&b=2'
          }
        ]
      }
    ])
    expect(
      blueskyEmbedLinksHtml(
        {
          $type: 'app.bsky.embed.external#view',
          external: {
            uri: 'https://example.com/?a=1&b=2',
            title: 'Example'
          }
        },
        postUrl,
        postHtml
      )
    ).toBe('')
    expect(
      blueskyEmbedLinksHtml(
        {
          $type: 'app.bsky.embed.external#view',
          external: {
            uri: 'https://other.example/page',
            title: 'Other'
          }
        },
        postUrl,
        postHtml
      )
    ).toBe(`<p><a href="https://other.example/page" ${attrs}>Other</a></p>`)
  })

  it('renders a quoted post link for record views and ignores other record kinds', () => {
    expect(
      blueskyEmbedLinksHtml(
        {
          $type: 'app.bsky.embed.record#view',
          record: {
            $type: 'app.bsky.embed.record#viewRecord',
            uri: `at://${DID}/app.bsky.feed.post/3kquoted`
          }
        },
        postUrl
      )
    ).toBe(
      `<p><a href="https://bsky.app/profile/${DID}/post/3kquoted" ${attrs}>Quoted post</a></p>`
    )

    for (const record of [
      {
        $type: 'app.bsky.feed.defs#generatorView',
        uri: `at://${DID}/app.bsky.feed.generator/whats-hot`
      },
      {
        $type: 'app.bsky.graph.defs#listView',
        uri: `at://${DID}/app.bsky.graph.list/3klist`
      },
      { $type: 'app.bsky.embed.record#viewBlocked' },
      { $type: 'app.bsky.embed.record#viewNotFound' },
      {
        $type: 'app.bsky.embed.record#viewRecord',
        uri: `at://${DID}/app.bsky.graph.list/3klist`
      }
    ]) {
      expect(
        blueskyEmbedLinksHtml(
          { $type: 'app.bsky.embed.record#view', record },
          postUrl
        )
      ).toBe('')
    }
  })

  it('renders the quoted post link for recordWithMedia views', () => {
    expect(
      blueskyEmbedLinksHtml(
        {
          $type: 'app.bsky.embed.recordWithMedia#view',
          media: { $type: 'app.bsky.embed.images#view', images: [] },
          record: {
            record: {
              $type: 'app.bsky.embed.record#viewRecord',
              uri: `at://${DID}/app.bsky.feed.post/3kquoted`
            }
          }
        },
        postUrl
      )
    ).toBe(
      `<p><a href="https://bsky.app/profile/${DID}/post/3kquoted" ${attrs}>Quoted post</a></p>`
    )
  })

  it('renders a link to the Bluesky post for video views', () => {
    expect(
      blueskyEmbedLinksHtml({ $type: 'app.bsky.embed.video#view' }, postUrl)
    ).toBe(`<p><a href="${postUrl}" ${attrs}>Video on Bluesky</a></p>`)
    expect(
      blueskyEmbedLinksHtml({ $type: 'app.bsky.embed.images#view' }, postUrl)
    ).toBe('')
    expect(blueskyEmbedLinksHtml(undefined, postUrl)).toBe('')
  })
})

describe('isBlueskyPostSensitive', () => {
  it('reads a moderation label on the view', () => {
    expect(isBlueskyPostSensitive({ labels: [{ val: 'porn' }] })).toBe(true)
  })

  it('reads the author self-label under record.labels.values', () => {
    expect(
      isBlueskyPostSensitive({
        record: { labels: { values: [{ val: 'graphic-media' }] } }
      })
    ).toBe(true)
  })

  it('ignores unrelated labels and a view without labels', () => {
    expect(
      isBlueskyPostSensitive({
        labels: [{ val: 'spam' }],
        record: { labels: { values: [{ val: '!no-unauthenticated' }] } }
      })
    ).toBe(false)
    expect(isBlueskyPostSensitive({})).toBe(false)
  })

  it('is false for malformed input', () => {
    for (const value of [
      null,
      undefined,
      'porn',
      42,
      [],
      { labels: 'porn' },
      { labels: [null, 'porn', { val: 1 }] },
      { record: { labels: { values: 'porn' } } }
    ]) {
      expect(isBlueskyPostSensitive(value)).toBe(false)
    }
  })
})

describe('storing AppView views', () => {
  const testDb = createTestDatabase()
  const { database } = testDb
  const ALICE = `did:plc:${'a'.repeat(24)}`
  const MALLORY = `did:plc:${'m'.repeat(24)}`

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
  })

  afterAll(async () => {
    await database.destroy()
  })

  it('stores an author with its handle and an escaped HTML description', async () => {
    expect(
      await storeBlueskyAuthor(database, {
        did: ALICE,
        handle: 'Alice.bsky.social',
        displayName: 'Alice',
        description: 'Hi <b>',
        avatar: 'https://cdn.bsky.app/a.jpg'
      })
    ).toBe(blueskyActorId(ALICE))
    expect(
      await database.getActorFromId({ id: blueskyActorId(ALICE) })
    ).toMatchObject({
      username: 'alice.bsky.social',
      name: 'Alice',
      summary: '<p>Hi &lt;b&gt;</p>'
    })
  })

  it.each(['handle.invalid', 'alice.bsky.social/x', ''])(
    'stores an author with handle %j under its DID, never taking another handle',
    async (handle) => {
      await storeBlueskyAuthor(database, { did: MALLORY, handle })
      expect(
        await database.getActorFromId({ id: blueskyActorId(MALLORY) })
      ).toMatchObject({ username: MALLORY, domain: 'bsky.app' })
      expect(
        await database.getActorFromId({ id: blueskyActorId(ALICE) })
      ).toMatchObject({ username: 'alice.bsky.social' })
    }
  )

  it('refuses an author without a valid DID', async () => {
    expect(
      await storeBlueskyAuthor(database, {
        did: 'did:plc:short',
        handle: 'x.bsky.social'
      })
    ).toBeNull()
  })

  it('stores a post view and links a reply to its parent', async () => {
    const post = parseBlueskyPostView({
      uri: `at://${ALICE}/app.bsky.feed.post/r1`,
      cid: 'cid-r1',
      author: { did: ALICE, handle: 'alice.bsky.social' },
      record: {
        $type: 'app.bsky.feed.post',
        text: 'A reply',
        createdAt: '2026-01-01T00:00:00.000Z',
        reply: { parent: { uri: `at://${MALLORY}/app.bsky.feed.post/p1` } }
      }
    })
    expect(post).not.toBeNull()
    const statusId = await storeBlueskyPostView(
      database,
      post as NonNullable<typeof post>
    )
    expect(statusId).toBe(blueskyPostId(ALICE, 'r1'))
    expect(
      await database.getStatus({ statusId: statusId as string })
    ).toMatchObject({
      text: '<p>A reply</p>',
      reply: blueskyPostId(MALLORY, 'p1')
    })
  })

  it('stores a post with a self-label as sensitive', async () => {
    const post = parseBlueskyPostView({
      uri: `at://${ALICE}/app.bsky.feed.post/nsfw1`,
      cid: 'cid-nsfw1',
      author: { did: ALICE, handle: 'alice.bsky.social' },
      record: {
        $type: 'app.bsky.feed.post',
        text: 'Labeled',
        createdAt: '2026-01-01T00:00:00.000Z',
        labels: {
          $type: 'com.atproto.label.defs#selfLabels',
          values: [{ val: 'nudity' }]
        }
      }
    })
    expect(post).not.toBeNull()
    const statusId = await storeBlueskyPostView(
      database,
      post as NonNullable<typeof post>
    )
    expect(
      await database.getStatus({ statusId: statusId as string })
    ).toMatchObject({ sensitive: true })
  })

  it('stores embed links for a card-only post and skips duplicate card links', async () => {
    const attrs = 'rel="nofollow noopener noreferrer" target="_blank"'
    const cardOnly = parseBlueskyPostView({
      uri: `at://${ALICE}/app.bsky.feed.post/card1`,
      cid: 'cid-card1',
      author: { did: ALICE, handle: 'alice.bsky.social' },
      record: {
        $type: 'app.bsky.feed.post',
        text: '',
        createdAt: '2026-01-01T00:00:00.000Z'
      },
      embed: {
        $type: 'app.bsky.embed.external#view',
        external: {
          uri: 'https://example.com/card',
          title: 'Card title'
        }
      }
    })
    expect(cardOnly).not.toBeNull()
    const cardStatusId = await storeBlueskyPostView(
      database,
      cardOnly as NonNullable<typeof cardOnly>
    )
    expect(
      await database.getStatus({ statusId: cardStatusId as string })
    ).toMatchObject({
      text: `<p><a href="https://example.com/card" ${attrs}>Card title</a></p>`
    })

    const text = 'Read example.com/card'
    const dupCard = parseBlueskyPostView({
      uri: `at://${ALICE}/app.bsky.feed.post/card2`,
      cid: 'cid-card2',
      author: { did: ALICE, handle: 'alice.bsky.social' },
      record: {
        $type: 'app.bsky.feed.post',
        text,
        facets: [
          {
            index: byteRange(text, 'example.com/card'),
            features: [
              {
                $type: 'app.bsky.richtext.facet#link',
                uri: 'https://example.com/card'
              }
            ]
          }
        ],
        createdAt: '2026-01-01T00:00:00.000Z'
      },
      embed: {
        $type: 'app.bsky.embed.external#view',
        external: {
          uri: 'https://example.com/card',
          title: 'Card title'
        }
      }
    })
    expect(dupCard).not.toBeNull()
    const dupStatusId = await storeBlueskyPostView(
      database,
      dupCard as NonNullable<typeof dupCard>
    )
    expect(
      await database.getStatus({ statusId: dupStatusId as string })
    ).toMatchObject({
      text: `<p>Read <a href="https://example.com/card" ${attrs}>example.com/card</a></p>`
    })
  })

  it('keeps only https media URLs that fit their column and clamps the name', async () => {
    const BOB = `did:plc:${'b'.repeat(24)}`
    const long = `https://cdn.bsky.app/${'x'.repeat(250)}.jpg`
    await storeBlueskyAuthor(
      database,
      {
        did: BOB,
        handle: 'bob.bsky.social',
        displayName: `${'😀'.repeat(300)}`,
        avatar: 'http://cdn.bsky.app/bob.jpg',
        banner: long
      },
      { full: true }
    )
    const actor = await database.getActorFromId({ id: blueskyActorId(BOB) })
    expect(Array.from(actor?.name ?? '')).toHaveLength(255)
    expect(actor?.iconUrl ?? '').toBe('')
    expect(actor?.headerImageUrl ?? '').toBe('')

    expect(
      blueskyImagesFromEmbed({
        $type: 'app.bsky.embed.images#view',
        images: [
          { fullsize: 'http://cdn.bsky.app/a.jpg' },
          { fullsize: long },
          {
            fullsize: 'https://cdn.bsky.app/ok.jpg',
            thumb: 'http://cdn.bsky.app/thumb.jpg'
          }
        ]
      })
    ).toEqual([
      {
        url: 'https://cdn.bsky.app/ok.jpg',
        thumbnailUrl: null,
        mediaType: 'image/jpeg'
      }
    ])
  })

  it('stores nothing for an author or post whose id is too long', async () => {
    const longDid = `did:web:${'w'.repeat(220)}.example`
    expect(
      await storeBlueskyAuthor(database, { did: longDid, handle: longDid })
    ).toBeNull()

    const nearDid = `did:web:${'n'.repeat(200)}.example`
    const post = parseBlueskyPostView({
      uri: `at://${nearDid}/app.bsky.feed.post/${'r'.repeat(40)}`,
      cid: 'cid-long',
      author: { did: nearDid, handle: 'near.bsky.social' },
      record: { $type: 'app.bsky.feed.post', text: 'Too long an id' }
    })
    expect(post).not.toBeNull()
    expect(
      await storeBlueskyPostView(database, post as NonNullable<typeof post>)
    ).toBeNull()
    expect(
      await database.getActorFromId({ id: blueskyActorId(nearDid) })
    ).toBeNull()
  })

  it.each([
    {
      case: 'a reply parent whose post id is too long',
      key: 'p',
      cid: 'cid-parent-long',
      parentUri: `at://did:web:${'p'.repeat(220)}.example/app.bsky.feed.post/${'q'.repeat(40)}`
    },
    {
      case: 'a cid that is too long',
      key: 'c',
      cid: 'c'.repeat(256),
      parentUri: undefined
    }
  ])('stores nothing for $case', async ({ key, cid, parentUri }) => {
    const did = `did:plc:${key.repeat(24)}`
    const post = parseBlueskyPostView({
      uri: `at://${did}/app.bsky.feed.post/long`,
      cid,
      author: { did, handle: `${key}.bsky.social` },
      record: {
        $type: 'app.bsky.feed.post',
        text: 'Too long',
        ...(parentUri ? { reply: { parent: { uri: parentUri } } } : null)
      }
    })
    expect(post).not.toBeNull()
    expect(
      await storeBlueskyPostView(database, post as NonNullable<typeof post>)
    ).toBeNull()
    expect(
      await database.getStatus({ statusId: blueskyPostId(did, 'long') })
    ).toBeNull()
    expect(
      await database.getActorFromId({ id: blueskyActorId(did) })
    ).toBeNull()
  })

  it('refuses a post view whose author is not the record owner', () => {
    expect(
      parseBlueskyPostView({
        uri: `at://${ALICE}/app.bsky.feed.post/x`,
        cid: 'cid',
        author: { did: MALLORY, handle: 'm.bsky.social' },
        record: { $type: 'app.bsky.feed.post', text: 'x' }
      })
    ).toBeNull()
  })

  it('stores and updates like, repost and reply counts from AppView views while ignoring invalid counts', async () => {
    const initial = parseBlueskyPostView({
      uri: `at://${ALICE}/app.bsky.feed.post/counts1`,
      cid: 'cid-counts1',
      author: { did: ALICE, handle: 'alice.bsky.social' },
      record: {
        $type: 'app.bsky.feed.post',
        text: 'Counted post',
        createdAt: '2026-01-01T00:00:00.000Z'
      },
      likeCount: 7,
      repostCount: 3,
      replyCount: 2
    })
    expect(initial).not.toBeNull()
    const statusId = (await storeBlueskyPostView(
      database,
      initial as NonNullable<typeof initial>
    )) as string

    expect(await database.getLikeCount({ statusId })).toBe(7)
    expect(await database.getStatusReblogsCount({ statusId })).toBe(3)
    expect(await database.getStatusRepliesCount({ statusId })).toBe(2)

    // Re-storing an already-stored post refreshes its counts (including 0).
    const updated = parseBlueskyPostView({
      uri: `at://${ALICE}/app.bsky.feed.post/counts1`,
      cid: 'cid-counts1',
      author: { did: ALICE, handle: 'alice.bsky.social' },
      record: {
        $type: 'app.bsky.feed.post',
        text: 'Counted post',
        createdAt: '2026-01-01T00:00:00.000Z'
      },
      likeCount: 15,
      repostCount: 0,
      replyCount: 5
    })
    await storeBlueskyPostView(database, updated as NonNullable<typeof updated>)

    expect(await database.getLikeCount({ statusId })).toBe(15)
    expect(await database.getStatusReblogsCount({ statusId })).toBe(0)
    expect(await database.getStatusRepliesCount({ statusId })).toBe(5)

    // Non-integer, negative or missing counts are ignored and leave stored counts intact.
    const invalid = parseBlueskyPostView({
      uri: `at://${ALICE}/app.bsky.feed.post/counts1`,
      cid: 'cid-counts1',
      author: { did: ALICE, handle: 'alice.bsky.social' },
      record: {
        $type: 'app.bsky.feed.post',
        text: 'Counted post',
        createdAt: '2026-01-01T00:00:00.000Z'
      },
      likeCount: -1,
      repostCount: 2.5,
      replyCount: '99'
    })
    await storeBlueskyPostView(database, invalid as NonNullable<typeof invalid>)

    expect(await database.getLikeCount({ statusId })).toBe(15)
    expect(await database.getStatusReblogsCount({ statusId })).toBe(0)
    expect(await database.getStatusRepliesCount({ statusId })).toBe(5)
  })
})
