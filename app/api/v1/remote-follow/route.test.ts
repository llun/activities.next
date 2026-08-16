import { NextRequest } from 'next/server'

import { Actor } from '@/lib/types/domain/actor'

import { GET } from './route'

interface MockDatabase {
  getActorFromUsername: ReturnType<typeof vi.fn>
}

let mockDatabase: MockDatabase | null = null

vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('@/lib/activities/getWebfingerDocument', () => ({
  getWebfingerSubscribeTemplate: vi.fn()
}))

vi.mock('@/lib/services/federation/domainPolicy', () => ({
  canFederateWithDomain: vi.fn()
}))

const { getWebfingerSubscribeTemplate } = await vi.importMock<
  typeof import('@/lib/activities/getWebfingerDocument')
>('@/lib/activities/getWebfingerDocument')
const { canFederateWithDomain } = await vi.importMock<
  typeof import('@/lib/services/federation/domainPolicy')
>('@/lib/services/federation/domainPolicy')

const localActor = {
  id: 'https://llun.test/users/local',
  username: 'local',
  domain: 'llun.test',
  privateKey: 'private-key'
} as Actor

const callRoute = (params: Record<string, string>) => {
  const url = new URL('https://llun.test/api/v1/remote-follow')
  Object.entries(params).forEach(([key, value]) =>
    url.searchParams.set(key, value)
  )
  return GET(new NextRequest(url), { params: Promise.resolve({}) })
}

describe('GET /api/v1/remote-follow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDatabase = {
      getActorFromUsername: vi.fn().mockResolvedValue(localActor)
    }
    vi.mocked(canFederateWithDomain).mockResolvedValue(true)
    vi.mocked(getWebfingerSubscribeTemplate).mockResolvedValue(null)
  })

  it('substitutes the local account into the advertised template', async () => {
    vi.mocked(getWebfingerSubscribeTemplate).mockResolvedValue(
      'https://remote.test/authorize_interaction?uri={uri}'
    )

    const response = await callRoute({
      account: 'visitor@remote.test',
      target: 'local@llun.test'
    })

    expect(response.status).toEqual(200)
    expect(await response.json()).toEqual({
      url: 'https://remote.test/authorize_interaction?uri=local%40llun.test'
    })
    expect(getWebfingerSubscribeTemplate).toHaveBeenCalledWith({
      account: 'visitor@remote.test'
    })
  })

  it('substitutes into a template with a different path and extra params', async () => {
    vi.mocked(getWebfingerSubscribeTemplate).mockResolvedValue(
      'https://remote.test/ostatus_subscribe?acct={uri}&source=web'
    )

    const response = await callRoute({
      account: 'visitor@remote.test',
      target: 'local@llun.test'
    })

    expect(await response.json()).toEqual({
      url: 'https://remote.test/ostatus_subscribe?acct=local%40llun.test&source=web'
    })
  })

  it.each([
    {
      description: 'falls back when the server advertises no template',
      template: null
    },
    {
      description: 'falls back when the template has no uri placeholder',
      template: 'https://remote.test/authorize_interaction'
    },
    {
      description: 'falls back when the template is not https',
      template: 'javascript:alert({uri})'
    },
    {
      description: 'falls back when the template carries credentials',
      template: 'https://user:pass@remote.test/authorize?uri={uri}'
    }
  ])('$description', async ({ template }) => {
    vi.mocked(getWebfingerSubscribeTemplate).mockResolvedValue(template)

    const response = await callRoute({
      account: 'visitor@remote.test',
      target: 'local@llun.test'
    })

    expect(response.status).toEqual(200)
    expect(await response.json()).toEqual({
      url: 'https://remote.test/authorize_interaction?uri=local%40llun.test'
    })
  })

  it('skips the webfinger lookup for a bare domain', async () => {
    const response = await callRoute({
      account: 'remote.test',
      target: 'local@llun.test'
    })

    expect(await response.json()).toEqual({
      url: 'https://remote.test/authorize_interaction?uri=local%40llun.test'
    })
    expect(getWebfingerSubscribeTemplate).not.toHaveBeenCalled()
  })

  it.each([
    {
      description: 'accepts a leading at sign',
      account: '@visitor@remote.test'
    },
    { description: 'accepts an acct uri', account: 'acct:visitor@remote.test' }
  ])('$description', async ({ account }) => {
    const response = await callRoute({ account, target: 'local@llun.test' })

    expect(response.status).toEqual(200)
    expect(getWebfingerSubscribeTemplate).toHaveBeenCalledWith({
      account: 'visitor@remote.test'
    })
  })

  it.each([
    {
      description: 'rejects a missing account',
      params: { target: 'local@llun.test' }
    },
    {
      description: 'rejects a missing target',
      params: { account: 'visitor@remote.test' }
    },
    {
      description: 'rejects an empty account',
      params: { account: '   ', target: 'local@llun.test' }
    },
    {
      description: 'rejects an over long account',
      params: {
        account: `visitor@${'a'.repeat(400)}.test`,
        target: 'local@llun.test'
      }
    },
    {
      description: 'rejects a domain carrying a path',
      params: { account: 'remote.test/evil', target: 'local@llun.test' }
    },
    {
      description: 'rejects a domain carrying credentials',
      params: { account: 'user:pass@remote.test', target: 'local@llun.test' }
    },
    {
      description: 'rejects a single label domain',
      params: { account: 'localhost', target: 'local@llun.test' }
    },
    {
      description: 'rejects a malformed target',
      params: { account: 'visitor@remote.test', target: 'not-a-handle' }
    }
  ])('$description', async ({ params }) => {
    const response = await callRoute(params as Record<string, string>)

    expect(response.status).toEqual(400)
  })

  it('returns not found when the target is not hosted here', async () => {
    mockDatabase?.getActorFromUsername.mockResolvedValue(null)

    const response = await callRoute({
      account: 'visitor@remote.test',
      target: 'someone@elsewhere.test'
    })

    expect(response.status).toEqual(404)
  })

  it('returns not found when the target is a remote actor cached here', async () => {
    mockDatabase?.getActorFromUsername.mockResolvedValue({
      ...localActor,
      privateKey: undefined
    })

    const response = await callRoute({
      account: 'visitor@remote.test',
      target: 'someone@remote.test'
    })

    expect(response.status).toEqual(404)
    expect(getWebfingerSubscribeTemplate).not.toHaveBeenCalled()
  })

  it('returns forbidden for a domain the instance does not federate with', async () => {
    vi.mocked(canFederateWithDomain).mockResolvedValue(false)

    const response = await callRoute({
      account: 'visitor@blocked.test',
      target: 'local@llun.test'
    })

    expect(response.status).toEqual(403)
    expect(getWebfingerSubscribeTemplate).not.toHaveBeenCalled()
  })

  it('uses the stored actor casing for the substituted account', async () => {
    mockDatabase?.getActorFromUsername.mockResolvedValue({
      ...localActor,
      username: 'Local'
    })

    const response = await callRoute({
      account: 'remote.test',
      target: 'local@llun.test'
    })

    expect(await response.json()).toEqual({
      url: 'https://remote.test/authorize_interaction?uri=Local%40llun.test'
    })
  })
})
