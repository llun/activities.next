import sharp from 'sharp'

import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { CROSSPOST_BLUESKY_JOB_NAME } from '@/lib/jobs/names'
import {
  type BlueskyAgent,
  BlueskyRequestError,
  BlueskySessionEndedError,
  getBlueskyAgent
} from '@/lib/services/bluesky/agent'
import {
  getPublicPosts,
  getPublicProfiles
} from '@/lib/services/bluesky/appview'
import {
  BLUESKY_CROSSPOST_FAILED_MESSAGE,
  BLUESKY_CROSSPOST_IMAGE_FORMAT_MESSAGE,
  BLUESKY_CROSSPOST_NOT_LINKED_MESSAGE,
  BLUESKY_CROSSPOST_PARENT_NOT_READY_MESSAGE,
  BLUESKY_CROSSPOST_QUEUE_FAILED_MESSAGE,
  BLUESKY_CROSSPOST_SESSION_ENDED_MESSAGE,
  BLUESKY_CROSSPOST_UNEXPECTED_MESSAGE,
  crosspostStatus,
  enqueueBlueskyCrosspost
} from '@/lib/services/bluesky/crosspost'
import {
  BLUESKY_NOT_ALLOWED_MESSAGE,
  isBlueskyAllowed
} from '@/lib/services/bluesky/policy'
import { deterministicTid } from '@/lib/services/bluesky/tid'
import { readStoredImage } from '@/lib/services/medias/readStoredMedia'
import { getQueue } from '@/lib/services/queue'
import { TEST_DOMAIN, TEST_PASSWORD_HASH } from '@/lib/stub/const'
import type { Actor } from '@/lib/types/domain/actor'
import type { Status, StatusNote } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { safeImageFetch } from '@/lib/utils/safeImageDownload'
import { safeRemoteFetch } from '@/lib/utils/safeRemoteFetch'

vi.mock('@/lib/services/bluesky/agent', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getBlueskyAgent: vi.fn()
}))

vi.mock('@/lib/services/bluesky/appview', () => ({
  getPublicPosts: vi.fn(),
  getPublicProfiles: vi.fn()
}))

vi.mock('@/lib/services/bluesky/policy', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isBlueskyAllowed: vi.fn()
}))

const queue = { publish: vi.fn(), runsInline: false }
vi.mock('@/lib/services/queue', () => ({ getQueue: vi.fn(() => queue) }))

vi.mock('@/lib/services/medias/readStoredMedia', () => ({
  readStoredImage: vi.fn()
}))

// A stored media URL is /api/v1/files/<path>; anything else is not ours.
vi.mock('@/lib/services/medias/mediaFileUrl', () => ({
  getMediaPathFromFileUrl: (url: string) =>
    url.startsWith('https://media.test/files/')
      ? url.slice('https://media.test/files/'.length)
      : null
}))

vi.mock('@/lib/services/domains/servedDomainSnapshot', () => ({
  getServedHostConfig: () => ({})
}))

vi.mock('@/lib/utils/safeImageDownload', () => ({
  safeImageFetch: vi.fn()
}))

vi.mock('@/lib/utils/safeRemoteFetch', () => ({
  safeRemoteFetch: vi.fn()
}))

const OWN_DID = `did:plc:${'a'.repeat(24)}`
const OTHER_DID = `did:plc:${'b'.repeat(24)}`
const cid = (letter: string) => `bafyrei${letter.repeat(52)}`
const postUri = (rkey: string, did = OWN_DID) =>
  `at://${did}/app.bsky.feed.post/${rkey}`

let counter = 0
const nextId = (name: string) => `${name}-${++counter}`

