import { NextRequest } from 'next/server'

import { DELETE, GET, PUT } from './route'

const mockDatabase = {
  getList: vi.fn(),
  updateList: vi.fn(),
  deleteList: vi.fn()
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

const createJsonRequest = (body: unknown) =>
  new NextRequest(`https://local.test/api/v1/lists/${LIST_ID}`, {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' }
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

  it('updates the list from a JSON body (regression)', async () => {
    const response = await PUT(
      createJsonRequest({ title: 'Renamed', exclusive: true }),
      { params: Promise.resolve({ id: LIST_ID }) }
    )

    expect(response.status).toBe(200)
    expect(mockDatabase.updateList).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Renamed', exclusive: true })
    )
  })

  it('passes replies_policy through and scopes the update to the signed-in actor', async () => {
    mockDatabase.updateList.mockResolvedValue({
      id: LIST_ID,
      title: 'Existing',
      repliesPolicy: 'none',
      exclusive: false
    })

    const response = await PUT(createJsonRequest({ replies_policy: 'none' }), {
      params: Promise.resolve({ id: LIST_ID })
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      id: LIST_ID,
      title: 'Existing',
      replies_policy: 'none',
      exclusive: false
    })
    expect(mockDatabase.updateList).toHaveBeenCalledWith({
      id: LIST_ID,
      actorId: mockCurrentActor.id,
      title: undefined,
      repliesPolicy: 'none',
      exclusive: undefined
    })
  })

  it.each([
    { description: 'a blank title', body: { title: '   ' } },
    {
      description: 'a title over 255 characters',
      body: { title: 'x'.repeat(256) }
    },
    {
      description: 'an unknown replies_policy',
      body: { replies_policy: 'everyone' }
    },
    { description: 'a numeric exclusive', body: { exclusive: 5 } }
  ])(
    'answers 422 without touching the list for $description',
    async ({ body }) => {
      const response = await PUT(createJsonRequest(body), {
        params: Promise.resolve({ id: LIST_ID })
      })

      expect(response.status).toBe(422)
      expect(mockDatabase.updateList).not.toHaveBeenCalled()
    }
  )

  it('answers 422 for an unparseable body', async () => {
    const response = await PUT(
      new NextRequest(`https://local.test/api/v1/lists/${LIST_ID}`, {
        method: 'PUT',
        body: '{',
        headers: { 'content-type': 'application/json' }
      }),
      { params: Promise.resolve({ id: LIST_ID }) }
    )

    expect(response.status).toBe(422)
    expect(mockDatabase.updateList).not.toHaveBeenCalled()
  })

  it('answers 404 when the database finds no list for the caller', async () => {
    mockDatabase.updateList.mockResolvedValue(null)

    const response = await PUT(createJsonRequest({ title: 'Renamed' }), {
      params: Promise.resolve({ id: LIST_ID })
    })

    expect(response.status).toBe(404)
  })
})

describe('GET /api/v1/lists/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const getRequest = () =>
    new NextRequest(`https://local.test/api/v1/lists/${LIST_ID}`)

  it("returns the caller's list in the Mastodon shape", async () => {
    mockDatabase.getList.mockResolvedValue({
      id: LIST_ID,
      actorId: mockCurrentActor.id,
      title: 'Friends',
      repliesPolicy: 'followed',
      exclusive: true,
      createdAt: 1,
      updatedAt: 2
    })

    const response = await GET(getRequest(), {
      params: Promise.resolve({ id: LIST_ID })
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      id: LIST_ID,
      title: 'Friends',
      replies_policy: 'followed',
      exclusive: true
    })
    expect(mockDatabase.getList).toHaveBeenCalledWith({
      id: LIST_ID,
      actorId: mockCurrentActor.id
    })
  })

  it('answers 404 when the database finds no list for the caller', async () => {
    mockDatabase.getList.mockResolvedValue(null)

    const response = await GET(getRequest(), {
      params: Promise.resolve({ id: LIST_ID })
    })

    expect(response.status).toBe(404)
  })
})

describe('DELETE /api/v1/lists/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const deleteRequest = () =>
    new NextRequest(`https://local.test/api/v1/lists/${LIST_ID}`, {
      method: 'DELETE'
    })

  it('deletes the list scoped to the signed-in actor and returns an empty object', async () => {
    mockDatabase.deleteList.mockResolvedValue(true)

    const response = await DELETE(deleteRequest(), {
      params: Promise.resolve({ id: LIST_ID })
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({})
    expect(mockDatabase.deleteList).toHaveBeenCalledWith({
      id: LIST_ID,
      actorId: mockCurrentActor.id
    })
  })

  it('answers 404 when the database deletes no list for the caller', async () => {
    mockDatabase.deleteList.mockResolvedValue(false)

    const response = await DELETE(deleteRequest(), {
      params: Promise.resolve({ id: LIST_ID })
    })

    expect(response.status).toBe(404)
  })
})
