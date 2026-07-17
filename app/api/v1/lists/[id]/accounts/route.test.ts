import { NextRequest } from 'next/server'

import { idToUrl } from '@/lib/utils/urlToId'

import { DELETE, GET, POST } from './route'

const mockDatabase = {
  getList: vi.fn(),
  getListAccounts: vi.fn(),
  addListAccounts: vi.fn(),
  removeListAccounts: vi.fn(),
  isCurrentActorFollowing: vi.fn()
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
  return {
    OAuthGuard: bypass,
    OAuthGuardAnyScope: bypass
  }
})

const LIST_ID = 'list-1'
const URL_BASE = `https://local.test/api/v1/lists/${LIST_ID}/accounts`

const params = () => ({ params: Promise.resolve({ id: LIST_ID }) })

describe('GET /api/v1/lists/:id/accounts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDatabase.getList.mockResolvedValue({ id: LIST_ID, title: 'Friends' })
    mockDatabase.getListAccounts.mockResolvedValue({
      accounts: [],
      nextMaxId: null,
      prevMinId: null
    })
  })

  it('defaults the page size to 40', async () => {
    const request = new NextRequest(URL_BASE)
    const response = await GET(request, params())
    expect(response.status).toBe(200)
    expect(mockDatabase.getListAccounts).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 40 })
    )
  })

  it.each([
    { field: 'min_id' as const, slot: 'minId', other: 'sinceId' },
    { field: 'since_id' as const, slot: 'sinceId', other: 'minId' }
  ])(
    'routes $field alone to $slot without collapsing into $other',
    async ({ field, slot, other }) => {
      const request = new NextRequest(`${URL_BASE}?${field}=cursor-x`)
      const response = await GET(request, params())
      expect(response.status).toBe(200)
      const call = mockDatabase.getListAccounts.mock.calls[0][0] as Record<
        string,
        unknown
      >
      expect(call[slot]).toBe('cursor-x')
      // The absent cursor is passed as null (query default), never collapsed
      // into the other slot — so min_id gets adjacent-page and since_id gets
      // newest-slice semantics.
      expect(call[other]).toBeNull()
    }
  )

  it('returns all members without pagination when limit=0', async () => {
    mockDatabase.getListAccounts.mockResolvedValue({
      accounts: [{ id: 'a1' }, { id: 'a2' }],
      nextMaxId: 'row-2',
      prevMinId: 'row-1'
    })
    const request = new NextRequest(`${URL_BASE}?limit=0`)
    const response = await GET(request, params())
    expect(response.status).toBe(200)
    expect(mockDatabase.getListAccounts).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 0 })
    )
    expect(response.headers.get('Link')).toBeNull()
    expect(await response.json()).toHaveLength(2)
  })
})

