import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { QUOTE_ACTIVITY_CONTEXT } from '@/lib/activities/quoteContext'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { createNoteJob } from '@/lib/jobs/createNoteJob'
import { CREATE_NOTE_JOB_NAME } from '@/lib/jobs/names'
import {
  buildQuoteAuthorizationObject,
  buildQuoteAuthorizationUri
} from '@/lib/services/quotes/quoteAuthorization'
import { mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { MockImageDocument } from '@/lib/stub/imageDocument'
import { MockLitepubNote, MockMastodonActivityPubNote } from '@/lib/stub/note'
import { MockActivityPubPerson } from '@/lib/stub/person'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { Actor } from '@/lib/types/domain/actor'
import { Status, StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

enableFetchMocks()

// Actor id for testing pulling actor information when create status
const FRIEND_ACTOR_ID = 'https://somewhere.test/actors/friend'

describe('createNoteJob', () => {
  const database = getTestSQLDatabase()
  let actor1: Actor | undefined

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    actor1 = await database.getActorFromUsername({
      username: seedActor1.username,
      domain: seedActor1.domain
    })
  })

  afterAll(async () => {
    if (!database) return
    await database.destroy()
  })

  beforeEach(() => {
    fetchMock.resetMocks()
    mockRequests(fetchMock)
  })

  it('adds note into database and returns note', async () => {
    const note = MockMastodonActivityPubNote({ content: '<p>Hello</p>' })
    await createNoteJob(database, {
      id: 'id',
      name: CREATE_NOTE_JOB_NAME,
      data: note
    })

    const status = (await database.getStatus({ statusId: note.id })) as Status
    if (status.type !== StatusType.enum.Note) {
      fail('Stauts type must be note')
    }
    expect(status).toBeDefined()
    expect(status.id).toEqual(note.id)
    expect(status.text).toEqual('<p>Hello</p>')
    expect(status.actorId).toEqual(note.attributedTo)
    expect(status.to).toEqual(note.to)
    expect(status.cc).toEqual(note.cc)
    expect(status.type).toEqual(StatusType.enum.Note)
    expect(status.createdAt).toEqual(new Date(note.published).getTime())
  })

  it('stores normalized actor ids for notes attributed to sender key fragments', async () => {
    expect(actor1).toBeDefined()
    const actorId = actor1?.id as string
    const note = MockMastodonActivityPubNote({
      id: `${actorId}/statuses/normalized-attribution`,
      from: `${actorId}#main-key`,
      content: '<p>Hello normalized actor</p>'
    })
    await createNoteJob(database, {
      id: 'normalized-attribution',
      name: CREATE_NOTE_JOB_NAME,
      data: note,
      verifiedSenderActorId: actorId
    })

    const status = await database.getStatus({ statusId: note.id })

    expect(status?.actorId).toBe(actorId)
  })

  it('stores attachments under the normalized actor id for notes attributed to sender key fragments', async () => {
    expect(actor1).toBeDefined()
    const actorId = actor1?.id as string
    const rawAttributedTo = `${actorId}#main-key`
    const note = MockMastodonActivityPubNote({
      id: `${actorId}/statuses/normalized-attribution-attachment`,
      from: rawAttributedTo,
      content: '<p>Hello normalized attachment actor</p>',
      documents: [
        MockImageDocument({
          url: 'https://llun.dev/images/normalized-attachment.jpg'
        })
      ]
    })

    await createNoteJob(database, {
      id: 'normalized-attribution-attachment',
      name: CREATE_NOTE_JOB_NAME,
      data: note,
      verifiedSenderActorId: actorId
    })

    const normalizedActorAttachments = await database.getAttachmentsForActor({
      actorId
    })
    const rawActorAttachments = await database.getAttachmentsForActor({
      actorId: rawAttributedTo
    })

    expect(normalizedActorAttachments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorId,
          statusId: note.id,
          url: 'https://llun.dev/images/normalized-attachment.jpg'
        })
      ])
    )
    expect(rawActorAttachments).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          statusId: note.id,
          url: 'https://llun.dev/images/normalized-attachment.jpg'
        })
      ])
    )
  })

  it('adds litepub note into database and returns note', async () => {
    const note = MockLitepubNote({ content: '<p>Hello</p>' })
    await createNoteJob(database, {
      id: 'id',
      name: CREATE_NOTE_JOB_NAME,
      data: note
    })

    const status = (await database.getStatus({ statusId: note.id })) as Status
    if (status.type !== StatusType.enum.Note) {
      fail('Stauts type must be note')
    }
    expect(status).toBeDefined()
    expect(status.id).toEqual(note.id)
    expect(status.text).toEqual('<p>Hello</p>')
    expect(status.actorId).toEqual(note.attributedTo)
    expect(status.to).toEqual(note.to)
    expect(status.cc).toEqual(note.cc)
    expect(status.type).toEqual(StatusType.enum.Note)
    expect(status.createdAt).toEqual(new Date(note.published).getTime())
  })

  it('add status and attachments with status id into database', async () => {
    const note = MockMastodonActivityPubNote({
      content: 'Hello',
      documents: [
        MockImageDocument({ url: 'https://llun.dev/images/test1.jpg' }),
        MockImageDocument({
          url: 'https://llun.dev/images/test2.jpg',
          name: 'Second image'
        })
      ]
    })
    await createNoteJob(database, {
      id: 'id',
      name: CREATE_NOTE_JOB_NAME,
      data: note
    })
    const status = (await database.getStatus({ statusId: note.id })) as Status
    if (status.type !== StatusType.enum.Note) {
      fail('Stauts type must be note')
    }
    expect(status.attachments.length).toEqual(2)
    expect(status.attachments[0]).toMatchObject({
      statusId: note.id,
      mediaType: 'image/jpeg',
      name: '',
      url: 'https://llun.dev/images/test1.jpg',
      width: 2000,
      height: 1500
    })
    expect(status.attachments[1]).toMatchObject({
      statusId: note.id,
      mediaType: 'image/jpeg',
      url: 'https://llun.dev/images/test2.jpg',
      width: 2000,
      height: 1500,
      name: 'Second image'
    })
  })

  it('does not add duplicate note into database', async () => {
    const note = MockMastodonActivityPubNote({
      id: `${actor1?.id}/statuses/post-1`,
      content: 'Test duplicate'
    })
    await createNoteJob(database, {
      id: 'id',
      name: CREATE_NOTE_JOB_NAME,
      data: note
    })
    const status = await database.getStatus({
      statusId: `${actor1?.id}/statuses/post-1`
    })
    expect(status).not.toEqual('Test duplicate')
  })

  it('get public profile and add non-exist actor to database', async () => {
    const note = MockMastodonActivityPubNote({
      from: FRIEND_ACTOR_ID,
      content: '<p>Hello</p>'
    })
    await createNoteJob(database, {
      id: 'id',
      name: CREATE_NOTE_JOB_NAME,
      data: note
    })
    const actor = await database.getActorFromId({ id: FRIEND_ACTOR_ID })
    expect(actor).toBeDefined()
    expect(actor).toMatchObject({
      id: FRIEND_ACTOR_ID,
      username: 'friend',
      domain: 'somewhere.test',
      createdAt: expect.toBeNumber()
    })
  })

  it('does not create notes from blocked actor domains', async () => {
    const actorId = 'https://blocked-note.test/actors/bad'
    const note = MockMastodonActivityPubNote({
      id: 'https://blocked-note.test/statuses/1',
      from: actorId,
      content: '<p>Blocked</p>'
    })
    await database.createDomainBlock({
      domain: 'blocked-note.test',
      severity: 'suspend'
    })

    await expect(
      createNoteJob(database, {
        id: 'id',
        name: CREATE_NOTE_JOB_NAME,
        data: note
      })
    ).rejects.toThrow('Federation with actor domain is blocked')

    await expect(database.getStatus({ statusId: note.id })).resolves.toBeNull()
  })

  it('ignores inbox notes whose attributedTo does not match the verified sender', async () => {
    const note = MockMastodonActivityPubNote({
      id: 'https://somewhere.test/actors/friend/statuses/spoofed-note',
      from: FRIEND_ACTOR_ID,
      content: '<p>Spoofed sender</p>'
    })

    await createNoteJob(database, {
      id: 'id',
      name: CREATE_NOTE_JOB_NAME,
      data: note,
      verifiedSenderActorId: 'https://somewhere.test/actors/mallory'
    })

    await expect(database.getStatus({ statusId: note.id })).resolves.toBeNull()
  })

  it('stores the language derived from the note contentMap key', async () => {
    const note = MockMastodonActivityPubNote({
      id: `https://${actor1!.domain}/notes/thai-language-${Date.now()}`,
      content: '<p>สวัสดีครับ</p>',
      contentMap: { th: '<p>สวัสดีครับ</p>' }
    })
    await createNoteJob(database, {
      id: 'id-thai-language',
      name: CREATE_NOTE_JOB_NAME,
      data: note
    })

    const status = (await database.getStatus({ statusId: note.id })) as Status
    if (status.type !== StatusType.enum.Note) {
      fail('Status type must be note')
    }
    expect(status.language).toEqual('th')
  })

  it('stores a content-detected language that overrides a mislabeled declared language', async () => {
    const note = MockMastodonActivityPubNote({
      id: `https://${actor1!.domain}/notes/detected-thai-${Date.now()}`,
      // Declared as English (the mock's default contentMap key), but the
      // content itself is unambiguously Thai — the mislabeled-post scenario
      // the Translate gate needs to recover from.
      content:
        '<p>สวัสดีครับ ผมชื่อจอห์น ผมเป็นนักพัฒนาซอฟต์แวร์ที่ทำงานในกรุงเทพมหานคร</p>'
    })
    await createNoteJob(database, {
      id: 'id-detected-thai',
      name: CREATE_NOTE_JOB_NAME,
      data: note
    })

    const status = (await database.getStatus({ statusId: note.id })) as Status
    if (status.type !== StatusType.enum.Note) {
      fail('Status type must be note')
    }
    expect(status.language).toEqual('en')
    expect(status.detectedLanguage).toEqual('th')
  })

  it('adds note with single content map when contentMap is array', async () => {
    const note = MockMastodonActivityPubNote({
      content: '<p>Hello</p>',
      contentMap: ['<p>Hello</p>']
    })
    await createNoteJob(database, {
      id: 'id',
      name: CREATE_NOTE_JOB_NAME,
      data: note
    })
    const status = (await database.getStatus({ statusId: note.id })) as Status
    if (status.type !== StatusType.enum.Note) {
      fail('Stauts type must be note')
    }
    expect(status.text).toEqual('<p>Hello</p>')
  })

  it('adds note with content is array from wordpress', async () => {
    const note = MockMastodonActivityPubNote({
      content: ['<p>Hello</p>'],
      contentMap: {}
    })
    await createNoteJob(database, {
      id: 'id',
      name: CREATE_NOTE_JOB_NAME,
      data: note
    })
    const status = (await database.getStatus({ statusId: note.id })) as Status
    if (status.type !== StatusType.enum.Note) {
      fail('Stauts type must be note')
    }
    expect(status.text).toEqual('<p>Hello</p>')
  })

  it('adds image activity as note into database', async () => {
    const image = {
      type: 'Image',
      id: 'https://pixelfed.social/p/user/123456',
      attributedTo: 'https://pixelfed.social/users/user',
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: ['https://pixelfed.social/users/user/followers'],
      content: '<p>Beautiful sunset</p>',
      url: 'https://pixelfed.social/p/user/123456',
      published: new Date().toISOString(),
      mediaType: 'image/jpeg',
      name: 'Sunset',
      width: 1920,
      height: 1080,
      tag: []
    }

    await createNoteJob(database, {
      id: 'id',
      name: CREATE_NOTE_JOB_NAME,
      data: image
    })

    const status = (await database.getStatus({ statusId: image.id })) as Status
    if (status.type !== StatusType.enum.Note) {
      fail('Status type must be note')
    }
    expect(status).toBeDefined()
    expect(status.id).toEqual(image.id)
    expect(status.text).toEqual('<p>Beautiful sunset</p>')
    expect(status.actorId).toEqual(image.attributedTo)
    expect(status.type).toEqual(StatusType.enum.Note)
    expect(status.attachments).toHaveLength(1)
    expect(status.attachments[0]).toMatchObject({
      statusId: image.id,
      mediaType: 'image/jpeg',
      url: 'https://pixelfed.social/p/user/123456',
      width: 1920,
      height: 1080
    })
  })

  // @/lib/schema doesn't accept url arrays, so we normalize to a string.
  it('adds image activity with array URLs into database', async () => {
    const image = {
      type: 'Image',
      id: 'https://pixelfed.social/p/user/1234567',
      attributedTo: 'https://pixelfed.social/users/user',
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: ['https://pixelfed.social/users/user/followers'],
      content: '<p>Beautiful sunset</p>',
      url: [
        {
          href: 'https://pixelfed.social/storage/m/1.jpg',
          mediaType: 'image/jpeg'
        },
        {
          href: 'https://pixelfed.social/storage/m/2.jpg',
          mediaType: 'image/jpeg'
        }
      ],
      published: new Date().toISOString(),
      mediaType: 'image/jpeg',
      name: 'Sunset',
      tag: []
    }

    await createNoteJob(database, {
      id: 'id',
      name: CREATE_NOTE_JOB_NAME,
      data: image
    })

    const status = (await database.getStatus({ statusId: image.id })) as Status
    expect(status.attachments).toHaveLength(1)
    expect(status.attachments[0]).toMatchObject({
      url: 'https://pixelfed.social/storage/m/1.jpg'
    })
  })

  it('adds image activity without mediaType into database with default', async () => {
    const image = {
      type: 'Image',
      id: 'https://pixelfed.social/p/user/no-media-type',
      attributedTo: 'https://pixelfed.social/users/user',
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: ['https://pixelfed.social/users/user/followers'],
      content: '<p>Sunset</p>',
      url: 'https://pixelfed.social/p/user/no-media-type.jpg',
      published: new Date().toISOString(),
      name: 'Sunset',
      tag: []
    }

    await createNoteJob(database, {
      id: 'id',
      name: CREATE_NOTE_JOB_NAME,
      data: image
    })

    const status = (await database.getStatus({ statusId: image.id })) as Status
    expect(status.attachments).toHaveLength(1)
    expect(status.attachments[0]).toMatchObject({
      url: 'https://pixelfed.social/p/user/no-media-type.jpg',
      mediaType: 'image/jpeg'
    })
  })

  it('adds page activity as note into database', async () => {
    const page = {
      type: 'Page',
      id: 'https://pixelfed.social/p/user/page1',
      attributedTo: 'https://pixelfed.social/users/user',
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: ['https://pixelfed.social/users/user/followers'],
      content: '<p>A nice page</p>',
      url: 'https://pixelfed.social/p/user/page1',
      published: new Date().toISOString(),
      tag: []
    }

    await createNoteJob(database, {
      id: 'id',
      name: CREATE_NOTE_JOB_NAME,
      data: page
    })

    const status = (await database.getStatus({ statusId: page.id })) as Status
    expect(status).toBeDefined()
    expect(status.id).toEqual(page.id)
    expect(status.type).toEqual(StatusType.enum.Note)
    expect(status.text).toEqual('<p>A nice page</p>')
  })

  it('adds article activity as note into database', async () => {
    const article = {
      type: 'Article',
      id: 'https://writefreely.org/posts/article1',
      attributedTo: 'https://writefreely.org/users/writer',
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: ['https://writefreely.org/users/writer/followers'],
      content: '<p>An interesting article</p>',
      url: 'https://writefreely.org/posts/article1',
      published: new Date().toISOString(),
      tag: []
    }

    await createNoteJob(database, {
      id: 'id',
      name: CREATE_NOTE_JOB_NAME,
      data: article
    })

    const status = (await database.getStatus({
      statusId: article.id
    })) as Status
    expect(status).toBeDefined()
    expect(status.id).toEqual(article.id)
    expect(status.type).toEqual(StatusType.enum.Note)
    expect(status.text).toEqual('<p>An interesting article</p>')
  })

  it('adds video activity as note into database', async () => {
    const video = {
      type: 'Video',
      id: 'https://peertube.social/videos/watch/video1',
      attributedTo: 'https://peertube.social/accounts/streamer',
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: ['https://peertube.social/accounts/streamer/followers'],
      content: '<p>Cool video</p>',
      url: 'https://peertube.social/videos/watch/video1',
      published: new Date().toISOString(),
      mediaType: 'video/mp4',
      name: 'Stream',
      width: 1920,
      height: 1080,
      tag: []
    }

    await createNoteJob(database, {
      id: 'id',
      name: CREATE_NOTE_JOB_NAME,
      data: video
    })

    const status = (await database.getStatus({ statusId: video.id })) as Status
    expect(status).toBeDefined()
    expect(status.id).toEqual(video.id)
    expect(status.type).toEqual(StatusType.enum.Note)
    expect(status.attachments).toHaveLength(1)
    expect(status.attachments[0]).toMatchObject({
      statusId: video.id,
      mediaType: 'video/mp4',
      url: 'https://peertube.social/videos/watch/video1',
      width: 1920,
      height: 1080
    })
  })

  it('stores hashtag tags with correct type', async () => {
    const noteId = `https://${actor1!.domain}/notes/hashtag-test-${Date.now()}`
    const note = MockMastodonActivityPubNote({
      id: noteId,
      content: '<p>Hello #testing</p>',
      tags: [
        {
          type: 'Hashtag',
          href: 'https://somewhere.test/tags/testing',
          name: '#testing'
        }
      ]
    })
    await createNoteJob(database, {
      id: 'id-hashtag',
      name: CREATE_NOTE_JOB_NAME,
      data: note
    })

    const tags = await database.getTags({ statusId: noteId })
    const hashtagTags = tags.filter((t) => t.type === 'hashtag')
    expect(hashtagTags).toHaveLength(1)
    expect(hashtagTags[0].name).toEqual('#testing')
    expect(hashtagTags[0].value).toEqual('https://somewhere.test/tags/testing')
  })

  it('stores inbound emoji tags so remote custom emoji render locally', async () => {
    const noteId = `https://${actor1!.domain}/notes/emoji-test-${Date.now()}`
    const note = MockMastodonActivityPubNote({
      id: noteId,
      content: '<p>Hello :blobcat:</p>',
      tags: [
        {
          type: 'Emoji',
          name: ':blobcat:',
          updated: new Date().toISOString(),
          icon: {
            type: 'Image',
            mediaType: 'image/png',
            url: 'https://somewhere.test/emojis/blobcat.png'
          }
        }
      ]
    })
    await createNoteJob(database, {
      id: 'id-emoji',
      name: CREATE_NOTE_JOB_NAME,
      data: note
    })

    const tags = await database.getTags({ statusId: noteId })
    const emojiTags = tags.filter((t) => t.type === 'emoji')
    expect(emojiTags).toHaveLength(1)
    expect(emojiTags[0].name).toEqual(':blobcat:')
    expect(emojiTags[0].value).toEqual(
      'https://somewhere.test/emojis/blobcat.png'
    )
  })

  it('batches hashtag search reindexing after hashtag tags are created', async () => {
    const noteId = `https://${actor1!.domain}/notes/batched-hashtag-test-${Date.now()}`
    const indexHashtagSearchDocuments = vi.spyOn(
      database,
      'indexHashtagSearchDocuments'
    )
    const note = MockMastodonActivityPubNote({
      id: noteId,
      content: '<p>Hello #one #two</p>',
      tags: [
        {
          type: 'Hashtag',
          href: 'https://somewhere.test/tags/one',
          name: '#one'
        },
        {
          type: 'Hashtag',
          href: 'https://somewhere.test/tags/two',
          name: '#two'
        }
      ]
    })

    try {
      await createNoteJob(database, {
        id: 'id-batched-hashtags',
        name: CREATE_NOTE_JOB_NAME,
        data: note,
        verifiedSenderActorId: note.attributedTo
      })

      expect(indexHashtagSearchDocuments).toHaveBeenCalledTimes(1)
      expect(indexHashtagSearchDocuments).toHaveBeenCalledWith({
        hashtags: ['#one', '#two']
      })
    } finally {
      indexHashtagSearchDocuments.mockRestore()
    }
  })

  it('stores mention tags separately from hashtag tags', async () => {
    const noteId = `https://${actor1!.domain}/notes/mixed-tag-test-${Date.now()}`
    const note = MockMastodonActivityPubNote({
      id: noteId,
      content: '<p>Hello @someone #topic</p>',
      tags: [
        {
          type: 'Mention',
          href: 'https://somewhere.test/users/someone',
          name: '@someone'
        },
        {
          type: 'Hashtag',
          href: 'https://somewhere.test/tags/topic',
          name: '#topic'
        }
      ]
    })
    await createNoteJob(database, {
      id: 'id-mixed-tags',
      name: CREATE_NOTE_JOB_NAME,
      data: note
    })

    const tags = await database.getTags({ statusId: noteId })
    const mentionTags = tags.filter((t) => t.type === 'mention')
    const hashtagTags = tags.filter((t) => t.type === 'hashtag')
    expect(mentionTags).toHaveLength(1)
    expect(hashtagTags).toHaveLength(1)
    expect(mentionTags[0].name).toEqual('@someone')
    expect(hashtagTags[0].name).toEqual('#topic')
  })

  describe('quote ingest', () => {
    const createLocalQuoted = async (suffix: string, actorId: string) => {
      const id = `${actorId}/statuses/quoted-${suffix}`
      await database.createNote({
        id,
        url: id,
        actorId,
        text: 'quoted status',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      return id
    }

    it('stores an accepted edge for a self-quote', async () => {
      const authorId = actor1?.id as string
      const quotedId = await createLocalQuoted('self', authorId)
      const note = {
        ...MockMastodonActivityPubNote({
          id: `${authorId}/statuses/quoting-self`,
          from: authorId,
          content: 'self quote'
        }),
        quote: quotedId
      }

      await createNoteJob(database, {
        id: 'quote-self',
        name: CREATE_NOTE_JOB_NAME,
        data: note,
        verifiedSenderActorId: authorId
      })

      const edge = await database.getStatusQuote({ statusId: note.id })
      expect(edge).toMatchObject({
        quotedStatusId: quotedId,
        state: 'accepted'
      })
    })

    it.each([
      { label: 'FEP quote', field: 'quote' },
      { label: 'Fedibird quoteUri', field: 'quoteUri' },
      { label: 'Misskey _misskey_quote', field: '_misskey_quote' }
    ])(
      'stores a pending edge for a $label with no stamp from a different author',
      async ({ field }) => {
        const authorId = actor1?.id as string
        const quotedId = await createLocalQuoted(`pending-${field}`, authorId)
        const note = {
          ...MockMastodonActivityPubNote({
            id: `${ACTOR2_ID}/statuses/quoting-${field}`,
            from: ACTOR2_ID,
            content: 'cross-author quote'
          }),
          [field]: quotedId
        }

        await createNoteJob(database, {
          id: `quote-pending-${field}`,
          name: CREATE_NOTE_JOB_NAME,
          data: note,
          verifiedSenderActorId: ACTOR2_ID
        })

        const edge = await database.getStatusQuote({ statusId: note.id })
        expect(edge).toMatchObject({
          quotedStatusId: quotedId,
          state: 'pending'
        })
      }
    )

    it('does not persist an attacker-supplied quoteAuthorization on a pending edge', async () => {
      // A remote note can claim any `quoteAuthorization` uri. Until the quote
      // verifies as accepted, the stamp is meaningless and must not be stored —
      // otherwise a forged note could shadow a legitimate stamp on the
      // (non-unique) authorizationUri lookup.
      const authorId = actor1?.id as string
      const quotedId = await createLocalQuoted('forged-stamp', authorId)
      const note = {
        ...MockMastodonActivityPubNote({
          id: `${ACTOR2_ID}/statuses/quoting-forged-stamp`,
          from: ACTOR2_ID,
          content: 'quote with forged stamp'
        }),
        quote: quotedId,
        quoteAuthorization: `${authorId}/quote_authorizations/forged`
      }

      await createNoteJob(database, {
        id: 'quote-forged-stamp',
        name: CREATE_NOTE_JOB_NAME,
        data: note,
        verifiedSenderActorId: ACTOR2_ID
      })

      const edge = await database.getStatusQuote({ statusId: note.id })
      expect(edge).toMatchObject({ quotedStatusId: quotedId, state: 'pending' })
      expect(edge?.authorizationUri).toBeNull()
    })

    it('leaves no quote edge for a note that quotes nothing', async () => {
      const note = MockMastodonActivityPubNote({
        id: `${actor1?.id}/statuses/no-quote`,
        from: actor1?.id,
        content: 'plain note'
      })
      await createNoteJob(database, {
        id: 'quote-none',
        name: CREATE_NOTE_JOB_NAME,
        data: note,
        verifiedSenderActorId: actor1?.id
      })
      await expect(
        database.getStatusQuote({ statusId: note.id })
      ).resolves.toBeNull()
    })

    it('does not downgrade an already-accepted edge when a stampless Create arrives', async () => {
      // Models the "remote quoting local" race: we accepted the QuoteRequest
      // (edge accepted) before the Create Note (no stamp -> verify yields
      // pending) arrives. The one-way machine must keep it accepted.
      const authorId = actor1?.id as string
      const quotedId = await createLocalQuoted('race', authorId)
      const quotingId = `${ACTOR2_ID}/statuses/quoting-race`
      await database.createStatusQuote({
        statusId: quotingId,
        quotedStatusId: quotedId,
        state: 'accepted',
        authorizationUri: 'https://llun.test/sentinel-stamp'
      })
      const note = {
        ...MockMastodonActivityPubNote({
          id: quotingId,
          from: ACTOR2_ID,
          content: 'race quote'
        }),
        quote: quotedId
      }

      await createNoteJob(database, {
        id: 'quote-race',
        name: CREATE_NOTE_JOB_NAME,
        data: note,
        verifiedSenderActorId: ACTOR2_ID
      })

      const edge = await database.getStatusQuote({ statusId: quotingId })
      expect(edge?.state).toBe('accepted')
      expect(edge?.authorizationUri).toBe('https://llun.test/sentinel-stamp')
    })

    it('does not rewrite the edge for a duplicate Create', async () => {
      const authorId = actor1?.id as string
      const quotedId = await createLocalQuoted('dup', authorId)
      const note = {
        ...MockMastodonActivityPubNote({
          id: `${authorId}/statuses/quoting-dup`,
          from: authorId,
          content: 'dup quote'
        }),
        quote: quotedId
      }

      await createNoteJob(database, {
        id: 'quote-dup',
        name: CREATE_NOTE_JOB_NAME,
        data: note,
        verifiedSenderActorId: authorId
      })
      // Sentinel that a second ingest would clobber (the note carries no stamp).
      await database.createStatusQuote({
        statusId: note.id,
        quotedStatusId: quotedId,
        state: 'accepted',
        authorizationUri: 'https://llun.test/sentinel'
      })

      await createNoteJob(database, {
        id: 'quote-dup',
        name: CREATE_NOTE_JOB_NAME,
        data: note,
        verifiedSenderActorId: authorId
      })

      const edge = await database.getStatusQuote({ statusId: note.id })
      // The duplicate returned early (existing status), so createStatusQuote was
      // not called again and the sentinel survives.
      expect(edge?.authorizationUri).toBe('https://llun.test/sentinel')
    })

    it('fetches the quoted note and accepts a stamped quote whose target is not stored locally', async () => {
      // Mastodon 4.5 quotes reference a post we usually do not already store. A
      // valid FEP-044f stamp still proves approval, so createNoteJob must fetch
      // the quoted note (instance-signed, like the boost path) so the stamp
      // verifies against the quoted author and the quote card can load the
      // content — instead of leaving every remote quote stuck as `pending`.
      const quotedAuthorId = 'https://somewhere.test/users/quotedauthor'
      const quotedStatusId = `${quotedAuthorId}/statuses/quoted-remote-accepted`
      const quotingNoteId = `${ACTOR2_ID}/statuses/quoting-remote-accepted`
      const stampUri = buildQuoteAuthorizationUri(quotedAuthorId, quotingNoteId)
      const stampBody = JSON.stringify(
        buildQuoteAuthorizationObject({
          stampUri,
          attributedTo: quotedAuthorId,
          interactingObject: quotingNoteId,
          interactionTarget: quotedStatusId
        })
      )

      fetchMock.mockResponse(async (req) => {
        const { pathname } = new URL(req.url)
        if (pathname.includes('/quote_authorizations/')) {
          return { status: 200, body: stampBody }
        }
        if (pathname.includes('/statuses/')) {
          const from = req.url.slice(0, req.url.indexOf('/statuses'))
          return {
            status: 200,
            body: JSON.stringify(
              MockMastodonActivityPubNote({
                id: req.url,
                from,
                content: 'quoted remote status',
                withContext: true
              })
            )
          }
        }
        return {
          status: 200,
          body: JSON.stringify(
            MockActivityPubPerson({ id: req.url, url: req.url })
          )
        }
      })

      const note = {
        ...MockMastodonActivityPubNote({
          id: quotingNoteId,
          from: ACTOR2_ID,
          content: 'cross-author remote quote'
        }),
        quote: quotedStatusId,
        quoteAuthorization: stampUri
      }

      await createNoteJob(database, {
        id: 'quote-remote-accepted',
        name: CREATE_NOTE_JOB_NAME,
        data: note,
        verifiedSenderActorId: ACTOR2_ID
      })

      // The quoted post is fetched and stored locally so the card can load it.
      await expect(
        database.getStatus({ statusId: quotedStatusId })
      ).resolves.not.toBeNull()

      // With the quoted author now known, the valid stamp verifies to accepted.
      const edge = await database.getStatusQuote({ statusId: quotingNoteId })
      expect(edge).toMatchObject({
        quotedStatusId,
        state: 'accepted'
      })
      expect(edge?.authorizationUri).toBe(stampUri)
    })

    it('leaves a stamped remote quote pending when the quoted note cannot be fetched', async () => {
      // The quoted server is unreachable, so we never learn the author and the
      // stamp cannot be validated. The quote must degrade to pending (never crash
      // or trust the stamp blindly).
      const quotedAuthorId = 'https://somewhere.test/users/unreachable'
      const quotedStatusId = `${quotedAuthorId}/statuses/quoted-unreachable`
      const quotingNoteId = `${ACTOR2_ID}/statuses/quoting-unreachable`
      const stampUri = buildQuoteAuthorizationUri(quotedAuthorId, quotingNoteId)

      fetchMock.mockResponse(async (req) => {
        const { pathname } = new URL(req.url)
        if (pathname.includes('/statuses/quoted-unreachable')) {
          return { status: 404, body: '' }
        }
        if (pathname.includes('/quote_authorizations/')) {
          return {
            status: 200,
            body: JSON.stringify(
              buildQuoteAuthorizationObject({
                stampUri,
                attributedTo: quotedAuthorId,
                interactingObject: quotingNoteId,
                interactionTarget: quotedStatusId
              })
            )
          }
        }
        return {
          status: 200,
          body: JSON.stringify(
            MockActivityPubPerson({ id: req.url, url: req.url })
          )
        }
      })

      const note = {
        ...MockMastodonActivityPubNote({
          id: quotingNoteId,
          from: ACTOR2_ID,
          content: 'quote of an unreachable post'
        }),
        quote: quotedStatusId,
        quoteAuthorization: stampUri
      }

      await createNoteJob(database, {
        id: 'quote-unreachable',
        name: CREATE_NOTE_JOB_NAME,
        data: note,
        verifiedSenderActorId: ACTOR2_ID
      })

      await expect(
        database.getStatus({ statusId: quotedStatusId })
      ).resolves.toBeNull()
      const edge = await database.getStatusQuote({ statusId: quotingNoteId })
      expect(edge).toMatchObject({ quotedStatusId, state: 'pending' })
    })

    it('still rejects a forged stamp after fetching the quoted note (fetching grants no trust)', async () => {
      // The stamp is hosted under the quoted author's authority but names a
      // different issuer. Fetching the quoted note only makes the author
      // knowable; the exact-actor check must still reject the forgery.
      const quotedAuthorId = 'https://somewhere.test/users/victim'
      const quotedStatusId = `${quotedAuthorId}/statuses/quoted-forged-remote`
      const quotingNoteId = `${ACTOR2_ID}/statuses/quoting-forged-remote`
      const stampUri = buildQuoteAuthorizationUri(quotedAuthorId, quotingNoteId)
      const forgedStampBody = JSON.stringify(
        buildQuoteAuthorizationObject({
          stampUri,
          attributedTo: 'https://somewhere.test/users/impostor',
          interactingObject: quotingNoteId,
          interactionTarget: quotedStatusId
        })
      )

      fetchMock.mockResponse(async (req) => {
        const { pathname } = new URL(req.url)
        if (pathname.includes('/quote_authorizations/')) {
          return { status: 200, body: forgedStampBody }
        }
        if (pathname.includes('/statuses/')) {
          const from = req.url.slice(0, req.url.indexOf('/statuses'))
          return {
            status: 200,
            body: JSON.stringify(
              MockMastodonActivityPubNote({
                id: req.url,
                from,
                content: 'victim status',
                withContext: true
              })
            )
          }
        }
        return {
          status: 200,
          body: JSON.stringify(
            MockActivityPubPerson({ id: req.url, url: req.url })
          )
        }
      })

      const note = {
        ...MockMastodonActivityPubNote({
          id: quotingNoteId,
          from: ACTOR2_ID,
          content: 'quote with forged remote stamp'
        }),
        quote: quotedStatusId,
        quoteAuthorization: stampUri
      }

      await createNoteJob(database, {
        id: 'quote-forged-remote',
        name: CREATE_NOTE_JOB_NAME,
        data: note,
        verifiedSenderActorId: ACTOR2_ID
      })

      // The quoted note was fetched and stored so the card could load it...
      await expect(
        database.getStatus({ statusId: quotedStatusId })
      ).resolves.not.toBeNull()
      // ...but the forged stamp does not verify, so the edge stays pending and
      // the attacker-supplied stamp uri is not persisted.
      const edge = await database.getStatusQuote({ statusId: quotingNoteId })
      expect(edge).toMatchObject({ quotedStatusId, state: 'pending' })
      expect(edge?.authorizationUri).toBeNull()
    })

    it('does not fetch a not-locally-stored quote target when there is no stamp', async () => {
      // Only stamped quotes are worth resolving; a stamp-less quote whose target
      // is not stored must stay pending WITHOUT fetching, so we never fan out a
      // fetch on every inbound quote.
      const quotedStatusId =
        'https://somewhere.test/users/stampless/statuses/quoted-stampless'
      const quotingNoteId = `${ACTOR2_ID}/statuses/quoting-stampless-remote`

      fetchMock.mockResponse(async () => {
        throw new Error(
          'no remote fetch expected for a stamp-less remote quote'
        )
      })

      const note = {
        ...MockMastodonActivityPubNote({
          id: quotingNoteId,
          from: ACTOR2_ID,
          content: 'stamp-less remote quote'
        }),
        quote: quotedStatusId
      }

      await createNoteJob(database, {
        id: 'quote-stampless-remote',
        name: CREATE_NOTE_JOB_NAME,
        data: note,
        verifiedSenderActorId: ACTOR2_ID
      })

      await expect(
        database.getStatus({ statusId: quotedStatusId })
      ).resolves.toBeNull()
      const edge = await database.getStatusQuote({ statusId: quotingNoteId })
      expect(edge).toMatchObject({ quotedStatusId, state: 'pending' })
    })

    it('bounds quote resolution to a single hop (a fetched quoted note does not chase its own quote)', async () => {
      // A quotes B (stamped); the fetched B is itself a stamped quote of C. The
      // recursive store must NOT fetch C, so an attacker-controlled chain cannot
      // drive unbounded recursive fetches.
      const authorB = 'https://somewhere.test/users/chain-b'
      const bId = `${authorB}/statuses/chain-b`
      const authorC = 'https://somewhere.test/users/chain-c'
      const cId = `${authorC}/statuses/chain-c`
      const quotingA = `${ACTOR2_ID}/statuses/quoting-a-chain`
      const stampAB = buildQuoteAuthorizationUri(authorB, quotingA)
      const stampBC = buildQuoteAuthorizationUri(authorC, bId)

      fetchMock.mockResponse(async (req) => {
        const { pathname } = new URL(req.url)
        if (req.url === stampAB) {
          return {
            status: 200,
            body: JSON.stringify(
              buildQuoteAuthorizationObject({
                stampUri: stampAB,
                attributedTo: authorB,
                interactingObject: quotingA,
                interactionTarget: bId
              })
            )
          }
        }
        // B is itself a stamped quote of C (quote terms carried on a real quote
        // context so they survive compaction on fetch).
        if (req.url === bId) {
          return {
            status: 200,
            body: JSON.stringify({
              '@context': QUOTE_ACTIVITY_CONTEXT,
              ...MockMastodonActivityPubNote({
                id: bId,
                from: authorB,
                content: 'note b quotes c'
              }),
              quote: cId,
              quoteAuthorization: stampBC
            })
          }
        }
        // C's note and the B->C stamp are BOTH served successfully: without the
        // single-hop bound, resolving B would fetch + store C (and accept B->C),
        // which the assertions below detect as a regression.
        if (req.url === stampBC) {
          return {
            status: 200,
            body: JSON.stringify(
              buildQuoteAuthorizationObject({
                stampUri: stampBC,
                attributedTo: authorC,
                interactingObject: bId,
                interactionTarget: cId
              })
            )
          }
        }
        if (pathname.includes('/statuses/')) {
          const from = req.url.slice(0, req.url.indexOf('/statuses'))
          return {
            status: 200,
            body: JSON.stringify(
              MockMastodonActivityPubNote({
                id: req.url,
                from,
                content: 'note c',
                withContext: true
              })
            )
          }
        }
        return {
          status: 200,
          body: JSON.stringify(
            MockActivityPubPerson({ id: req.url, url: req.url })
          )
        }
      })

      const note = {
        ...MockMastodonActivityPubNote({
          id: quotingA,
          from: ACTOR2_ID,
          content: 'a quotes b'
        }),
        quote: bId,
        quoteAuthorization: stampAB
      }

      await createNoteJob(database, {
        id: 'quote-a-chain',
        name: CREATE_NOTE_JOB_NAME,
        data: note,
        verifiedSenderActorId: ACTOR2_ID
      })

      // A -> B resolved and accepted (B fetched + stored, valid stamp).
      const edgeA = await database.getStatusQuote({ statusId: quotingA })
      expect(edgeA).toMatchObject({ quotedStatusId: bId, state: 'accepted' })
      await expect(
        database.getStatus({ statusId: bId })
      ).resolves.not.toBeNull()
      // B's own quote target C was never fetched (single-hop), so B -> C stays
      // pending and C is not stored.
      await expect(database.getStatus({ statusId: cId })).resolves.toBeNull()
      const edgeB = await database.getStatusQuote({ statusId: bId })
      expect(edgeB).toMatchObject({ quotedStatusId: cId, state: 'pending' })
    })

    it('does not orphan the quoting note when the quoted author domain is blocked', async () => {
      // Fetching the quoted note runs assertActorCanFederate for the quoted
      // author, which throws for a blocked domain. That must not abort ingestion
      // of the quoting note (which is already stored) — the edge degrades to
      // pending and the note is fully processed.
      const authorId = 'https://blocked-quote.test/users/blockedauthor'
      const quotedStatusId = `${authorId}/statuses/quoted-blocked`
      const quotingNoteId = `${ACTOR2_ID}/statuses/quoting-blocked-target`
      const stampUri = buildQuoteAuthorizationUri(authorId, quotingNoteId)
      await database.createDomainBlock({
        domain: 'blocked-quote.test',
        severity: 'suspend'
      })

      fetchMock.mockResponse(async (req) => {
        const { pathname } = new URL(req.url)
        if (pathname.includes('/quote_authorizations/')) {
          return {
            status: 200,
            body: JSON.stringify(
              buildQuoteAuthorizationObject({
                stampUri,
                attributedTo: authorId,
                interactingObject: quotingNoteId,
                interactionTarget: quotedStatusId
              })
            )
          }
        }
        if (pathname.includes('/statuses/')) {
          const from = req.url.slice(0, req.url.indexOf('/statuses'))
          return {
            status: 200,
            body: JSON.stringify(
              MockMastodonActivityPubNote({
                id: req.url,
                from,
                content: 'blocked-domain quoted status',
                withContext: true
              })
            )
          }
        }
        return {
          status: 200,
          body: JSON.stringify(
            MockActivityPubPerson({ id: req.url, url: req.url })
          )
        }
      })

      const note = {
        ...MockMastodonActivityPubNote({
          id: quotingNoteId,
          from: ACTOR2_ID,
          content: 'quote of a blocked-domain post'
        }),
        quote: quotedStatusId,
        quoteAuthorization: stampUri
      }

      // The blocked-domain fetch must be swallowed, not thrown.
      await expect(
        createNoteJob(database, {
          id: 'quote-blocked-target',
          name: CREATE_NOTE_JOB_NAME,
          data: note,
          verifiedSenderActorId: ACTOR2_ID
        })
      ).resolves.not.toThrow()

      // The quoting note is not orphaned: it keeps a pending quote edge and the
      // quoted post is not stored.
      await expect(
        database.getStatus({ statusId: quotingNoteId })
      ).resolves.not.toBeNull()
      await expect(
        database.getStatus({ statusId: quotedStatusId })
      ).resolves.toBeNull()
      const edge = await database.getStatusQuote({ statusId: quotingNoteId })
      expect(edge).toMatchObject({ quotedStatusId, state: 'pending' })
    })
  })
})
