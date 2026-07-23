import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { invalidateServerSettingsCache } from '@/lib/services/serverSettings'

import { GET, PATCH } from './route'

const holder = vi.hoisted(() => ({
  db: null as Database | null
}))

vi.mock('@/lib/database', () => ({
  getDatabase: () => holder.db
}))

vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: vi
    .fn()
    .mockResolvedValue({ user: { email: 'admin@test.llun.dev' } })
}))

vi.mock('@/lib/utils/getAdminFromSession', () => ({
  getAdminFromSession: vi
    .fn()
    .mockResolvedValue({ id: 'admin', defaultActorId: null })
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: () => 'https://test.llun.dev',
  getConfig: () => ({
    host: 'test.llun.dev',
    allowEmails: [],
    trustedHosts: []
  })
}))

const ORIGIN = 'https://test.llun.dev'
const URL_PATH = `${ORIGIN}/api/v1/admin/server_settings`
const ENV_KEYS = ['ACTIVITIES_SERVICE_NAME']

const patchRequest = (body: unknown) =>
  new NextRequest(URL_PATH, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify(body)
  })

describe('/api/v1/admin/server_settings', () => {
  let savedEnv: Record<string, string | undefined>

  beforeEach(async () => {
    savedEnv = {}
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key]
      delete process.env[key]
    }
    holder.db = getTestSQLDatabase()
    await holder.db.migrate()
  })

  afterEach(async () => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key]
      else process.env[key] = savedEnv[key]
    }
    await holder.db?.destroy()
  })

  it('returns resolved settings and lock metadata', async () => {
    const response = await GET(new NextRequest(URL_PATH), {
      params: Promise.resolve({})
    })
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.settings.posts.maxCharacters).toBe(500)
    expect(data.settings.federation.mode).toBe('open')
    expect(data.locks['posts.maxCharacters'].locked).toBe(false)
  })

  it('persists a valid PATCH and returns the updated view', async () => {
    const response = await PATCH(
      patchRequest({ 'posts.maxCharacters': 1500 }),
      {
        params: Promise.resolve({})
      }
    )
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.settings.posts.maxCharacters).toBe(1500)
    await expect(
      holder.db?.getServerSetting({ key: 'posts.maxCharacters' })
    ).resolves.toMatchObject({ value: 1500 })
  })

  it('rejects an invalid value with 422 and writes nothing', async () => {
    const response = await PATCH(patchRequest({ 'posts.maxCharacters': -1 }), {
      params: Promise.resolve({})
    })
    expect(response.status).toBe(422)

    const data = await response.json()
    expect(data.rejected).toContainEqual({
      key: 'posts.maxCharacters',
      reason: 'invalid'
    })
    await expect(
      holder.db?.getServerSetting({ key: 'posts.maxCharacters' })
    ).resolves.toBeNull()
  })

  it('rejects writes to an env-locked field with 422', async () => {
    process.env.ACTIVITIES_SERVICE_NAME = 'Env Name'
    invalidateServerSettingsCache(holder.db)

    const response = await PATCH(patchRequest({ 'instance.name': 'Changed' }), {
      params: Promise.resolve({})
    })
    expect(response.status).toBe(422)

    const data = await response.json()
    expect(data.rejected).toContainEqual({
      key: 'instance.name',
      reason: 'locked'
    })
  })

  it('forbids a non-admin caller with 403', async () => {
    const { getAdminFromSession } = await vi.importMock<
      typeof import('@/lib/utils/getAdminFromSession')
    >('@/lib/utils/getAdminFromSession')
    getAdminFromSession.mockResolvedValueOnce(null)

    const response = await GET(new NextRequest(URL_PATH), {
      params: Promise.resolve({})
    })
    expect(response.status).toBe(403)
  })
})
