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
import { readStoredImage } from '@/lib/services/medias/readStoredMedia'
import { getQueue } from '@/lib/services/queue'
import { TEST_DOMAIN, TEST_PASSWORD_HASH } from '@/lib/stub/const'
import type { Actor } from '@/lib/types/domain/actor'
import type { Status, StatusNote } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { safeImageFetch } from '@/lib/utils/safeImageDownload'

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

  const createdRecord = (call = 0) =>
    post.mock.calls.filter(
      ([nsid]) => nsid === 'com.atproto.repo.createRecord'
    )[call]?.[1].record

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
    vi.mocked(getQueue).mockClear()
    queue.publish.mockReset().mockResolvedValue(undefined)
    queue.runsInline = false
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
        get: vi.fn(),
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

    it("replies in the thread of the author's own cross-posted post", async () => {
      const parent = await claim(await createNote({ text: 'Thread start' }))
      await database.markBlueskyCrosspostPosted({
        statusId: parent.id,
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
            text: 'Thread start',
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
        await createNote({ text: 'Second part', reply: parent.id })
      )
      answerCreate('3kreply')

      await crosspostStatus(database, reply.id)

      expect(createdRecord().reply).toEqual({
        root: { uri: postUri('3kroot'), cid: cid('r') },
        parent: { uri: postUri('3kparent'), cid: cid('p') }
      })
    })

    it('waits for a parent still being posted, and drops a reply whose parent failed', async () => {
      const parent = await claim(await createNote({ text: 'Parent' }))
      const reply = await claim(
        await createNote({ text: 'Child', reply: parent.id })
      )

      await expect(crosspostStatus(database, reply.id)).rejects.toThrow()
      await expect(
        database.getBlueskyCrosspost({ statusId: reply.id })
      ).resolves.toMatchObject({ state: 'pending' })

      await database.markBlueskyCrosspostFailed({
        statusId: parent.id,
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

    it('never retries createRecord when the record cannot be recorded', async () => {
      const status = await claim(await createNote({ text: 'Unrecorded' }))
      answerCreate('3kunrecorded')
      const spy = vi
        .spyOn(database, 'markBlueskyCrosspostPosted')
        .mockRejectedValue(new Error('unique constraint'))
      try {
        await crosspostStatus(database, status.id)
      } finally {
        spy.mockRestore()
      }

      expect(post).toHaveBeenCalledTimes(1)
      await expect(
        database.getBlueskyCrosspost({ statusId: status.id })
      ).resolves.toMatchObject({
        state: 'failed',
        error: BLUESKY_CROSSPOST_UNEXPECTED_MESSAGE
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

    it('rethrows a passing failure for the queue to retry, but marks it failed on an inline queue', async () => {
      const status = await claim(await createNote({ text: 'Busy' }))
      const unavailable = new BlueskyRequestError(
        'com.atproto.repo.createRecord',
        503
      )
      post.mockRejectedValueOnce(unavailable)

      await expect(crosspostStatus(database, status.id)).rejects.toBe(
        unavailable
      )
      await expect(
        database.getBlueskyCrosspost({ statusId: status.id })
      ).resolves.toMatchObject({ state: 'pending' })

      queue.runsInline = true
      post.mockRejectedValueOnce(unavailable)
      await crosspostStatus(database, status.id)
      await expect(
        database.getBlueskyCrosspost({ statusId: status.id })
      ).resolves.toMatchObject({ state: 'failed' })
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

    it('skips a post whose actor can no longer act', async () => {
      const status = await createNote({ text: 'Suspended' })
      await enqueueBlueskyCrosspost(database, {
        actor: { ...actor, suspendedAt: Date.now() },
        status
      })

      await expect(rowOf(status)).resolves.toBeNull()
      expect(queue.publish).not.toHaveBeenCalled()
    })

    it("queues a reply only under the author's own cross-posted post", async () => {
      const parent = await createNote({ text: 'Mine' })
      await enqueueBlueskyCrosspost(database, { actor, status: parent })
      const ownReply = await createNote({ text: 'Reply', reply: parent.id })
      await enqueueBlueskyCrosspost(database, { actor, status: ownReply })
      await expect(rowOf(ownReply)).resolves.toMatchObject({
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
