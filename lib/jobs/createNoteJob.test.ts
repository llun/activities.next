import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { createNoteJob } from '@/lib/jobs/createNoteJob'
import { CREATE_NOTE_JOB_NAME } from '@/lib/jobs/names'
import { mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { MockImageDocument } from '@/lib/stub/imageDocument'
import { MockLitepubNote, MockMastodonActivityPubNote } from '@/lib/stub/note'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { Actor } from '@/lib/types/domain/actor'
import { Status, StatusNote, StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

import { FRIEND_ACTOR_ID } from './createNoteJob.testUtils'

enableFetchMocks()

describe('createNoteJob', () => {
  const database = getTestSQLDatabase()
  let actor1: Actor | null | undefined

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
    expect(status.id).toEqual(note.id)
    expect(status.text).toEqual('<p>Hello</p>')
    expect(status.actorId).toEqual(note.attributedTo)
    expect(status.to).toEqual(note.to)
    expect(status.cc).toEqual(note.cc)
    expect(status.type).toEqual(StatusType.enum.Note)
    expect(status.createdAt).toEqual(new Date(note.published).getTime())
  })

  it('keeps the remote Note attachment order for many attachments', async () => {
    const urls = Array.from(
      { length: 6 },
      (_, i) => `https://llun.dev/images/ordered-${i}.jpg`
    )
    const note = MockMastodonActivityPubNote({
      id: 'ordered-attachments-note',
      content: 'Ordered',
      documents: urls.map((url) => MockImageDocument({ url }))
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
    expect(status.attachments.map((a) => a.url)).toEqual(urls)
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

  it.each([
    { sensitive: true, expected: true },
    { sensitive: false, expected: false }
  ])(
    'stores the sensitive flag $sensitive from the note',
    async ({ sensitive, expected }) => {
      const note = MockMastodonActivityPubNote({
        id: `https://${actor1!.domain}/notes/sensitive-${sensitive}-${Date.now()}`,
        content: '<p>Media</p>',
        sensitive
      })
      await createNoteJob(database, {
        id: `id-sensitive-${sensitive}`,
        name: CREATE_NOTE_JOB_NAME,
        data: note
      })

      const status = (await database.getStatus({
        statusId: note.id
      })) as StatusNote
      expect(status.sensitive).toBe(expected)
    }
  )

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

  it('counts a hashtag only on a publicly addressed note', async () => {
    // The counter is served to anonymous /tags/<tag> visitors, so a
    // followers-only note's tag must not be observable through it.
    for (const [suffix, to, cc] of [
      ['private', ['https://somewhere.test/actors/friend/followers'], []],
      ['unlisted', [], [ACTIVITY_STREAM_PUBLIC]]
    ] as const) {
      await createNoteJob(database, {
        id: `id-hashtag-${suffix}`,
        name: CREATE_NOTE_JOB_NAME,
        data: MockMastodonActivityPubNote({
          id: `https://${actor1!.domain}/notes/hashtag-${suffix}-${Date.now()}`,
          content: '<p>Hello #audiencecount</p>',
          to: [...to],
          cc: [...cc],
          tags: [
            {
              type: 'Hashtag',
              href: 'https://somewhere.test/tags/audiencecount',
              name: '#audiencecount'
            }
          ]
        })
      })
    }

    expect(await database.getHashtagCounter({ hashtag: 'audiencecount' })).toBe(
      1
    )
  })

  it('recovers a concurrent duplicate insert without re-running tag or hashtag side effects', async () => {
    const noteId = `https://${actor1!.domain}/notes/dup-recovery-${Date.now()}`
    const note = MockMastodonActivityPubNote({
      id: noteId,
      content: '<p>Race #dup</p>',
      tags: [
        {
          type: 'Hashtag',
          href: 'https://somewhere.test/tags/dup',
          name: '#dup'
        }
      ]
    })

    // Stand in for the delivery that WON the race and committed first: the row
    // already exists, so createNoteWithResult's insert below will hit the
    // unique constraint and take the recovery path.
    await database.createNote({
      id: noteId,
      url: noteId,
      actorId: note.attributedTo,
      text: '<p>Race #dup</p>',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      createdAt: new Date(note.published).getTime()
    })

    // Simulate the losing delivery: its own pre-insert getStatus check saw no
    // row (the winner had not committed when it ran), so it proceeds into
    // createNoteWithResult and only discovers the duplicate at the INSERT —
    // i.e. the recovery path returns the winner's row with isNew=false. The
    // recovery lookup inside createNoteWithResult uses the module's own
    // getStatus closure, not this spied property, so it still finds the row.
    const getStatusSpy = vi
      .spyOn(database, 'getStatus')
      .mockResolvedValueOnce(null)
    const createTagSpy = vi.spyOn(database, 'createTag')
    const increaseHashtagCounterSpy = vi.spyOn(
      database,
      'increaseHashtagCounter'
    )

    try {
      await createNoteJob(database, {
        id: 'id-dup-recovery',
        name: CREATE_NOTE_JOB_NAME,
        data: note
      })

      // The winning delivery owns every side effect; the recovered loser must
      // skip them, or the hashtag counter permanently double-counts.
      expect(createTagSpy).not.toHaveBeenCalled()
      expect(increaseHashtagCounterSpy).not.toHaveBeenCalled()
    } finally {
      getStatusSpy.mockRestore()
      createTagSpy.mockRestore()
      increaseHashtagCounterSpy.mockRestore()
    }
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
})
