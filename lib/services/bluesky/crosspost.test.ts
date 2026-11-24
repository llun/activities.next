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
  BLUESKY_CROSSPOST_NOT_LINKED_MESSAGE,
  BLUESKY_CROSSPOST_SESSION_ENDED_MESSAGE,
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
        await database.createAttachment({
          actorId: actor.id,
          statusId: status.id,
          mediaType: 'image/png',
          url: `https://media.test/files/photo-${index}.png`,
          width: 4,
          height: 2,
          name: `alt ${index}`,
          createdAt: Date.now() + index
        })
      }
      await claim(status)
      vi.mocked(readStoredImage).mockResolvedValue({
        buffer: png,
        mimeType: 'image/png'
      } as Awaited<ReturnType<typeof readStoredImage>>)
      answerCreate('3kimages')

      await crosspostStatus(database, status.id)

      expect(uploadBlob).toHaveBeenCalledTimes(4)
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

    it('quotes a Bluesky post as a record and a fediverse post as its link', async () => {
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

      expect(createdRecord(0).embed).toEqual({
        $type: 'app.bsky.embed.record',
        record: { uri: postUri('3kquoted', OTHER_DID), cid: cid('q') }
      })

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
      vi.mocked(safeImageFetch).mockResolvedValue(
        new Response(new Uint8Array(png), {
          headers: { 'content-type': 'image/png' }
        })
      )
      answerCreate('3kcard')

      try {
        await crosspostStatus(database, status.id)
      } finally {
        spy.mockRestore()
      }

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
        message: BLUESKY_CROSSPOST_FAILED_MESSAGE
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
