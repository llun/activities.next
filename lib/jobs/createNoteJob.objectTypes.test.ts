import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { createNoteJob } from '@/lib/jobs/createNoteJob'
import { CREATE_NOTE_JOB_NAME } from '@/lib/jobs/names'
import { mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { Status, StatusNote, StatusType } from '@/lib/types/domain/status'

enableFetchMocks()

describe('createNoteJob', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
  })

  afterAll(async () => {
    if (!database) return
    await database.destroy()
  })

  beforeEach(() => {
    fetchMock.resetMocks()
    mockRequests(fetchMock)
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

    const status = (await database.getStatus({
      statusId: image.id
    })) as StatusNote
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

    const status = (await database.getStatus({
      statusId: image.id
    })) as StatusNote
    expect(status.attachments).toHaveLength(1)
    expect(status.attachments[0]).toMatchObject({
      url: 'https://pixelfed.social/p/user/no-media-type.jpg',
      mediaType: 'image/jpeg'
    })
  })

  it.each([
    {
      type: 'Page',
      id: 'https://pixelfed.social/p/user/page1',
      attributedTo: 'https://pixelfed.social/users/user',
      cc: ['https://pixelfed.social/users/user/followers'],
      content: '<p>A nice page</p>'
    },
    {
      type: 'Article',
      id: 'https://writefreely.org/posts/article1',
      attributedTo: 'https://writefreely.org/users/writer',
      cc: ['https://writefreely.org/users/writer/followers'],
      content: '<p>An interesting article</p>'
    }
  ])('adds $type activity as note into database', async (activity) => {
    const object = {
      ...activity,
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      url: activity.id,
      published: new Date().toISOString(),
      tag: []
    }

    await createNoteJob(database, {
      id: 'id',
      name: CREATE_NOTE_JOB_NAME,
      data: object
    })

    const status = (await database.getStatus({
      statusId: object.id
    })) as StatusNote
    expect(status.id).toEqual(object.id)
    expect(status.type).toEqual(StatusType.enum.Note)
    expect(status.text).toEqual(object.content)
  })

  it.each([
    {
      type: 'Page',
      id: 'https://lemmy.test/post/title-page1',
      attributedTo: 'https://lemmy.test/u/picard',
      name: 'Page title',
      content: '<p>A nice page</p>'
    },
    {
      type: 'Article',
      id: 'https://writefreely.org/posts/title-article1',
      attributedTo: 'https://writefreely.org/users/writer',
      name: 'Article title',
      content: '<p>An interesting article</p>'
    }
  ])('prepends the $type name as a bold title', async (activity) => {
    const object = {
      ...activity,
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: [],
      url: activity.id,
      published: new Date().toISOString(),
      tag: []
    }

    await createNoteJob(database, {
      id: 'id',
      name: CREATE_NOTE_JOB_NAME,
      data: object
    })

    const status = (await database.getStatus({
      statusId: object.id
    })) as StatusNote
    expect(status.text).toEqual(
      `<p><strong>${activity.name}</strong></p>\n${activity.content}`
    )
  })

  it('stores an article summary as the content warning text', async () => {
    const article = {
      type: 'Article',
      id: 'https://writefreely.org/posts/summary-article1',
      attributedTo: 'https://writefreely.org/users/writer',
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: [],
      name: 'Article title',
      summary: 'Abstract',
      content: '<p>Body</p>',
      url: 'https://writefreely.org/posts/summary-article1',
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
    })) as StatusNote
    expect(status.summary).toEqual('Abstract')
    expect(status.sensitive).toBe(false)
  })

  it('adds an Audio object as a note with an audio attachment', async () => {
    const audio = {
      type: 'Audio',
      id: 'https://funkwhale.social/federation/music/uploads/1',
      attributedTo: 'https://funkwhale.social/federation/actors/dj',
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: [],
      name: 'Night Drive',
      published: new Date().toISOString(),
      url: [
        {
          type: 'Link',
          mimeType: 'audio/ogg',
          href: 'https://funkwhale.social/listen/1.ogg'
        },
        {
          type: 'Link',
          mediaType: 'text/html',
          href: 'https://funkwhale.social/library/tracks/1'
        }
      ]
    }

    await createNoteJob(database, {
      id: 'id',
      name: CREATE_NOTE_JOB_NAME,
      data: audio
    })

    const status = (await database.getStatus({
      statusId: audio.id
    })) as StatusNote
    expect(status.type).toEqual(StatusType.enum.Note)
    expect(status.text).toContain('<strong>Night Drive</strong>')
    expect(status.url).toEqual('https://funkwhale.social/library/tracks/1')
    expect(status.attachments).toHaveLength(1)
    expect(status.attachments[0]).toMatchObject({
      mediaType: 'audio/ogg',
      url: 'https://funkwhale.social/listen/1.ogg'
    })
  })

  it('adds an Event object as a note with its time and place', async () => {
    const event = {
      type: 'Event',
      id: 'https://mobilizon.social/events/42',
      attributedTo: 'https://mobilizon.social/@organizer',
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: [],
      name: 'Fedi Meetup',
      content: '<p>Come say hi</p>',
      startTime: '2026-11-01T18:00:00Z',
      location: { type: 'Place', name: 'Community Hall' },
      published: new Date().toISOString(),
      url: 'https://mobilizon.social/events/42'
    }

    await createNoteJob(database, {
      id: 'id',
      name: CREATE_NOTE_JOB_NAME,
      data: event
    })

    const status = (await database.getStatus({
      statusId: event.id
    })) as StatusNote
    expect(status.text).toEqual(
      '<p><strong>Fedi Meetup</strong></p>\n<p>2026-11-01T18:00:00Z</p>\n<p>Community Hall</p>\n<p>Come say hi</p>'
    )
    expect(status.attachments).toHaveLength(0)
  })

  it('adds an Event object whose location has no name', async () => {
    const event = {
      type: 'Event',
      id: 'https://mobilizon.social/events/43',
      attributedTo: 'https://mobilizon.social/@organizer',
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: [],
      name: 'Online Meetup',
      content: '<p>Join us</p>',
      startTime: '2026-11-02T18:00:00Z',
      location: { type: 'VirtualLocation' },
      published: new Date().toISOString()
    }

    await createNoteJob(database, {
      id: 'id',
      name: CREATE_NOTE_JOB_NAME,
      data: event
    })

    const status = (await database.getStatus({
      statusId: event.id
    })) as StatusNote
    expect(status.text).toEqual(
      '<p><strong>Online Meetup</strong></p>\n<p>2026-11-02T18:00:00Z</p>\n<p>Join us</p>'
    )
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

    const status = (await database.getStatus({
      statusId: video.id
    })) as StatusNote
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
