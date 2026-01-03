import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { createNoteJob } from '@/lib/jobs/createNoteJob'
import { CREATE_NOTE_JOB_NAME, UPDATE_NOTE_JOB_NAME } from '@/lib/jobs/names'
import { updateNoteJob } from '@/lib/jobs/updateNoteJob'
import { Status, StatusType } from '@/lib/models/status'
import { mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { MockMastodonActivityPubNote } from '@/lib/stub/note'

enableFetchMocks()

describe('updateNoteJob', () => {
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

  it('updates note in database', async () => {
    const note = MockMastodonActivityPubNote({ content: '<p>Hello</p>' })
    await createNoteJob(database, {
      id: 'id',
      name: CREATE_NOTE_JOB_NAME,
      data: note
    })

    const updatedNote = { ...note, content: '<p>Hello Updated</p>' }
    await updateNoteJob(database, {
      id: 'id',
      name: UPDATE_NOTE_JOB_NAME,
      data: updatedNote
    })

    const status = (await database.getStatus({ statusId: note.id })) as Status
    expect(status).toBeDefined()
    expect(status.id).toEqual(note.id)
    expect(status.text).toEqual('<p>Hello Updated</p>')
    expect(status.type).toEqual(StatusType.enum.Note)
  })

  it('updates image activity in database', async () => {
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

    const updatedImage = {
      ...image,
      content: '<p>Beautiful sunset with filters</p>'
    }

    await updateNoteJob(database, {
      id: 'id',
      name: UPDATE_NOTE_JOB_NAME,
      data: updatedImage
    })

    const status = (await database.getStatus({ statusId: image.id })) as Status
    expect(status).toBeDefined()
    expect(status.id).toEqual(image.id)
    expect(status.text).toEqual('<p>Beautiful sunset with filters</p>')
    expect(status.type).toEqual(StatusType.enum.Note)
  })
})
