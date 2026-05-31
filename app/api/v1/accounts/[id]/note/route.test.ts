import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { urlToId } from '@/lib/utils/urlToId'

import { POST as updateNote } from './route'

jest.mock('@/lib/config', () => ({
  getBaseURL: jest.fn().mockReturnValue('https://llun.test'),
  getConfig: jest.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

const mockGetServerSession = jest.fn()
jest.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
jest.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

jest.mock('next/headers', () => ({
  cookies: jest.fn().mockResolvedValue({
    get: jest.fn().mockReturnValue(undefined)
  })
}))

jest.mock('better-auth/oauth2', () => ({
  verifyAccessToken: jest.fn()
}))

describe('POST /api/v1/accounts/:id/note', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
  })

  afterAll(async () => {
    if (!database) return
    mockDatabase = null
    await database.destroy()
  })

  beforeEach(() => {
    jest.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
  })

  const callNote = (body?: { contentType: string; payload: string }) =>
    updateNote(
      new NextRequest(
        `https://llun.test/api/v1/accounts/${urlToId(ACTOR2_ID)}/note`,
        {
          method: 'POST',
          headers: {
            Origin: 'https://llun.test',
            ...(body ? { 'Content-Type': body.contentType } : {})
          },
          ...(body ? { body: body.payload } : {})
        }
      ),
      { params: Promise.resolve({ id: urlToId(ACTOR2_ID) }) }
    )

  it('stores the comment from a JSON body and returns it in the relationship', async () => {
    const response = await callNote({
      contentType: 'application/json',
      payload: JSON.stringify({ comment: 'A private note from JSON' })
    })

    expect(response.status).toBe(200)
    const relationship = await response.json()
    expect(relationship.note).toBe('A private note from JSON')

    await expect(
      database.getAccountNote({ actorId: ACTOR1_ID, targetActorId: ACTOR2_ID })
    ).resolves.toBe('A private note from JSON')
  })

  it('stores the comment from a urlencoded body', async () => {
    const response = await callNote({
      contentType: 'application/x-www-form-urlencoded',
      payload: `comment=${encodeURIComponent('A private note from form')}`
    })

    expect(response.status).toBe(200)
    const relationship = await response.json()
    expect(relationship.note).toBe('A private note from form')

    await expect(
      database.getAccountNote({ actorId: ACTOR1_ID, targetActorId: ACTOR2_ID })
    ).resolves.toBe('A private note from form')
  })

  it('returns 404 for a note on an account that does not exist', async () => {
    const unknownActorId = 'https://remote.test/users/never-seen-here'
    const response = await updateNote(
      new NextRequest(
        `https://llun.test/api/v1/accounts/${urlToId(unknownActorId)}/note`,
        {
          method: 'POST',
          headers: {
            Origin: 'https://llun.test',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ comment: 'note for a ghost' })
        }
      ),
      { params: Promise.resolve({ id: urlToId(unknownActorId) }) }
    )

    expect(response.status).toBe(404)
    await expect(
      database.getAccountNote({
        actorId: ACTOR1_ID,
        targetActorId: unknownActorId
      })
    ).resolves.toBe('')
  })

  it('returns 422 for a malformed JSON body', async () => {
    const response = await updateNote(
      new NextRequest(
        `https://llun.test/api/v1/accounts/${urlToId(ACTOR2_ID)}/note`,
        {
          method: 'POST',
          headers: {
            Origin: 'https://llun.test',
            'Content-Type': 'application/json'
          },
          body: '{ broken json'
        }
      ),
      { params: Promise.resolve({ id: urlToId(ACTOR2_ID) }) }
    )

    expect(response.status).toBe(422)
  })

  it('returns 422 for a comment over the length limit', async () => {
    const response = await updateNote(
      new NextRequest(
        `https://llun.test/api/v1/accounts/${urlToId(ACTOR2_ID)}/note`,
        {
          method: 'POST',
          headers: {
            Origin: 'https://llun.test',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ comment: 'x'.repeat(2001) })
        }
      ),
      { params: Promise.resolve({ id: urlToId(ACTOR2_ID) }) }
    )

    expect(response.status).toBe(422)
  })

  it('clears the note when an empty comment is sent', async () => {
    await callNote({
      contentType: 'application/json',
      payload: JSON.stringify({ comment: 'to be cleared' })
    })

    const response = await callNote({
      contentType: 'application/json',
      payload: JSON.stringify({ comment: '' })
    })

    expect(response.status).toBe(200)
    const relationship = await response.json()
    expect(relationship.note).toBe('')

    await expect(
      database.getAccountNote({ actorId: ACTOR1_ID, targetActorId: ACTOR2_ID })
    ).resolves.toBe('')
  })
})
