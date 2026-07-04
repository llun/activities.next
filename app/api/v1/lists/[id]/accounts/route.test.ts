import { NextRequest } from 'next/server'

import { idToUrl } from '@/lib/utils/urlToId'

import { DELETE, POST } from './route'

const mockDatabase = {
  getList: vi.fn(),
  addListAccounts: vi.fn(),
  removeListAccounts: vi.fn()
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

describe('POST /api/v1/lists/:id/accounts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDatabase.getList.mockResolvedValue({ id: LIST_ID, title: 'Friends' })
    mockDatabase.addListAccounts.mockResolvedValue(undefined)
    mockDatabase.removeListAccounts.mockResolvedValue(undefined)
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
