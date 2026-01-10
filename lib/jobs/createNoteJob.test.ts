import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { createNoteJob } from '@/lib/jobs/createNoteJob'
import { CREATE_NOTE_JOB_NAME } from '@/lib/jobs/names'
import { Actor } from '@/lib/models/actor'
import { Status, StatusType } from '@/lib/models/status'
import { mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { MockImageDocument } from '@/lib/stub/imageDocument'
import { MockLitepubNote, MockMastodonActivityPubNote } from '@/lib/stub/note'
import { seedActor1 } from '@/lib/stub/seed/actor1'

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

  // @llun/activities.schema doesn't accept url arrays, so we normalize to a string.
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
})
