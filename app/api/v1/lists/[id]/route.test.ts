import { NextRequest } from 'next/server'

import { PUT } from './route'

const mockDatabase = {
  updateList: vi.fn()
}
const mockCurrentActor = {
  id: 'https://local.test/users/me',
  domain: 'local.test'
}

vi.mock('@/lib/services/guards/OAuthGuard', () => ({
  OAuthGuard:
    (
      _scopes: unknown,
      handle: (
        req: NextRequest,
        context: {
          database: typeof mockDatabase
          currentActor: typeof mockCurrentActor
          params: Promise<{ id: string }>
        }
      ) => Promise<Response> | Response
    ) =>
    (req: NextRequest, context: { params: Promise<{ id: string }> }) =>
      handle(req, {
        database: mockDatabase,
        currentActor: mockCurrentActor,
        params: context.params
      }),
  OAuthGuardAnyScope:
    (
      _scopes: unknown,
      handle: (
        req: NextRequest,
        context: {
          database: typeof mockDatabase
          currentActor: typeof mockCurrentActor
          params: Promise<{ id: string }>
        }
      ) => Promise<Response> | Response
    ) =>
    (req: NextRequest, context: { params: Promise<{ id: string }> }) =>
      handle(req, {
        database: mockDatabase,
        currentActor: mockCurrentActor,
        params: context.params
      })
}))

const LIST_ID = 'list-123'

const createFormRequest = (body: string) =>
  new NextRequest(`https://local.test/api/v1/lists/${LIST_ID}`, {
    method: 'PUT',
    body,
    headers: { 'content-type': 'application/x-www-form-urlencoded' }
  })

const createMultipartRequest = (form: FormData) => {
  const request = new NextRequest(
    `https://local.test/api/v1/lists/${LIST_ID}`,
    {
      method: 'PUT',
      headers: { 'content-type': 'multipart/form-data; boundary=----test' }
    }
  )
  // Synthetic NextRequest bodies don't parse multipart, so stub formData().
  Object.defineProperty(request, 'formData', {
    value: vi.fn().mockResolvedValue(form)
  })
  return request
}

describe('PUT /api/v1/lists/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDatabase.updateList.mockImplementation(async (input) => ({
      id: input.id,
      title: input.title ?? 'Existing',
      repliesPolicy: input.repliesPolicy ?? 'list',
      exclusive: input.exclusive ?? false
    }))
  })

  it('updates the list from a urlencoded body with exclusive=false', async () => {
    const response = await PUT(
      createFormRequest('title=Renamed&exclusive=false'),
      {
        params: Promise.resolve({ id: LIST_ID })
      }
    )

    expect(response.status).toBe(200)
    expect(mockDatabase.updateList).toHaveBeenCalledWith(
      expect.objectContaining({
        id: LIST_ID,
        actorId: mockCurrentActor.id,
        title: 'Renamed',
        exclusive: false
      })
    )
  })

  it.each([
    ['1', true],
    ['true', true],
    ['0', false],
    ['false', false]
  ])('coerces a urlencoded exclusive=%s to %s', async (value, expected) => {
    await PUT(createFormRequest(`title=Renamed&exclusive=${value}`), {
      params: Promise.resolve({ id: LIST_ID })
    })

    expect(mockDatabase.updateList).toHaveBeenCalledWith(
      expect.objectContaining({ exclusive: expected })
    )
  })

  it('updates the list from a multipart body with exclusive=false', async () => {
    const form = new FormData()
    form.append('title', 'Renamed')
    form.append('exclusive', 'false')

    const response = await PUT(createMultipartRequest(form), {
      params: Promise.resolve({ id: LIST_ID })
    })

    expect(response.status).toBe(200)
    expect(mockDatabase.updateList).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Renamed', exclusive: false })
    )
  })
})
