import { NextRequest } from 'next/server'

import { POST } from './route'

const mockDatabase = {
  createList: vi.fn()
}
const mockCurrentActor = {
  id: 'https://local.test/users/me',
  domain: 'local.test'
}

vi.mock('@/lib/services/guards/OAuthGuard', () => {
  const bypass =
    (
      _scopes: unknown,
      handle: (
        req: NextRequest,
        context: {
          database: typeof mockDatabase
          currentActor: typeof mockCurrentActor
          params: Promise<Record<string, string>>
        }
      ) => Promise<Response> | Response
    ) =>
    (req: NextRequest, context: { params: Promise<Record<string, string>> }) =>
      handle(req, {
        database: mockDatabase,
        currentActor: mockCurrentActor,
        params: context.params
      })
  return {
    OAuthGuard: bypass,
    OAuthGuardAnyScope: bypass
  }
})

const createJsonRequest = (body: Record<string, unknown>) =>
  new NextRequest('https://local.test/api/v1/lists', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' }
  })

const createFormRequest = (body: string) =>
  new NextRequest('https://local.test/api/v1/lists', {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/x-www-form-urlencoded' }
  })

const invoke = (req: NextRequest) => POST(req, { params: Promise.resolve({}) })

describe('POST /api/v1/lists', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDatabase.createList.mockImplementation(
      ({
        title,
        repliesPolicy,
        exclusive
      }: {
        title: string
        repliesPolicy?: string
        exclusive?: boolean
      }) => ({
        id: 'list-1',
        title,
        repliesPolicy: repliesPolicy ?? 'list',
        exclusive: exclusive ?? false
      })
    )
  })

  it('creates a list with exclusive false from a urlencoded exclusive=false', async () => {
    const response = await invoke(
      createFormRequest('title=My+List&exclusive=false')
    )

    expect(response.status).toBe(200)
    // "false" must coerce to boolean false, not be treated as truthy.
    expect(mockDatabase.createList).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: mockCurrentActor.id,
        title: 'My List',
        exclusive: false
      })
    )
    const body = await response.json()
    expect(body.exclusive).toBe(false)
  })

  it.each([
    ['1', true],
    ['true', true],
    ['on', true],
    ['yes', true],
    ['0', false],
    ['false', false],
    ['off', false],
    ['no', false]
  ])('coerces a urlencoded exclusive=%s to %s', async (value, expected) => {
    const response = await invoke(
      createFormRequest(`title=My+List&exclusive=${value}`)
    )

    expect(response.status).toBe(200)
    expect(mockDatabase.createList).toHaveBeenCalledWith(
      expect.objectContaining({ exclusive: expected })
    )
  })

  it('creates a list from a JSON body (regression)', async () => {
    const response = await invoke(
      createJsonRequest({ title: 'JSON List', exclusive: true })
    )

    expect(response.status).toBe(200)
    expect(mockDatabase.createList).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: mockCurrentActor.id,
        title: 'JSON List',
        exclusive: true
      })
    )
    const body = await response.json()
    expect(body.title).toBe('JSON List')
    expect(body.exclusive).toBe(true)
  })
})