describe('Bluesky cross-post', () => {
  const testDb = createTestDatabase()
  const { database } = testDb
  let actor: Actor
  let unlinked: Actor
  const get = vi.fn()
  const post = vi.fn()
  const uploadBlob = vi.fn()
  let png: Buffer

  const createAccount = async (username: string) => {
    await database.createAccount({
      email: `${username}@${TEST_DOMAIN}`,
      username,
      passwordHash: TEST_PASSWORD_HASH,
      domain: TEST_DOMAIN,
      privateKey: `privateKey-${username}`,
      publicKey: `publicKey-${username}`
    })
    return (await database.getActorFromId({
      id: `https://${TEST_DOMAIN}/users/${username}`
    })) as Actor
  }

  const createNote = async ({
    text = 'Hello Bluesky',
    to = [ACTIVITY_STREAM_PUBLIC],
    by = actor,
    ...rest
  }: {
    text?: string
    to?: string[]
    by?: Actor
    summary?: string
    reply?: string
    sensitive?: boolean
    language?: string
  } = {}) => {
    const id = `${by.id}/statuses/${nextId('note')}`
    await database.createNote({
      id,
      url: `https://${TEST_DOMAIN}/@${by.username}/${counter}`,
      actorId: by.id,
      to,
      cc: [],
      text,
      ...rest
    })
    return (await database.getStatus({
      statusId: id,
      withReplies: false
    })) as StatusNote
  }

  const claim = async <T extends Status>(status: T) => {
    await database.claimBlueskyCrosspost({
      statusId: status.id,
      actorId: status.actorId
    })
    return status
  }

  // A stored image the status's own actor owns, and the attachment pointing at
  // it. The attachment URL is deliberately not the media's own path: the
  // cross-post must read the media row, never the client-supplied URL.
  const createImageAttachment = async ({
    status,
    index,
    by = actor,
    uploadState = 'verified',
    isRouteMap = false,
    mediaType = 'image/png'
  }: {
    status: StatusNote
    index: number
    by?: Actor
    uploadState?: 'pending' | 'verified'
    isRouteMap?: boolean
    mediaType?: string
  }) => {
    const media = await database.createMedia({
      actorId: by.id,
      original: {
        path: `medias/photo-${index}.png`,
        bytes: png.length,
        mimeType: 'image/png',
        metaData: {
          width: 4,
          height: 2,
          upload: { state: uploadState }
        }
      }
    })
    await database.createAttachment({
      actorId: status.actorId,
      statusId: status.id,
      mediaType,
      url: `https://media.test/files/elsewhere-${index}.png`,
      width: 4,
      height: 2,
      name: `alt ${index}`,
      mediaId: media!.id,
      isRouteMap,
      createdAt: Date.now() + index
    })
    return media!
  }

  const createCall = (call = 0) =>
    post.mock.calls.filter(
      ([nsid]) => nsid === 'com.atproto.repo.createRecord'
    )[call]?.[1]

  const createdRecord = (call = 0) => createCall(call)?.record

  const answerCreate = (rkey: string) =>
    post.mockResolvedValueOnce({ uri: postUri(rkey), cid: cid('c') })

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
    actor = await createAccount('crossposter')
    unlinked = await createAccount('notlinked')
    await database.saveBlueskyAccount({
      actorId: actor.id,
      did: OWN_DID,
      handle: 'me.bsky.social',
      pdsUrl: 'https://pds.example.net/',
      authType: 'app_password',
      domainHandle: false
    })
    png = await sharp({
      create: { width: 4, height: 2, channels: 3, background: '#f00' }
    })
      .png()
      .toBuffer()
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(() => {
    vi.mocked(isBlueskyAllowed).mockReset().mockResolvedValue(true)
    vi.mocked(getPublicPosts).mockReset().mockResolvedValue([])
    vi.mocked(getPublicProfiles).mockReset().mockResolvedValue([])
    vi.mocked(readStoredImage).mockReset()
    vi.mocked(safeImageFetch).mockReset()
    vi.mocked(safeRemoteFetch)
      .mockReset()
      .mockRejectedValue(new Error('No link preview in test'))
    vi.mocked(getQueue).mockClear()
    queue.publish.mockReset().mockResolvedValue(undefined)
    queue.runsInline = false
    get.mockReset()
    post.mockReset()
    uploadBlob.mockReset()
    uploadBlob.mockImplementation(async (_bytes, mimeType: string) => ({
      $type: 'blob',
      ref: { $link: `blob-${uploadBlob.mock.calls.length}` },
      mimeType,
      size: 10
    }))
    vi.mocked(getBlueskyAgent)
      .mockReset()
      .mockResolvedValue({
        did: OWN_DID,
        pdsUrl: 'https://pds.example.net/',
        get,
        post,
        uploadBlob
      } as BlueskyAgent)
  })

  describe('crosspostStatus', () => {
    it('posts the plain text with facets and records the uri', async () => {
      const status = await claim(
        await createNote({
          text: 'Hello **world** [site](https://example.com/a) #tag',
          language: 'en'
        })
      )
      answerCreate('3kplain')

      await crosspostStatus(database, status.id)

      const record = createdRecord()
      expect(record).toMatchObject({
        $type: 'app.bsky.feed.post',
        text: 'Hello world site https://example.com/a #tag',
        langs: ['en'],
        createdAt: new Date(status.createdAt).toISOString()
      })
      expect(record.facets).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            features: [
              {
                $type: 'app.bsky.richtext.facet#link',
                uri: 'https://example.com/a'
              }
            ]
          }),
          expect.objectContaining({
            features: [{ $type: 'app.bsky.richtext.facet#tag', tag: 'tag' }]
          })
        ])
      )
      expect(record).not.toHaveProperty('embed')
      expect(post).toHaveBeenCalledWith('com.atproto.repo.createRecord', {
        repo: OWN_DID,
        collection: 'app.bsky.feed.post',
        rkey: deterministicTid(status.createdAt, status.id),
        record
      })
      await expect(
        database.getBlueskyCrosspost({ statusId: status.id })
      ).resolves.toMatchObject({
        state: 'posted',
        uri: postUri('3kplain'),
        cid: cid('c'),
        error: null
      })
    })

    it('normalizes underscore language tags to BCP-47 hyphens and omits invalid language values', async () => {
      const zhTw = await claim(
        await createNote({ text: 'Traditional Chinese', language: 'zh_TW' })
      )
      answerCreate('3kzhtw')
      await crosspostStatus(database, zhTw.id)
      expect(createdRecord(0).langs).toEqual(['zh-TW'])

      const invalid = await claim(
        await createNote({ text: 'Bad lang', language: 'not_a_valid_tag!' })
      )
      answerCreate('3kbadlang')
      await crosspostStatus(database, invalid.id)
      expect(createdRecord(1)).not.toHaveProperty('langs')

      const longPrimary = await claim(
        await createNote({ text: 'Long primary', language: 'english' })
      )
      answerCreate('3klonglang')
      await crosspostStatus(database, longPrimary.id)
      expect(createdRecord(2)).not.toHaveProperty('langs')
    })

    it('cuts a long post at a sentence end with a link to the full post', async () => {
      const sentence = 'This is one complete sentence of the long post. '
      const status = await claim(
        await createNote({ text: sentence.repeat(10).trim() })
      )
      answerCreate('3klong')

      await crosspostStatus(database, status.id)

      const { text } = createdRecord()
      expect(text.endsWith(`post.… ${status.url}`)).toBe(true)
      expect([...new Intl.Segmenter().segment(text)].length).toBeLessThan(301)
      expect(createdRecord().facets).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            features: [
              { $type: 'app.bsky.richtext.facet#link', uri: status.url }
            ]
          })
        ])
      )
    })

    it('uploads up to four images with alt text, and links to the post for what it leaves out', async () => {
      const status = await createNote({ text: 'Photos', sensitive: true })
      for (let index = 0; index < 5; index++) {
        await createImageAttachment({ status, index })
      }
      await claim(status)
      vi.mocked(readStoredImage).mockResolvedValue({
        buffer: png,
        mimeType: 'image/png'
      } as Awaited<ReturnType<typeof readStoredImage>>)
      answerCreate('3kimages')

      await crosspostStatus(database, status.id)

      expect(uploadBlob).toHaveBeenCalledTimes(4)
      // The media row's own stored path is read, not the attachment URL.
      expect(readStoredImage).toHaveBeenCalledWith(
        database,
        'medias/photo-0.png'
      )
      const record = createdRecord()
      expect(record.embed.$type).toBe('app.bsky.embed.images')
      expect(record.embed.images).toHaveLength(4)
      expect(record.embed.images[0]).toEqual({
        image: expect.objectContaining({ $type: 'blob' }),
        alt: 'alt 0',
        aspectRatio: { width: 4, height: 2 }
      })
      expect(record.text).toBe(`Photos\n\n${status.url}`)
      // Sensitive images without a content warning carry the label.
      expect(record.labels).toEqual({
        $type: 'com.atproto.label.defs#selfLabels',
        values: [{ val: 'graphic-media' }]
      })
    })

    it('skips an image the status actor does not own, a pending upload and a route map', async () => {
      const status = await createNote({ text: 'Mixed' })
      // Owned by another actor: the media row is not the status actor's.
      await createImageAttachment({ status, index: 0, by: unlinked })
      // A presigned upload whose bytes are still the client's.
      await createImageAttachment({ status, index: 1, uploadState: 'pending' })
      // A fitness route map is never a Bluesky photo.
      await createImageAttachment({ status, index: 2, isRouteMap: true })
      await claim(status)
      vi.mocked(readStoredImage).mockResolvedValue({
        buffer: png,
        mimeType: 'image/png'
      } as Awaited<ReturnType<typeof readStoredImage>>)
      answerCreate('3kskip')

      await crosspostStatus(database, status.id)

      expect(uploadBlob).not.toHaveBeenCalled()
      expect(readStoredImage).not.toHaveBeenCalled()
      const record = createdRecord()
      expect(record).not.toHaveProperty('embed')
      // Dropped media forces the link back to the post.
      expect(record.text).toBe(`Mixed\n\n${status.url}`)
    })

    it('says only the content warning and the link, without images or label', async () => {
      const status = await createNote({
        text: 'Hidden text',
        summary: 'Spoilers ahead',
        sensitive: true
      })
      await database.createAttachment({
        actorId: actor.id,
        statusId: status.id,
        mediaType: 'image/png',
        url: 'https://media.test/files/cw.png',
        width: 4,
        height: 2
      })
      await claim(status)
      vi.mocked(readStoredImage).mockResolvedValue({
        buffer: png,
        mimeType: 'image/png'
      } as Awaited<ReturnType<typeof readStoredImage>>)
      answerCreate('3kcw')

      await crosspostStatus(database, status.id)

      const record = createdRecord()
      expect(record.text).toBe(`Spoilers ahead\n\n${status.url}`)
      expect(record).not.toHaveProperty('embed')
      expect(record).not.toHaveProperty('labels')
      expect(uploadBlob).not.toHaveBeenCalled()
    })

    it('links a poll to where it is voted on', async () => {
      const id = `${actor.id}/statuses/${nextId('poll')}`
      await database.createPoll({
        id,
        url: `https://${TEST_DOMAIN}/@crossposter/poll`,
        actorId: actor.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        text: 'Which one?',
        choices: ['A', 'B'],
        endAt: Date.now() + 60_000
      })
      await database.claimBlueskyCrosspost({ statusId: id, actorId: actor.id })
      answerCreate('3kpoll')

      await crosspostStatus(database, id)

      expect(createdRecord().text).toBe(
        `Which one?\n\nVote here: https://${TEST_DOMAIN}/@crossposter/poll`
      )
    })

    it('converts HTML poll text to plain text with paragraph breaks, entities and tag facets', async () => {
      const id = `${actor.id}/statuses/${nextId('poll-html')}`
      const pollUrl = `https://${TEST_DOMAIN}/@crossposter/poll-html`
      await database.createPoll({
        id,
        url: pollUrl,
        actorId: actor.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        text: '<p>Best <a href="/tags/tea" class="hashtag" rel="tag">#<span>tea</span></a> &amp; coffee?</p>\n<p>Pick one</p>',
        choices: ['Tea', 'Coffee'],
        endAt: Date.now() + 60_000
      })
      await database.claimBlueskyCrosspost({ statusId: id, actorId: actor.id })
      answerCreate('3kpollhtml')

      await crosspostStatus(database, id)

      const record = createdRecord()
      expect(record.text).toBe(
        `Best #tea & coffee?\n\nPick one\n\nVote here: ${pollUrl}`
      )
      expect(record.facets).toEqual(
        expect.arrayContaining([
          {
            index: { byteStart: 5, byteEnd: 9 },
            features: [{ $type: 'app.bsky.richtext.facet#tag', tag: 'tea' }]
          }
        ])
      )
    })

    it('links a quote of a fediverse post and never embeds a Bluesky quote', async () => {
      // Quoting a Bluesky post is refused when the quote is created, so a
      // stored Bluesky quote is not embedded: it is only a URL in the text.
      const quotedActorId = (await database.upsertBlueskyActor({
        did: OTHER_DID,
        handle: 'other.bsky.social'
      })) as string
      const quoted = await database.upsertBlueskyPost({
        uri: postUri('3kquoted', OTHER_DID),
        cid: cid('q'),
        did: OTHER_DID,
        rkey: '3kquoted',
        actorId: quotedActorId,
        text: '<p>Quoted</p>',
        createdAt: Date.now() - 1000,
        attachments: []
      })
      const bskyQuote = await createNote({ text: 'Look at this' })
      await database.createStatusQuote({
        statusId: bskyQuote.id,
        quotedStatusId: quoted.statusId,
        state: 'accepted'
      })
      await claim(bskyQuote)
      answerCreate('3kq1')

      await crosspostStatus(database, bskyQuote.id)

      expect(createdRecord(0)).not.toHaveProperty('embed')

      const fediversePost = await createNote({ text: 'Original', by: unlinked })
      const fediQuote = await createNote({ text: 'Quoting' })
      await database.createStatusQuote({
        statusId: fediQuote.id,
        quotedStatusId: fediversePost.id,
        state: 'accepted'
      })
      await claim(fediQuote)
      answerCreate('3kq2')

      await crosspostStatus(database, fediQuote.id)

      const record = createdRecord(1)
      expect(record.text).toBe(`Quoting\n\n${fediversePost.url}`)
      expect(record).not.toHaveProperty('embed')
    })

    it('omits the quote URL when quoting own followers-only post or a non-accepted quote', async () => {
      const followersOnly = await createNote({
        text: 'Followers secret',
        to: [`${actor.id}/followers`]
      })
      const quoteFollowers = await createNote({ text: 'Quoting my private' })
      await database.createStatusQuote({
        statusId: quoteFollowers.id,
        quotedStatusId: followersOnly.id,
        state: 'accepted'
      })
      await claim(quoteFollowers)
      answerCreate('3kqpriv')

      await crosspostStatus(database, quoteFollowers.id)

      expect(createdRecord(0).text).toBe('Quoting my private')
      expect(createdRecord(0).text).not.toContain(followersOnly.url)

      const publicPost = await createNote({ text: 'Public post', by: unlinked })
      const revokedQuote = await createNote({ text: 'Revoked quote' })
      await database.createStatusQuote({
        statusId: revokedQuote.id,
        quotedStatusId: publicPost.id,
        state: 'revoked'
      })
      await claim(revokedQuote)
      answerCreate('3kqrev')

      await crosspostStatus(database, revokedQuote.id)

      expect(createdRecord(1).text).toBe('Revoked quote')
      expect(createdRecord(1).text).not.toContain(publicPost.url)

      const pendingQuote = await createNote({ text: 'Pending quote' })
      await database.createStatusQuote({
        statusId: pendingQuote.id,
        quotedStatusId: publicPost.id,
        state: 'pending'
      })
      await claim(pendingQuote)
      answerCreate('3kqpend')

      await crosspostStatus(database, pendingQuote.id)

      expect(createdRecord(2).text).toBe('Pending quote')
      expect(createdRecord(2).text).not.toContain(publicPost.url)
    })

    it('never embeds anything on a content-warning post, even with a quote', async () => {
      // A Bluesky quote would be embedded by the old path; a content warning
      // must still leave it out.
      const quotedActorId = (await database.upsertBlueskyActor({
        did: OTHER_DID,
        handle: 'other.bsky.social'
      })) as string
      const quoted = await database.upsertBlueskyPost({
        uri: postUri('3kcwquoted', OTHER_DID),
        cid: cid('w'),
        did: OTHER_DID,
        rkey: '3kcwquoted',
        actorId: quotedActorId,
        text: '<p>Quoted</p>',
        createdAt: Date.now() - 1000,
        attachments: []
      })
      const status = await createNote({
        text: 'Hidden',
        summary: 'Spoilers',
        sensitive: true
      })
      await database.createStatusQuote({
        statusId: status.id,
        quotedStatusId: quoted.statusId,
        state: 'accepted'
      })
      await claim(status)
      answerCreate('3kcwquote')

      await crosspostStatus(database, status.id)

      const record = createdRecord()
      expect(record.text).toBe(`Spoilers\n\n${status.url}`)
      expect(record).not.toHaveProperty('embed')
    })

    it('adds the preview card of the first link with its picture', async () => {
      const status = await claim(
        await createNote({ text: 'Read https://news.test/a' })
      )
      const getStatus = database.getStatus.bind(database)
      const spy = vi
        .spyOn(database, 'getStatus')
        .mockImplementation(async (params) => {
          const found = await getStatus(params)
          return found?.id === status.id
            ? {
                ...found,
                linkPreview: {
                  url: 'https://news.test/a',
                  title: 'News',
                  description: 'What happened',
                  imageUrl: 'https://news.test/a.png'
                }
              }
            : found
        })
      // The header lies: the bytes are a PNG, so the blob must be image/png.
      vi.mocked(safeImageFetch).mockResolvedValue(
        new Response(new Uint8Array(png), {
          headers: { 'content-type': 'image/jpeg' }
        })
      )
      answerCreate('3kcard')

      try {
        await crosspostStatus(database, status.id)
      } finally {
        spy.mockRestore()
      }

      expect(uploadBlob).toHaveBeenCalledWith(expect.any(Buffer), 'image/png')
      expect(createdRecord().embed).toEqual({
        $type: 'app.bsky.embed.external',
        external: {
          uri: 'https://news.test/a',
          title: 'News',
          description: 'What happened',
          thumb: expect.objectContaining({ $type: 'blob' })
        }
      })
    })

    it('resolves and embeds a cached link preview before acquiring the per-actor lock', async () => {
      const url = 'https://cached.test/article'
      await database.upsertLinkPreview({
        urlHash: getHashFromString(url),
        url,
        title: 'Cached Article',
        description: 'Already in cache',
        imageUrl: null,
        fetchStatus: 'completed',
        error: null
      })
      const status = await claim(await createNote({ text: `Read ${url}` }))
      answerCreate('3kcachedcard')

      const order: string[] = []
      const originalLink = database.linkStatusLinkPreview.bind(database)
      const originalAcquire = database.acquireImportLock.bind(database)
      const linkSpy = vi
        .spyOn(database, 'linkStatusLinkPreview')
        .mockImplementation(async (params) => {
          order.push('linkStatusLinkPreview')
          return originalLink(params)
        })
      const lockSpy = vi
        .spyOn(database, 'acquireImportLock')
        .mockImplementation(async (params) => {
          order.push('acquireImportLock')
          return originalAcquire(params)
        })

      try {
        await crosspostStatus(database, status.id)
      } finally {
        linkSpy.mockRestore()
        lockSpy.mockRestore()
      }

      expect(safeRemoteFetch).not.toHaveBeenCalled()
      expect(order).toEqual(['linkStatusLinkPreview', 'acquireImportLock'])
      expect(createdRecord().embed).toEqual({
        $type: 'app.bsky.embed.external',
        external: {
          uri: url,
          title: 'Cached Article',
          description: 'Already in cache'
        }
      })
      const updated = (await database.getStatus({
        statusId: status.id,
        withReplies: false
      })) as StatusNote | null
      expect(updated?.linkPreview).toMatchObject({
        url,
        title: 'Cached Article',
        description: 'Already in cache'
      })
    })

    it('still posts without a card if link preview resolution throws', async () => {
      const status = await claim(
        await createNote({ text: 'Read https://broken.test/article' })
      )
      const spy = vi
        .spyOn(database, 'getTags')
        .mockRejectedValueOnce(new Error('tags unavailable'))
      answerCreate('3kpreviewerr')

      try {
        await crosspostStatus(database, status.id)
      } finally {
        spy.mockRestore()
      }

      expect(createdRecord()).not.toHaveProperty('embed')
      await expect(
        database.getBlueskyCrosspost({ statusId: status.id })
      ).resolves.toMatchObject({
        state: 'posted',
        uri: postUri('3kpreviewerr')
      })
    })

    it('uses parent as root without calling AppView when replying to a top-level cross-posted post', async () => {
      const parent = await claim(await createNote({ text: 'Thread start' }))
      const parentAttemptId = await database.beginBlueskyCrosspostAttempt({
        statusId: parent.id
      })
      await database.markBlueskyCrosspostPosted({
        statusId: parent.id,
        attemptId: parentAttemptId!,
        uri: postUri('3ktopparent'),
        cid: cid('p')
      })
      const reply = await claim(
        await createNote({ text: 'Direct reply', reply: parent.id })
      )
      answerCreate('3kdirectreply')

      await crosspostStatus(database, reply.id)

      expect(getPublicPosts).not.toHaveBeenCalled()
      expect(createdRecord().reply).toEqual({
        root: { uri: postUri('3ktopparent'), cid: cid('p') },
        parent: { uri: postUri('3ktopparent'), cid: cid('p') }
      })
    })

    it("replies in the thread of the author's own cross-posted reply using the AppView root", async () => {
      const rootPost = await createNote({ text: 'Thread start' })
      const parent = await claim(
        await createNote({ text: 'Second part', reply: rootPost.id })
      )
      const parentAttemptId = await database.beginBlueskyCrosspostAttempt({
        statusId: parent.id
      })
      await database.markBlueskyCrosspostPosted({
        statusId: parent.id,
        attemptId: parentAttemptId!,
        uri: postUri('3kparent'),
        cid: cid('p')
      })
      vi.mocked(getPublicPosts).mockResolvedValue([
        {
          uri: postUri('3kparent'),
          cid: cid('p'),
          author: { did: OWN_DID, handle: 'me.bsky.social' },
          record: {
            $type: 'app.bsky.feed.post',
            text: 'Second part',
            createdAt: new Date().toISOString(),
            reply: {
              root: { uri: postUri('3kroot'), cid: cid('r') },
              parent: { uri: postUri('3kroot'), cid: cid('r') }
            }
          },
          indexedAt: new Date().toISOString()
        }
      ])
      const reply = await claim(
        await createNote({ text: 'Third part', reply: parent.id })
      )
      answerCreate('3kreply')

      await crosspostStatus(database, reply.id)

      expect(createdRecord().reply).toEqual({
        root: { uri: postUri('3kroot'), cid: cid('r') },
        parent: { uri: postUri('3kparent'), cid: cid('p') }
      })
    })

    it('retries when replying to a cross-posted reply not yet indexed on AppView, and marks failed once stale or inline', async () => {
      const rootPost = await createNote({ text: 'Thread start' })
      const parent = await claim(
        await createNote({ text: 'Second part', reply: rootPost.id })
      )
      const parentAttemptId = await database.beginBlueskyCrosspostAttempt({
        statusId: parent.id
      })
      await database.markBlueskyCrosspostPosted({
        statusId: parent.id,
        attemptId: parentAttemptId!,
        uri: postUri('3kunindexed'),
        cid: cid('u')
      })
      vi.mocked(getPublicPosts).mockResolvedValue([])

      const reply = await claim(
        await createNote({ text: 'Third part', reply: parent.id })
      )

      // Fresh row on an async queue rethrows so the queue retries later.
      await expect(crosspostStatus(database, reply.id)).rejects.toThrow(
        BLUESKY_CROSSPOST_PARENT_NOT_READY_MESSAGE
      )
      expect(post).not.toHaveBeenCalled()
      await expect(
        database.getBlueskyCrosspost({ statusId: reply.id })
      ).resolves.toMatchObject({ state: 'pending' })

      // Once older than STALE_CROSSPOST_MS, stops retrying and marks failed
      // with a clear message instead of spinning forever or staying stuck.
      await testDb.db
        .updateTable('bluesky_crossposts')
        .set({ updatedAt: new Date(Date.now() - 31 * 60 * 1000) })
        .where('statusId', '=', reply.id)
        .execute()

      await crosspostStatus(database, reply.id)
      expect(post).not.toHaveBeenCalled()
      await expect(
        database.getBlueskyCrosspost({ statusId: reply.id })
      ).resolves.toMatchObject({
        state: 'failed',
        error: BLUESKY_CROSSPOST_PARENT_NOT_READY_MESSAGE
      })

      // Inline queue (NoQueue) marks failed immediately with the clear message.
      const inlineReply = await claim(
        await createNote({ text: 'Inline third part', reply: parent.id })
      )
      queue.runsInline = true
      await crosspostStatus(database, inlineReply.id)
      expect(post).not.toHaveBeenCalled()
      await expect(
        database.getBlueskyCrosspost({ statusId: inlineReply.id })
      ).resolves.toMatchObject({
        state: 'failed',
        error: BLUESKY_CROSSPOST_PARENT_NOT_READY_MESSAGE
      })
    })

    it('waits for a parent still pending or posting, and drops a reply whose parent failed', async () => {
      const parent = await claim(await createNote({ text: 'Parent' }))
      const reply = await claim(
        await createNote({ text: 'Child', reply: parent.id })
      )

      await expect(crosspostStatus(database, reply.id)).rejects.toThrow()
      await expect(
        database.getBlueskyCrosspost({ statusId: reply.id })
      ).resolves.toMatchObject({ state: 'pending' })

      // Parent actively posting must also keep the reply retrying, never drop it.
      const parentAttemptId = await database.beginBlueskyCrosspostAttempt({
        statusId: parent.id
      })
      await expect(crosspostStatus(database, reply.id)).rejects.toThrow()
      await expect(
        database.getBlueskyCrosspost({ statusId: reply.id })
      ).resolves.toMatchObject({ state: 'pending' })

      await database.markBlueskyCrosspostFailed({
        statusId: parent.id,
        attemptId: parentAttemptId!,
        error: 'x'
      })
      await crosspostStatus(database, reply.id)

      await expect(
        database.getBlueskyCrosspost({ statusId: reply.id })
      ).resolves.toBeNull()
      expect(post).not.toHaveBeenCalled()
    })

    it('never posts a status twice, also when a job runs again after a retry', async () => {
      const status = await claim(await createNote({ text: 'Once' }))
      answerCreate('3konce')

      await crosspostStatus(database, status.id)
      await crosspostStatus(database, status.id)
      expect(post).toHaveBeenCalledTimes(1)

      // A retry only resets a failed row: a posted one stays posted.
      await expect(
        database.resetBlueskyCrosspostForRetry({ statusId: status.id })
      ).resolves.toBe(false)
      await crosspostStatus(database, status.id)
      expect(post).toHaveBeenCalledTimes(1)
    })

    it('posts once when two jobs for the same pending row run concurrently', async () => {
      const status = await claim(await createNote({ text: 'Concurrent' }))
      answerCreate('3kconcurrent')

      // The real per-actor lock serialises them: the second run finds the row
      // posted and stops before createRecord.
      await Promise.all([
        crosspostStatus(database, status.id),
        crosspostStatus(database, status.id)
      ])

      expect(
        post.mock.calls.filter(
          ([nsid]) => nsid === 'com.atproto.repo.createRecord'
        )
      ).toHaveLength(1)
      await expect(
        database.getBlueskyCrosspost({ statusId: status.id })
      ).resolves.toMatchObject({
        state: 'posted',
        uri: postUri('3kconcurrent')
      })
    })

    it("posts only once when a second attempt starts after the first's lock expired", async () => {
      const status = await claim(await createNote({ text: 'Slow PDS' }))
      let releaseCreate!: (value: { uri: string; cid: string }) => void
      let createEntered!: () => void
      const entered = new Promise<void>((resolve) => {
        createEntered = resolve
      })
      post.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseCreate = resolve
            createEntered()
          })
      )
      answerCreate('3kduplicate')

      const first = crosspostStatus(database, status.id)
      await entered

      // First attempt owns the exclusive 'posting' state while createRecord runs.
      await expect(
        database.getBlueskyCrosspost({ statusId: status.id })
      ).resolves.toMatchObject({ state: 'posting' })

      // Simulate the 3-minute per-actor lock TTL expiring while uploads/createRecord
      // are still in flight so a second job can take the lock immediately.
      await testDb.db
        .updateTable('fitness_import_locks')
        .set({ expiresAt: Date.now() - 1_000 })
        .execute()

      // Even if a second caller runs while the lock is expired (including if it
      // already read 'pending' before the lock), it stops without calling createRecord.
      await crosspostStatus(database, status.id)
      const originalGet = database.getBlueskyCrosspost.bind(database)
      const firstRow = await originalGet({ statusId: status.id })
      let readCount = 0
      const spy = vi
        .spyOn(database, 'getBlueskyCrosspost')
        .mockImplementation(async (params) => {
          readCount += 1
          if (readCount <= 2 && params.statusId === status.id && firstRow) {
            return { ...firstRow, state: 'pending' }
          }
          return originalGet(params)
        })
      try {
        await crosspostStatus(database, status.id)
      } finally {
        spy.mockRestore()
      }

      expect(
        post.mock.calls.filter(
          ([nsid]) => nsid === 'com.atproto.repo.createRecord'
        )
      ).toHaveLength(1)

      releaseCreate({ uri: postUri('3kslow'), cid: cid('s') })
      await first

      expect(
        post.mock.calls.filter(
          ([nsid]) => nsid === 'com.atproto.repo.createRecord'
        )
      ).toHaveLength(1)
      await expect(
        database.getBlueskyCrosspost({ statusId: status.id })
      ).resolves.toMatchObject({
        state: 'posted',
        uri: postUri('3kslow')
      })
    })

    it('takes over a stale posting row whose worker died and posts it', async () => {
      const status = await claim(await createNote({ text: 'Crashed worker' }))
      await database.beginBlueskyCrosspostAttempt({ statusId: status.id })
      await testDb.db
        .updateTable('bluesky_crossposts')
        .set({ updatedAt: new Date(Date.now() - 31 * 60 * 1000) })
        .where('statusId', '=', status.id)
        .execute()
      answerCreate('3krecovered')

      await crosspostStatus(database, status.id)

      await expect(
        database.getBlueskyCrosspost({ statusId: status.id })
      ).resolves.toMatchObject({
        state: 'posted',
        uri: postUri('3krecovered')
      })
    })

    it('deletes the new record when the post was deleted while it was created', async () => {
      const status = await claim(await createNote({ text: 'Gone' }))
      answerCreate('3kgone')
      const spy = vi
        .spyOn(database, 'markBlueskyCrosspostPosted')
        .mockResolvedValue(false)
      try {
        await crosspostStatus(database, status.id)
      } finally {
        spy.mockRestore()
      }

      expect(post).toHaveBeenCalledWith('com.atproto.repo.deleteRecord', {
        repo: OWN_DID,
        collection: 'app.bsky.feed.post',
        rkey: '3kgone'
      })
    })

    it('never retries createRecord and deletes the orphan when the record cannot be recorded', async () => {
      const status = await claim(await createNote({ text: 'Unrecorded' }))
      answerCreate('3kunrecorded')
      post.mockResolvedValueOnce({}) // deleteRecord
      const spy = vi
        .spyOn(database, 'markBlueskyCrosspostPosted')
        .mockRejectedValue(new Error('db write failed'))
      try {
        await crosspostStatus(database, status.id)
      } finally {
        spy.mockRestore()
      }

      expect(
        post.mock.calls.filter(
          ([nsid]) => nsid === 'com.atproto.repo.createRecord'
        )
      ).toHaveLength(1)
      expect(post).toHaveBeenCalledWith('com.atproto.repo.deleteRecord', {
        repo: OWN_DID,
        collection: 'app.bsky.feed.post',
        rkey: '3kunrecorded'
      })
      await expect(
        database.getBlueskyCrosspost({ statusId: status.id })
      ).resolves.toMatchObject({
        state: 'failed',
        error: BLUESKY_CROSSPOST_UNEXPECTED_MESSAGE
      })
    })

    it('skips deleting the record after markBlueskyCrosspostPosted throws when another row already owns that uri', async () => {
      const existing = await claim(await createNote({ text: 'Existing owner' }))
      const existingAttempt = await database.beginBlueskyCrosspostAttempt({
        statusId: existing.id
      })
      await database.markBlueskyCrosspostPosted({
        statusId: existing.id,
        attemptId: existingAttempt!,
        uri: postUri('3kowned'),
        cid: cid('e')
      })

      const status = await claim(await createNote({ text: 'Colliding uri' }))
      // Simulate a hostile/buggy PDS returning the existing post's URI, which
      // causes the unique-uri constraint in markBlueskyCrosspostPosted to throw.
      answerCreate('3kowned')

      await crosspostStatus(database, status.id)

      expect(
        post.mock.calls.filter(
          ([nsid]) => nsid === 'com.atproto.repo.deleteRecord'
        )
      ).toHaveLength(0)
      await expect(
        database.getBlueskyCrosspost({ statusId: status.id })
      ).resolves.toMatchObject({
        state: 'failed',
        error: BLUESKY_CROSSPOST_UNEXPECTED_MESSAGE
      })
      await expect(
        database.getBlueskyCrosspost({ statusId: existing.id })
      ).resolves.toMatchObject({
        state: 'posted',
        uri: postUri('3kowned')
      })
    })

    it('drops the row when the post stops being crosspostable before the lock runs', async () => {
      const status = await claim(await createNote({ text: 'Changed' }))
      const getStatus = database.getStatus.bind(database)
      let calls = 0
      const spy = vi
        .spyOn(database, 'getStatus')
        .mockImplementation(async (params) => {
          const found = await getStatus(params)
          calls += 1
          return calls === 1 || !found
            ? found
            : { ...found, to: [`${actor.id}/followers`] }
        })
      try {
        await crosspostStatus(database, status.id)
      } finally {
        spy.mockRestore()
      }

      await expect(
        database.getBlueskyCrosspost({ statusId: status.id })
      ).resolves.toBeNull()
      expect(post).not.toHaveBeenCalled()
    })

    it('drops the row when the actor can no longer act', async () => {
      const status = await claim(await createNote({ text: 'Suspended' }))
      const getActor = database.getActorFromId.bind(database)
      let calls = 0
      const spy = vi
        .spyOn(database, 'getActorFromId')
        .mockImplementation(async (params) => {
          const found = await getActor(params)
          calls += 1
          return calls === 1 || !found
            ? found
            : { ...found, suspendedAt: Date.now() }
        })
      try {
        await crosspostStatus(database, status.id)
      } finally {
        spy.mockRestore()
      }

      await expect(
        database.getBlueskyCrosspost({ statusId: status.id })
      ).resolves.toBeNull()
      expect(post).not.toHaveBeenCalled()
    })

    it('marks a post failed when an image is not a format Bluesky accepts', async () => {
      const status = await createNote({ text: 'SVG' })
      await createImageAttachment({ status, index: 0 })
      await claim(status)
      vi.mocked(readStoredImage).mockResolvedValue({
        buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
        mimeType: 'image/svg+xml'
      } as Awaited<ReturnType<typeof readStoredImage>>)

      await crosspostStatus(database, status.id)

      await expect(
        database.getBlueskyCrosspost({ statusId: status.id })
      ).resolves.toMatchObject({
        state: 'failed',
        error: BLUESKY_CROSSPOST_IMAGE_FORMAT_MESSAGE
      })
      expect(post).not.toHaveBeenCalled()
    })

    it('posts a failed status again once it is reset for a retry', async () => {
      const status = await claim(await createNote({ text: 'Retry me' }))
      post.mockRejectedValueOnce(
        new BlueskyRequestError(
          'com.atproto.repo.createRecord',
          400,
          'InvalidRequest'
        )
      )

      await crosspostStatus(database, status.id)
      await expect(
        database.getBlueskyCrosspost({ statusId: status.id })
      ).resolves.toMatchObject({
        state: 'failed',
        error: BLUESKY_CROSSPOST_FAILED_MESSAGE
      })

      await database.resetBlueskyCrosspostForRetry({ statusId: status.id })
      answerCreate('3kretry')
      await crosspostStatus(database, status.id)

      await expect(
        database.getBlueskyCrosspost({ statusId: status.id })
      ).resolves.toMatchObject({ state: 'posted', uri: postUri('3kretry') })
      expect(post).toHaveBeenCalledTimes(2)
    })

    it('rethrows a passing failure, releases back to pending with a fresh updatedAt, and marks it failed on an inline queue', async () => {
      const status = await claim(await createNote({ text: 'Busy' }))
      const oldUpdatedAt = Date.now() - 25 * 60 * 1000
      await testDb.db
        .updateTable('bluesky_crossposts')
        .set({ updatedAt: new Date(oldUpdatedAt) })
        .where('statusId', '=', status.id)
        .execute()

      const unavailable = new BlueskyRequestError(
        'com.atproto.repo.createRecord',
        503
      )
      post.mockRejectedValueOnce(unavailable)

      await expect(crosspostStatus(database, status.id)).rejects.toBe(
        unavailable
      )
      const released = await database.getBlueskyCrosspost({
        statusId: status.id
      })
      expect(released).toMatchObject({ state: 'pending' })
      expect(released!.updatedAt).toBeGreaterThan(oldUpdatedAt)

      // Next queue attempt can begin and succeed.
      answerCreate('3kbusy-ok')
      await crosspostStatus(database, status.id)
      await expect(
        database.getBlueskyCrosspost({ statusId: status.id })
      ).resolves.toMatchObject({ state: 'posted', uri: postUri('3kbusy-ok') })

      // Inline queue marks transient failures failed immediately.
      const inlineStatus = await claim(await createNote({ text: 'Inline' }))
      queue.runsInline = true
      post.mockRejectedValueOnce(unavailable)
      await crosspostStatus(database, inlineStatus.id)
      await expect(
        database.getBlueskyCrosspost({ statusId: inlineStatus.id })
      ).resolves.toMatchObject({ state: 'failed' })
    })

    it('passes a valid, stable TID rkey to createRecord for a status', async () => {
      const status = await claim(await createNote({ text: 'Deterministic' }))
      post.mockRejectedValueOnce(
        new BlueskyRequestError('com.atproto.repo.createRecord', 502)
      )

      await expect(crosspostStatus(database, status.id)).rejects.toThrow()
      const firstRkey = createCall(0)?.rkey

      expect(typeof firstRkey).toBe('string')
      // 13 chars, base32-sortable alphabet, top bit 0 -> first char in [234567ab].
      expect(firstRkey).toMatch(
        /^[234567ab][234567abcdefghijklmnopqrstuvwxyz]{12}$/
      )

      post.mockResolvedValueOnce({ uri: postUri(firstRkey), cid: cid('d') })
      await crosspostStatus(database, status.id)

      expect(createCall(1)?.rkey).toBe(firstRkey)
    })

    it.each([
      {
        name: 'RecordAlreadyExists',
        duplicateError: new BlueskyRequestError(
          'com.atproto.repo.createRecord',
          400,
          'RecordAlreadyExists'
        )
      },
      {
        name: 'InvalidSwap',
        duplicateError: new BlueskyRequestError(
          'com.atproto.repo.createRecord',
          400,
          'InvalidSwap',
          'Record already exists'
        )
      },
      {
        name: 'InvalidRequest with already-exists message',
        duplicateError: new BlueskyRequestError(
          'com.atproto.repo.createRecord',
          400,
          'InvalidRequest',
          'There is already a value at key: app.bsky.feed.post/3k'
        )
      }
    ])(
      'adopts the existing record via getRecord on retry after a lost answer ($name)',
      async ({ duplicateError }) => {
        const status = await claim(
          await createNote({ text: 'Lost answer recovery' })
        )
        const storedRecords = new Map<string, { uri: string; cid: string }>()

        // Simulate a PDS that commits the record on attempt 1, then drops the
        // HTTP response (502), and rejects attempt 2 with the duplicate error.
        post.mockImplementationOnce(async (_nsid, body) => {
          const rkey = body.rkey as string
          storedRecords.set(rkey, { uri: postUri(rkey), cid: cid('r') })
          throw new BlueskyRequestError('com.atproto.repo.createRecord', 502)
        })
        post.mockImplementationOnce(async (_nsid, body) => {
          const rkey = body.rkey as string
          if (storedRecords.has(rkey)) throw duplicateError
          const created = { uri: postUri(rkey), cid: cid('z') }
          storedRecords.set(rkey, created)
          return created
        })
        get.mockImplementationOnce(async (nsid, params) => {
          expect(nsid).toBe('com.atproto.repo.getRecord')
          const found = storedRecords.get(params.rkey)
          if (!found) {
            throw new BlueskyRequestError(
              'com.atproto.repo.getRecord',
              400,
              'RecordNotFound'
            )
          }
          return { ...found, value: { $type: 'app.bsky.feed.post' } }
        })

        // Attempt 1: PDS committed the record, response lost -> retryable.
        await expect(crosspostStatus(database, status.id)).rejects.toThrow()
        const rkey = createCall(0)?.rkey as string
        expect(rkey).toMatch(
          /^[234567ab][234567abcdefghijklmnopqrstuvwxyz]{12}$/
        )

        // Attempt 2: createRecord reuses the same rkey, gets duplicate error,
        // getRecord recovers the existing record and marks the row posted.
        await crosspostStatus(database, status.id)

        expect(createCall(1)?.rkey).toBe(rkey)
        expect(storedRecords.size).toBe(1)
        expect(get).toHaveBeenCalledWith('com.atproto.repo.getRecord', {
          repo: OWN_DID,
          collection: 'app.bsky.feed.post',
          rkey
        })
        await expect(
          database.getBlueskyCrosspost({ statusId: status.id })
        ).resolves.toMatchObject({
          state: 'posted',
          uri: postUri(rkey),
          cid: cid('r'),
          error: null
        })
      }
    )

    it('deletes a recovered record when the row was removed while retrying', async () => {
      const status = await claim(
        await createNote({ text: 'Removed during recovery' })
      )
      post.mockRejectedValueOnce(
        new BlueskyRequestError(
          'com.atproto.repo.createRecord',
          400,
          'InvalidSwap'
        )
      )
      get.mockImplementationOnce(async (_nsid, params) => ({
        uri: postUri(params.rkey),
        cid: cid('m'),
        value: { $type: 'app.bsky.feed.post' }
      }))
      post.mockResolvedValueOnce({}) // deleteRecord

      const spy = vi
        .spyOn(database, 'markBlueskyCrosspostPosted')
        .mockResolvedValue(false)
      try {
        await crosspostStatus(database, status.id)
      } finally {
        spy.mockRestore()
      }

      const rkey = createCall(0)?.rkey as string
      expect(post).toHaveBeenCalledWith('com.atproto.repo.deleteRecord', {
        repo: OWN_DID,
        collection: 'app.bsky.feed.post',
        rkey
      })
    })

    it('marks failed when createRecord reports duplicate but getRecord returns RecordNotFound', async () => {
      const status = await claim(
        await createNote({ text: 'Missing on getRecord' })
      )
      post.mockRejectedValueOnce(
        new BlueskyRequestError(
          'com.atproto.repo.createRecord',
          400,
          'InvalidSwap'
        )
      )
      get.mockRejectedValueOnce(
        new BlueskyRequestError(
          'com.atproto.repo.getRecord',
          400,
          'RecordNotFound'
        )
      )

      await crosspostStatus(database, status.id)

      expect(get).toHaveBeenCalledWith('com.atproto.repo.getRecord', {
        repo: OWN_DID,
        collection: 'app.bsky.feed.post',
        rkey: deterministicTid(status.createdAt, status.id)
      })
      await expect(
        database.getBlueskyCrosspost({ statusId: status.id })
      ).resolves.toMatchObject({
        state: 'failed',
        error: BLUESKY_CROSSPOST_FAILED_MESSAGE
      })
    })

    it.each([
      {
        name: 'an ended session',
        error: new BlueskySessionEndedError(),
        message: BLUESKY_CROSSPOST_SESSION_ENDED_MESSAGE
      },
      {
        name: 'an unexpected createRecord answer',
        answer: { uri: 'not-a-uri', cid: 'x' },
        message: BLUESKY_CROSSPOST_UNEXPECTED_MESSAGE
      },
      {
        name: 'an oversized createRecord answer',
        // A valid rkey (500 chars) makes a uri over the 512-char cap.
        answer: {
          uri: `at://${OWN_DID}/app.bsky.feed.post/${'a'.repeat(500)}`,
          cid: cid('c')
        },
        message: BLUESKY_CROSSPOST_UNEXPECTED_MESSAGE
      }
    ])('marks $name failed', async ({ error, answer, message }) => {
      const status = await claim(await createNote({ text: 'Fails' }))
      if (error) post.mockRejectedValueOnce(error)
      else post.mockResolvedValueOnce(answer)

      await crosspostStatus(database, status.id)

      await expect(
        database.getBlueskyCrosspost({ statusId: status.id })
      ).resolves.toMatchObject({ state: 'failed', error: message })
    })

    it('marks it failed when the account is unlinked or the server refuses Bluesky', async () => {
      const status = await claim(await createNote({ text: 'Gated' }))
      vi.mocked(isBlueskyAllowed).mockResolvedValue(false)
      await crosspostStatus(database, status.id)
      await expect(
        database.getBlueskyCrosspost({ statusId: status.id })
      ).resolves.toMatchObject({
        state: 'failed',
        error: BLUESKY_NOT_ALLOWED_MESSAGE
      })

      const other = await claim(
        await createNote({ text: 'Unlinked', by: unlinked })
      )
      await crosspostStatus(database, other.id)
      await expect(
        database.getBlueskyCrosspost({ statusId: other.id })
      ).resolves.toMatchObject({
        state: 'failed',
        error: BLUESKY_CROSSPOST_NOT_LINKED_MESSAGE
      })
      expect(post).not.toHaveBeenCalled()
    })

    it('drops the row of a post that is no longer public', async () => {
      const status = await claim(
        await createNote({ text: 'Followers', to: [`${actor.id}/followers`] })
      )

      await crosspostStatus(database, status.id)

      await expect(
        database.getBlueskyCrosspost({ statusId: status.id })
      ).resolves.toBeNull()
      expect(post).not.toHaveBeenCalled()
    })

    it('fences an old attempt after a stale takeover: old markPosted deletes its copy and old release/markFailed leave the new owner untouched', async () => {
      // Case 1: old attempt's createRecord finishes after a new attempt took over.
      const status1 = await claim(await createNote({ text: 'Takeover posted' }))
      let resolveOldCreate!: (value: { uri: string; cid: string }) => void
      let oldEntered!: () => void
      const entered1 = new Promise<void>((resolve) => {
        oldEntered = resolve
      })
      post.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOldCreate = resolve
            oldEntered()
          })
      )
      const oldRun1 = crosspostStatus(database, status1.id)
      await entered1

      // Expire the per-actor lock and make the posting row stale so a new attempt takes over.
      await testDb.db
        .updateTable('fitness_import_locks')
        .set({ expiresAt: Date.now() - 1_000 })
        .execute()
      await testDb.db
        .updateTable('bluesky_crossposts')
        .set({ updatedAt: new Date(Date.now() - 31 * 60 * 1000) })
        .where('statusId', '=', status1.id)
        .execute()

      const takeoverToken1 = await database.beginBlueskyCrosspostAttempt({
        statusId: status1.id
      })
      expect(takeoverToken1).toEqual(expect.any(String))

      // Old attempt finishes createRecord: markPosted returns false, deletes its
      // duplicate record, and leaves the new owner's posting row untouched.
      post.mockResolvedValueOnce({}) // deleteRecord
      resolveOldCreate({ uri: postUri('3koldcopy'), cid: cid('o') })
      await oldRun1

      expect(post).toHaveBeenCalledWith('com.atproto.repo.deleteRecord', {
        repo: OWN_DID,
        collection: 'app.bsky.feed.post',
        rkey: '3koldcopy'
      })
      await expect(
        database.getBlueskyCrosspost({ statusId: status1.id })
      ).resolves.toMatchObject({ state: 'posting', uri: null, error: null })
      const dbRow1 = await testDb.db
        .selectFrom('bluesky_crossposts')
        .select('attemptId')
        .where('statusId', '=', status1.id)
        .executeTakeFirst()
      expect(dbRow1?.attemptId).toBe(takeoverToken1)

      // Case 2: old attempt hits a transient error (503) after takeover -> release does nothing.
      const status2 = await claim(await createNote({ text: 'Takeover retry' }))
      let rejectOldTransient!: (error: unknown) => void
      let oldEntered2!: () => void
      const entered2 = new Promise<void>((resolve) => {
        oldEntered2 = resolve
      })
      post.mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectOldTransient = reject
            oldEntered2()
          })
      )
      const oldRun2 = crosspostStatus(database, status2.id)
      await entered2

      await testDb.db
        .updateTable('bluesky_crossposts')
        .set({ updatedAt: new Date(Date.now() - 31 * 60 * 1000) })
        .where('statusId', '=', status2.id)
        .execute()
      const takeoverToken2 = await database.beginBlueskyCrosspostAttempt({
        statusId: status2.id
      })
      expect(takeoverToken2).toEqual(expect.any(String))

      const transientError = new BlueskyRequestError(
        'com.atproto.repo.createRecord',
        503
      )
      rejectOldTransient(transientError)
      await expect(oldRun2).rejects.toBe(transientError)

      await expect(
        database.getBlueskyCrosspost({ statusId: status2.id })
      ).resolves.toMatchObject({ state: 'posting', error: null })
      const dbRow2 = await testDb.db
        .selectFrom('bluesky_crossposts')
        .select('attemptId')
        .where('statusId', '=', status2.id)
        .executeTakeFirst()
      expect(dbRow2?.attemptId).toBe(takeoverToken2)

      // Case 3: old attempt hits a permanent error (400) after takeover -> markFailed does nothing.
      const status3 = await claim(await createNote({ text: 'Takeover fail' }))
      let rejectOldPermanent!: (error: unknown) => void
      let oldEntered3!: () => void
      const entered3 = new Promise<void>((resolve) => {
        oldEntered3 = resolve
      })
      post.mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectOldPermanent = reject
            oldEntered3()
          })
      )
      const oldRun3 = crosspostStatus(database, status3.id)
      await entered3

      await testDb.db
        .updateTable('bluesky_crossposts')
        .set({ updatedAt: new Date(Date.now() - 31 * 60 * 1000) })
        .where('statusId', '=', status3.id)
        .execute()
      const takeoverToken3 = await database.beginBlueskyCrosspostAttempt({
        statusId: status3.id
      })
      expect(takeoverToken3).toEqual(expect.any(String))

      rejectOldPermanent(
        new BlueskyRequestError(
          'com.atproto.repo.createRecord',
          400,
          'InvalidRequest'
        )
      )
      await oldRun3

      await expect(
        database.getBlueskyCrosspost({ statusId: status3.id })
      ).resolves.toMatchObject({ state: 'posting', error: null })
      const dbRow3 = await testDb.db
        .selectFrom('bluesky_crossposts')
        .select('attemptId')
        .where('statusId', '=', status3.id)
        .executeTakeFirst()
      expect(dbRow3?.attemptId).toBe(takeoverToken3)
    })

    it('leaves a posting row untouched when a non-owner failure occurs before an attempt begins', async () => {
      // Pre-lock failure: row transitions to 'posting' before isBlueskyAllowed returns false.
      const status = await claim(await createNote({ text: 'Pre-lock race' }))
      vi.mocked(isBlueskyAllowed).mockImplementationOnce(async () => {
        await database.beginBlueskyCrosspostAttempt({ statusId: status.id })
        return false
      })

      await crosspostStatus(database, status.id)

      await expect(
        database.getBlueskyCrosspost({ statusId: status.id })
      ).resolves.toMatchObject({ state: 'posting', error: null })

      // Inside-lock pre-attempt failure (getBlueskyAgent throws) when row is already 'posting'.
      const status2 = await claim(await createNote({ text: 'Agent race' }))
      const originalGet = database.getBlueskyCrosspost.bind(database)
      const initialRow = await originalGet({ statusId: status2.id })
      const getSpy = vi
        .spyOn(database, 'getBlueskyCrosspost')
        .mockImplementation(async (params) =>
          params.statusId === status2.id && initialRow
            ? { ...initialRow, state: 'pending' }
            : originalGet(params)
        )
      vi.mocked(getBlueskyAgent).mockImplementationOnce(async () => {
        await database.beginBlueskyCrosspostAttempt({ statusId: status2.id })
        throw new BlueskySessionEndedError()
      })
      try {
        await crosspostStatus(database, status2.id)
      } finally {
        getSpy.mockRestore()
      }

      await expect(
        database.getBlueskyCrosspost({ statusId: status2.id })
      ).resolves.toMatchObject({ state: 'posting', error: null })
    })

    it('cleans up or fails a stale posting row on pre-attempt exits and pre-attempt catch', async () => {
      const makeStalePosting = async (statusId: string) => {
        await database.beginBlueskyCrosspostAttempt({ statusId })
        await testDb.db
          .updateTable('bluesky_crossposts')
          .set({ updatedAt: new Date(Date.now() - 31 * 60 * 1000) })
          .where('statusId', '=', statusId)
          .execute()
      }

      // Pre-attempt non-crosspostable exit deletes the stale posting row.
      const nonPublic = await claim(
        await createNote({
          text: 'Stale followers only',
          to: [`${actor.id}/followers`]
        })
      )
      await makeStalePosting(nonPublic.id)
      await crosspostStatus(database, nonPublic.id)
      await expect(
        database.getBlueskyCrosspost({ statusId: nonPublic.id })
      ).resolves.toBeNull()

      // Pre-attempt policy refusal marks the stale posting row failed and clears attemptId.
      const disallowed = await claim(
        await createNote({ text: 'Stale disallowed' })
      )
      await makeStalePosting(disallowed.id)
      vi.mocked(isBlueskyAllowed).mockResolvedValueOnce(false)
      await crosspostStatus(database, disallowed.id)
      await expect(
        database.getBlueskyCrosspost({ statusId: disallowed.id })
      ).resolves.toMatchObject({
        state: 'failed',
        error: BLUESKY_NOT_ALLOWED_MESSAGE
      })
      const disallowedRow = await testDb.db
        .selectFrom('bluesky_crossposts')
        .select('attemptId')
        .where('statusId', '=', disallowed.id)
        .executeTakeFirst()
      expect(disallowedRow?.attemptId).toBeNull()

      // Pre-attempt catch (getBlueskyAgent throws before beginAttempt) marks the stale posting row failed.
      const sessionEnded = await claim(
        await createNote({ text: 'Stale session ended' })
      )
      await makeStalePosting(sessionEnded.id)
      vi.mocked(getBlueskyAgent).mockRejectedValueOnce(
        new BlueskySessionEndedError()
      )
      await crosspostStatus(database, sessionEnded.id)
      await expect(
        database.getBlueskyCrosspost({ statusId: sessionEnded.id })
      ).resolves.toMatchObject({
        state: 'failed',
        error: BLUESKY_CROSSPOST_SESSION_ENDED_MESSAGE
      })
      const sessionEndedRow = await testDb.db
        .selectFrom('bluesky_crossposts')
        .select('attemptId')
        .where('statusId', '=', sessionEnded.id)
        .executeTakeFirst()
      expect(sessionEndedRow?.attemptId).toBeNull()
    })

    it('leaves a posted row intact when not-crosspostable cleanup runs after a race (outside or inside lock)', async () => {
      // Outside the lock: initial read sees 'pending', then row becomes 'posted'
      // before getStatus returns a non-public status.
      const statusOut = await claim(
        await createNote({
          text: 'Outside lock race',
          to: [`${actor.id}/followers`]
        })
      )
      const originalGetStatus = database.getStatus.bind(database)
      const outSpy = vi
        .spyOn(database, 'getStatus')
        .mockImplementationOnce(async (params) => {
          const token = await database.beginBlueskyCrosspostAttempt({
            statusId: statusOut.id
          })
          await database.markBlueskyCrosspostPosted({
            statusId: statusOut.id,
            attemptId: token!,
            uri: postUri('3koutposted'),
            cid: cid('u')
          })
          return originalGetStatus(params)
        })
      try {
        await crosspostStatus(database, statusOut.id)
      } finally {
        outSpy.mockRestore()
      }

      await expect(
        database.getBlueskyCrosspost({ statusId: statusOut.id })
      ).resolves.toMatchObject({
        state: 'posted',
        uri: postUri('3koutposted')
      })

      // Inside the lock: row becomes 'posted' after the lock's getBlueskyCrosspost
      // read, right before the not-crosspostable cleanup executes.
      const statusIn = await claim(
        await createNote({ text: 'Inside lock race' })
      )
      let getStatusCalls = 0
      const inSpy = vi
        .spyOn(database, 'getStatus')
        .mockImplementation(async (params) => {
          const found = await originalGetStatus(params)
          getStatusCalls += 1
          if (getStatusCalls === 2 && found) {
            const token = await database.beginBlueskyCrosspostAttempt({
              statusId: statusIn.id
            })
            await database.markBlueskyCrosspostPosted({
              statusId: statusIn.id,
              attemptId: token!,
              uri: postUri('3kinposted'),
              cid: cid('i')
            })
            return { ...found, to: [`${actor.id}/followers`] }
          }
          return found
        })
      try {
        await crosspostStatus(database, statusIn.id)
      } finally {
        inSpy.mockRestore()
      }

      await expect(
        database.getBlueskyCrosspost({ statusId: statusIn.id })
      ).resolves.toMatchObject({
        state: 'posted',
        uri: postUri('3kinposted')
      })
    })
  })

  describe('enqueueBlueskyCrosspost', () => {
    const rowOf = (status: Status) =>
      database.getBlueskyCrosspost({ statusId: status.id })

    it("claims a public post and queues its job when the account's default is on", async () => {
      const status = await createNote({ text: 'Default' })

      await enqueueBlueskyCrosspost(database, { actor, status })

      await expect(rowOf(status)).resolves.toMatchObject({ state: 'pending' })
      expect(queue.publish).toHaveBeenCalledWith({
        id: getHashFromString(`${status.id}#bluesky-crosspost`),
        name: CROSSPOST_BLUESKY_JOB_NAME,
        data: { statusId: status.id }
      })
    })

    it('queues one job when the same status is enqueued twice', async () => {
      const status = await createNote({ text: 'Enqueued twice' })

      await enqueueBlueskyCrosspost(database, { actor, status })
      await enqueueBlueskyCrosspost(database, { actor, status })

      // The second claim finds the pending row and publishes nothing.
      expect(queue.publish).toHaveBeenCalledTimes(1)
      await expect(rowOf(status)).resolves.toMatchObject({ state: 'pending' })
    })

    it('follows the per-post switch over the default', async () => {
      const off = await createNote({ text: 'Switch off' })
      await enqueueBlueskyCrosspost(database, {
        actor,
        status: off,
        wanted: false
      })
      await expect(rowOf(off)).resolves.toBeNull()

      await database.updateBlueskyCrosspostDefault({
        actorId: actor.id,
        crosspostByDefault: false
      })
      try {
        const byDefault = await createNote({ text: 'Default off' })
        await enqueueBlueskyCrosspost(database, { actor, status: byDefault })
        await expect(rowOf(byDefault)).resolves.toBeNull()

        const on = await createNote({ text: 'Switch on' })
        await enqueueBlueskyCrosspost(database, {
          actor,
          status: on,
          wanted: true
        })
        await expect(rowOf(on)).resolves.toMatchObject({ state: 'pending' })
      } finally {
        await database.updateBlueskyCrosspostDefault({
          actorId: actor.id,
          crosspostByDefault: true
        })
      }
    })

    it('skips a post that is not public, an unlinked author, and a server that refuses Bluesky', async () => {
      const unlisted = await createNote({
        text: 'Unlisted',
        to: [`${actor.id}/followers`]
      })
      await enqueueBlueskyCrosspost(database, { actor, status: unlisted })

      const other = await createNote({ text: 'Not linked', by: unlinked })
      await enqueueBlueskyCrosspost(database, {
        actor: unlinked,
        status: other,
        wanted: true
      })

      vi.mocked(isBlueskyAllowed).mockResolvedValue(false)
      const refused = await createNote({ text: 'Refused' })
      await enqueueBlueskyCrosspost(database, { actor, status: refused })

      await expect(rowOf(unlisted)).resolves.toBeNull()
      await expect(rowOf(other)).resolves.toBeNull()
      await expect(rowOf(refused)).resolves.toBeNull()
      expect(queue.publish).not.toHaveBeenCalled()
    })

    it('marks the row failed when the job cannot be queued', async () => {
      const status = await createNote({ text: 'No queue' })
      queue.publish.mockRejectedValueOnce(new Error('queue down'))

      await enqueueBlueskyCrosspost(database, { actor, status })

      await expect(rowOf(status)).resolves.toMatchObject({
        state: 'failed',
        error: BLUESKY_CROSSPOST_QUEUE_FAILED_MESSAGE
      })
    })

    it('leaves a posting row untouched when queue publish throws after a worker already began it', async () => {
      const status = await createNote({ text: 'Queue timeout after delivery' })
      queue.publish.mockImplementationOnce(async () => {
        await database.beginBlueskyCrosspostAttempt({ statusId: status.id })
        throw new Error('queue publish timed out')
      })

      await enqueueBlueskyCrosspost(database, { actor, status })

      await expect(rowOf(status)).resolves.toMatchObject({
        state: 'posting',
        error: null
      })
    })

    it('skips a post whose actor can no longer act', async () => {
      const status = await createNote({ text: 'Suspended' })
      await enqueueBlueskyCrosspost(database, {
        actor: { ...actor, suspendedAt: Date.now() },
        status
      })

      await expect(rowOf(status)).resolves.toBeNull()
      expect(queue.publish).not.toHaveBeenCalled()
    })

    it("queues a reply only under the author's own cross-posted post (including while posting)", async () => {
      const parent = await createNote({ text: 'Mine' })
      await enqueueBlueskyCrosspost(database, { actor, status: parent })
      const ownReply = await createNote({ text: 'Reply', reply: parent.id })
      await enqueueBlueskyCrosspost(database, { actor, status: ownReply })
      await expect(rowOf(ownReply)).resolves.toMatchObject({
        state: 'pending'
      })

      // Also while the parent is actively in the 'posting' state.
      await database.beginBlueskyCrosspostAttempt({ statusId: parent.id })
      const replyWhilePosting = await createNote({
        text: 'Reply while posting',
        reply: parent.id
      })
      await enqueueBlueskyCrosspost(database, {
        actor,
        status: replyWhilePosting
      })
      await expect(rowOf(replyWhilePosting)).resolves.toMatchObject({
        state: 'pending'
      })

      // Even when their post has a cross-post row of its own.
      const someoneElse = await claim(
        await createNote({ text: 'Theirs', by: unlinked })
      )
      const replyToOther = await createNote({
        text: 'Reply to them',
        reply: someoneElse.id
      })
      await enqueueBlueskyCrosspost(database, { actor, status: replyToOther })
      await expect(rowOf(replyToOther)).resolves.toBeNull()
    })
  })
})