describe('POST /api/v1/lists/:id/accounts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDatabase.getList.mockResolvedValue({ id: LIST_ID, title: 'Friends' })
    mockDatabase.addListAccounts.mockResolvedValue(undefined)
    mockDatabase.removeListAccounts.mockResolvedValue(undefined)
    mockDatabase.isCurrentActorFollowing.mockResolvedValue(true)
  })

  it('requires an accepted follow before adding an account', async () => {
    mockDatabase.isCurrentActorFollowing.mockResolvedValue(false)
    const request = new NextRequest(URL_BASE, {
      method: 'POST',
      body: JSON.stringify({ account_ids: ['acc1'] }),
      headers: { 'content-type': 'application/json' }
    })

    const response = await POST(request, params())

    expect(response.status).toBe(404)
    expect(mockDatabase.addListAccounts).not.toHaveBeenCalled()
  })

  it('checks the follow relationship for every target account', async () => {
    const request = new NextRequest(URL_BASE, {
      method: 'POST',
      body: JSON.stringify({ account_ids: ['acc1', 'acc2'] }),
      headers: { 'content-type': 'application/json' }
    })

    const response = await POST(request, params())

    expect(response.status).toBe(200)
    expect(mockDatabase.isCurrentActorFollowing).toHaveBeenCalledWith({
      currentActorId: mockCurrentActor.id,
      followingActorId: idToUrl('acc1')
    })
    expect(mockDatabase.isCurrentActorFollowing).toHaveBeenCalledWith({
      currentActorId: mockCurrentActor.id,
      followingActorId: idToUrl('acc2')
    })
  })

  it('adds accounts from a urlencoded bracket-array body', async () => {
    const request = new NextRequest(URL_BASE, {
      method: 'POST',
      body: 'account_ids[]=acc1&account_ids[]=acc2',
      headers: { 'content-type': 'application/x-www-form-urlencoded' }
    })

    const response = await POST(request, params())

    expect(response.status).toBe(200)
    expect(mockDatabase.addListAccounts).toHaveBeenCalledWith({
      listId: LIST_ID,
      actorId: mockCurrentActor.id,
      targetActorIds: [idToUrl('acc1'), idToUrl('acc2')]
    })
  })

  it('adds accounts from a multipart bracket-array body', async () => {
    const form = new FormData()
    form.append('account_ids[]', 'acc1')
    form.append('account_ids[]', 'acc2')
    const request = new NextRequest(URL_BASE, {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=test-boundary' }
    })
    Object.defineProperty(request, 'formData', {
      value: vi.fn().mockResolvedValue(form)
    })

    const response = await POST(request, params())

    expect(response.status).toBe(200)
    expect(mockDatabase.addListAccounts).toHaveBeenCalledWith({
      listId: LIST_ID,
      actorId: mockCurrentActor.id,
      targetActorIds: [idToUrl('acc1'), idToUrl('acc2')]
    })
  })

  it('adds accounts from a JSON body', async () => {
    const request = new NextRequest(URL_BASE, {
      method: 'POST',
      body: JSON.stringify({ account_ids: ['acc1', 'acc2'] }),
      headers: { 'content-type': 'application/json' }
    })

    const response = await POST(request, params())

    expect(response.status).toBe(200)
    expect(mockDatabase.addListAccounts).toHaveBeenCalledWith({
      listId: LIST_ID,
      actorId: mockCurrentActor.id,
      targetActorIds: [idToUrl('acc1'), idToUrl('acc2')]
    })
  })

  it('returns 404 when the list does not exist', async () => {
    mockDatabase.getList.mockResolvedValue(null)
    const request = new NextRequest(URL_BASE, {
      method: 'POST',
      body: 'account_ids[]=acc1',
      headers: { 'content-type': 'application/x-www-form-urlencoded' }
    })

    const response = await POST(request, params())

    expect(response.status).toBe(404)
    expect(mockDatabase.addListAccounts).not.toHaveBeenCalled()
  })

  it('returns 422 when no account ids are supplied', async () => {
    const request = new NextRequest(URL_BASE, {
      method: 'POST',
      body: '',
      headers: { 'content-type': 'application/x-www-form-urlencoded' }
    })

    const response = await POST(request, params())

    expect(response.status).toBe(422)
    expect(mockDatabase.addListAccounts).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/v1/lists/:id/accounts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDatabase.getList.mockResolvedValue({ id: LIST_ID, title: 'Friends' })
    mockDatabase.addListAccounts.mockResolvedValue(undefined)
    mockDatabase.removeListAccounts.mockResolvedValue(undefined)
  })

  it('removes accounts read from the query string only (masto.js DELETE)', async () => {
    const request = new NextRequest(
      `${URL_BASE}?account_ids[]=acc1&account_ids[]=acc2`,
      { method: 'DELETE' }
    )

    const response = await DELETE(request, params())

    expect(response.status).toBe(200)
    expect(mockDatabase.removeListAccounts).toHaveBeenCalledWith({
      listId: LIST_ID,
      actorId: mockCurrentActor.id,
      targetActorIds: [idToUrl('acc1'), idToUrl('acc2')]
    })
  })

  it('removes accounts from a urlencoded body', async () => {
    const request = new NextRequest(URL_BASE, {
      method: 'DELETE',
      body: 'account_ids[]=acc1&account_ids[]=acc2',
      headers: { 'content-type': 'application/x-www-form-urlencoded' }
    })

    const response = await DELETE(request, params())

    expect(response.status).toBe(200)
    expect(mockDatabase.removeListAccounts).toHaveBeenCalledWith({
      listId: LIST_ID,
      actorId: mockCurrentActor.id,
      targetActorIds: [idToUrl('acc1'), idToUrl('acc2')]
    })
  })

  it('returns 422 when no account ids are supplied', async () => {
    const request = new NextRequest(URL_BASE, { method: 'DELETE' })

    const response = await DELETE(request, params())

    expect(response.status).toBe(422)
    expect(mockDatabase.removeListAccounts).not.toHaveBeenCalled()
  })
})
