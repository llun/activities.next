import { NextRequest } from 'next/server'

import { POST as DISMISS } from '@/app/api/v1/announcements/[id]/dismiss/route'
import {
  PUT as ADD_REACTION,
  DELETE as REMOVE_REACTION
} from '@/app/api/v1/announcements/[id]/reactions/[name]/route'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'

import { GET } from './route'

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

jest.mock('@/lib/config', () => ({
  getBaseURL: jest.fn().mockReturnValue('https://llun.test'),
  getConfig: jest.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

const HOUR = 60 * 60 * 1000

describe('/api/v1/announcements', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
  })

  afterAll(async () => {
    mockDatabase = null
    await database.destroy()
  })

  beforeEach(() => {
    jest.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
  })

  const getRequest = () =>
    new NextRequest('https://llun.test/api/v1/announcements')

  const writeRequest = (path: string, method: string) =>
    new NextRequest(`https://llun.test/api/v1/announcements/${path}`, {
      method,
      headers: { origin: 'https://llun.test' }
    })

  it('GET requires authentication', async () => {
    mockGetServerSession.mockResolvedValue(null)
    const response = await GET(getRequest(), { params: Promise.resolve({}) })
    expect(response.status).toBe(401)
  })

  it('GET returns an active announcement with read false', async () => {
    const created = await database.createAnnouncement({
      text: 'active announcement',
      published: true
    })

    const response = await GET(getRequest(), { params: Promise.resolve({}) })
    expect(response.status).toBe(200)
    const data = await response.json()
    const announcement = data.find(
      (item: { id: string }) => item.id === created.id
    )
    expect(announcement).toBeDefined()
    expect(announcement.read).toBe(false)
    expect(announcement.reactions).toEqual([])
  })

  it('GET does not return an unpublished announcement', async () => {
    const unpublished = await database.createAnnouncement({
      text: 'draft announcement',
      published: false
    })

    const response = await GET(getRequest(), { params: Promise.resolve({}) })
    const data = await response.json()
    expect(
      data.find((item: { id: string }) => item.id === unpublished.id)
    ).toBeUndefined()
  })

  it('GET does not return an out-of-window announcement', async () => {
    const now = Date.now()
    const future = await database.createAnnouncement({
      text: 'future announcement',
      published: true,
      startsAt: now + HOUR
    })

    const response = await GET(getRequest(), { params: Promise.resolve({}) })
    const data = await response.json()
    expect(
      data.find((item: { id: string }) => item.id === future.id)
    ).toBeUndefined()
  })

  it('dismiss marks the announcement read for a subsequent GET', async () => {
    const created = await database.createAnnouncement({
      text: 'dismiss me',
      published: true
    })

    const dismissResponse = await DISMISS(
      writeRequest(`${created.id}/dismiss`, 'POST'),
      { params: Promise.resolve({ id: created.id }) }
    )
    expect(dismissResponse.status).toBe(200)
    await expect(dismissResponse.json()).resolves.toEqual({})

    const response = await GET(getRequest(), { params: Promise.resolve({}) })
    const data = await response.json()
    const announcement = data.find(
      (item: { id: string }) => item.id === created.id
    )
    expect(announcement.read).toBe(true)
  })

  it('dismiss on an unknown announcement returns 404', async () => {
    const response = await DISMISS(
      writeRequest('missing-announcement/dismiss', 'POST'),
      { params: Promise.resolve({ id: 'missing-announcement' }) }
    )
    expect(response.status).toBe(404)
  })

  it('adding then removing a reaction is reflected in GET', async () => {
    const created = await database.createAnnouncement({
      text: 'react to me',
      published: true
    })
    const emoji = encodeURIComponent('🎉')

    const addResponse = await ADD_REACTION(
      writeRequest(`${created.id}/reactions/${emoji}`, 'PUT'),
      { params: Promise.resolve({ id: created.id, name: emoji }) }
    )
    expect(addResponse.status).toBe(200)
    await expect(addResponse.json()).resolves.toEqual({})

    const afterAdd = await GET(getRequest(), { params: Promise.resolve({}) })
    const addedData = await afterAdd.json()
    const withReaction = addedData.find(
      (item: { id: string }) => item.id === created.id
    )
    expect(withReaction.reactions).toEqual([
      expect.objectContaining({ name: '🎉', count: 1, me: true })
    ])

    const removeResponse = await REMOVE_REACTION(
      writeRequest(`${created.id}/reactions/${emoji}`, 'DELETE'),
      { params: Promise.resolve({ id: created.id, name: emoji }) }
    )
    expect(removeResponse.status).toBe(200)
    await expect(removeResponse.json()).resolves.toEqual({})

    const afterRemove = await GET(getRequest(), { params: Promise.resolve({}) })
    const removedData = await afterRemove.json()
    const withoutReaction = removedData.find(
      (item: { id: string }) => item.id === created.id
    )
    expect(withoutReaction.reactions).toEqual([])
  })

  it('reaction name longer than 100 characters returns 422', async () => {
    const created = await database.createAnnouncement({
      text: 'too long reaction',
      published: true
    })
    const longName = 'a'.repeat(101)

    const response = await ADD_REACTION(
      writeRequest(`${created.id}/reactions/${longName}`, 'PUT'),
      { params: Promise.resolve({ id: created.id, name: longName }) }
    )
    expect(response.status).toBe(422)
  })

  it('reaction on an unknown announcement returns 404', async () => {
    const response = await ADD_REACTION(
      writeRequest('missing-announcement/reactions/tada', 'PUT'),
      {
        params: Promise.resolve({ id: 'missing-announcement', name: 'tada' })
      }
    )
    expect(response.status).toBe(404)
  })
})
