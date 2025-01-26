import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { getSQLDatabase } from '@/lib/database/sql'
import { createNoteJob } from '@/lib/jobs/createNoteJob'
import { CREATE_NOTE_JOB_NAME } from '@/lib/jobs/names'
import { Actor } from '@/lib/models/actor'
import { StatusType } from '@/lib/models/status'
import { mockRequests } from '@/lib/stub/activities'
import { MockImageDocument } from '@/lib/stub/imageDocument'
import { MockLitepubNote, MockMastodonNote } from '@/lib/stub/note'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { seedStorage } from '@/lib/stub/storage'

enableFetchMocks()

// Actor id for testing pulling actor information when create status
const FRIEND_ACTOR_ID = 'https://somewhere.test/actors/friend'

describe('createNoteJob', () => {
  const storage = getSQLDatabase({
    client: 'better-sqlite3',
    useNullAsDefault: true,
    connection: {
      filename: ':memory:'
    }
  })
  let actor1: Actor | undefined

  beforeAll(async () => {
    await storage.migrate()
    await seedStorage(storage)
    actor1 = await storage.getActorFromUsername({
      username: seedActor1.username,
      domain: seedActor1.domain
    })
  })

  afterAll(async () => {
    if (!storage) return
    await storage.destroy()
  })

  beforeEach(() => {
    fetchMock.resetMocks()
    mockRequests(fetchMock)
  })

  it('adds note into storage and returns note', async () => {
    const note = MockMastodonNote({ content: '<p>Hello</p>' })
    await createNoteJob(storage, {
      id: 'id',
      name: CREATE_NOTE_JOB_NAME,
      data: note
    })

    const status = await storage.getStatus({ statusId: note.id })
    if (status?.data.type !== StatusType.enum.Note) {
      fail('Stauts type must be note')
    }
    expect(status).toBeDefined()
    expect(status?.data.id).toEqual(note.id)
    expect(status?.data.text).toEqual('<p>Hello</p>')
    expect(status?.data.actorId).toEqual(note.attributedTo)
    expect(status?.data.to).toEqual(note.to)
    expect(status?.data.cc).toEqual(note.cc)
    expect(status?.data.type).toEqual(StatusType.enum.Note)
    expect(status?.data.createdAt).toEqual(new Date(note.published).getTime())
  })

  it('adds litepub note into storage and returns note', async () => {
    const note = MockLitepubNote({ content: '<p>Hello</p>' })
    await createNoteJob(storage, {
      id: 'id',
      name: CREATE_NOTE_JOB_NAME,
      data: note
    })

    const status = await storage.getStatus({ statusId: note.id })
    if (status?.data.type !== StatusType.enum.Note) {
      fail('Stauts type must be note')
    }
    expect(status).toBeDefined()
    expect(status?.data.id).toEqual(note.id)
    expect(status?.data.text).toEqual('<p>Hello</p>')
    expect(status?.data.actorId).toEqual(note.attributedTo)
    expect(status?.data.to).toEqual(note.to)
    expect(status?.data.cc).toEqual(note.cc)
    expect(status?.data.type).toEqual(StatusType.enum.Note)
    expect(status?.data.createdAt).toEqual(new Date(note.published).getTime())
  })

  it('add status and attachments with status id into storage', async () => {
    const note = MockMastodonNote({
      content: 'Hello',
      documents: [
        MockImageDocument({ url: 'https://llun.dev/images/test1.jpg' }),
        MockImageDocument({
          url: 'https://llun.dev/images/test2.jpg',
          name: 'Second image'
        })
      ]
    })
    await createNoteJob(storage, {
      id: 'id',
      name: CREATE_NOTE_JOB_NAME,
      data: note
    })
    const status = await storage.getStatus({ statusId: note.id })
    if (status?.data.type !== StatusType.enum.Note) {
      fail('Stauts type must be note')
    }
    expect(status?.data.attachments.length).toEqual(2)
    expect(status?.data.attachments[0]).toMatchObject({
      statusId: note.id,
      mediaType: 'image/jpeg',
      name: '',
      url: 'https://llun.dev/images/test1.jpg',
      width: 2000,
      height: 1500
    })
    expect(status?.data.attachments[1]).toMatchObject({
      statusId: note.id,
      mediaType: 'image/jpeg',
      url: 'https://llun.dev/images/test2.jpg',
      width: 2000,
      height: 1500,
      name: 'Second image'
    })
  })

  it('does not add duplicate note into storage', async () => {
    const note = MockMastodonNote({
      id: `${actor1?.id}/statuses/post-1`,
      content: 'Test duplicate'
    })
    await createNoteJob(storage, {
      id: 'id',
      name: CREATE_NOTE_JOB_NAME,
      data: note
    })
    const status = await storage.getStatus({
      statusId: `${actor1?.id}/statuses/post-1`
    })
    expect(status).not.toEqual('Test duplicate')
  })

  it('get public profile and add non-exist actor to storage', async () => {
    const note = MockMastodonNote({
      from: FRIEND_ACTOR_ID,
      content: '<p>Hello</p>'
    })
    await createNoteJob(storage, {
      id: 'id',
      name: CREATE_NOTE_JOB_NAME,
      data: note
    })
    const actor = await storage.getActorFromId({ id: FRIEND_ACTOR_ID })
    expect(actor).toBeDefined()
    expect(actor).toMatchObject({
      id: FRIEND_ACTOR_ID,
      username: 'friend',
      domain: 'somewhere.test',
      createdAt: expect.toBeNumber()
    })
  })

  it('adds note with single content map when contentMap is array', async () => {
    const note = MockMastodonNote({
      content: '<p>Hello</p>',
      contentMap: ['<p>Hello</p>']
    })
    await createNoteJob(storage, {
      id: 'id',
      name: CREATE_NOTE_JOB_NAME,
      data: note
    })
    const status = await storage.getStatus({ statusId: note.id })
    if (status?.data.type !== StatusType.enum.Note) {
      fail('Stauts type must be note')
    }
    expect(status.data.text).toEqual('<p>Hello</p>')
  })

  it('adds note with content is array from wordpress', async () => {
    const note = MockMastodonNote({
      content: ['<p>Hello</p>'],
      contentMap: {}
    })
    await createNoteJob(storage, {
      id: 'id',
      name: CREATE_NOTE_JOB_NAME,
      data: note
    })
    const status = await storage.getStatus({ statusId: note.id })
    if (status?.data.type !== StatusType.enum.Note) {
      fail('Stauts type must be note')
    }
    expect(status.data.text).toEqual('<p>Hello</p>')
  })
})
