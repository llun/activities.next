import { NextRequest } from 'next/server'

import { POST } from './route'

const MEDIA_URL = 'https://llun.test/api/v1/files/a1b2c3d4e5f60718.jpg'

const mockCurrentActor = {
  id: 'https://llun.test/users/llun',
  domain: 'llun.test',
  account: { id: 'account-1' }
}
const mockDatabase = {
  updateAccountImage: vi.fn()
}

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn().mockReturnValue({
    host: 'llun.test',
    trustedHosts: ['alias.llun.test']
  })
}))

vi.mock('@/lib/services/guards/AuthenticatedGuard', () => ({
  AuthenticatedGuard:
    (
      handle: (
        req: NextRequest,
        context: {
          database: typeof mockDatabase
          currentActor: typeof mockCurrentActor
          params: Promise<object>
        }
      ) => Promise<Response> | Response
    ) =>
    (req: NextRequest, context: { params: Promise<object> }) =>
      handle(req, {
        database: mockDatabase,
        currentActor: mockCurrentActor,
        params: context.params
      })
}))

describe('POST /api/v1/accounts/image', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDatabase.updateAccountImage.mockResolvedValue(undefined)
  })

  const post = (fields: Record<string, string>) => {
    const form = new FormData()
    for (const [key, value] of Object.entries(fields)) {
      form.append(key, value)
    }
    const req = new NextRequest('https://llun.test/api/v1/accounts/image', {
      method: 'POST',
      headers: { origin: 'https://llun.test' },
      body: form
    })
    return POST(req, { params: Promise.resolve({}) })
  }

  it('stores a media URL this instance serves', async () => {
    const response = await post({ iconUrl: MEDIA_URL })

    expect(response.headers.get('location')).toBe('https://llun.test/account')
    expect(mockDatabase.updateAccountImage).toHaveBeenCalledWith({
      accountId: 'account-1',
      iconUrl: MEDIA_URL
    })
  })

  it.each([
    {
      description: 'a URL on somebody else’s host',
      value: 'https://evil.example/api/v1/files/abc.jpg'
    },
    // `z.string().url()`, which this route used before, accepts all three of
    // these in Zod 4 — the shape check alone never refused them.
    {
      description: 'a javascript: URL',
      value: 'javascript://llun.test/%0aalert(document.domain)'
    },
    {
      description: 'a data: URL',
      value: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='
    },
    { description: 'a file: URL', value: 'file:///etc/passwd' }
  ])('refuses $description', async ({ value }) => {
    const response = await post({ iconUrl: value })

    expect(response.headers.get('location')).toBe(
      'https://llun.test/account?error=Invalid+image+URL'
    )
    expect(mockDatabase.updateAccountImage).not.toHaveBeenCalled()
  })

  it.each<{ description: string; fields: Record<string, string> }>([
    { description: 'an empty value', fields: { iconUrl: '' } },
    { description: 'no value at all', fields: {} }
  ])('clears the stored image for $description', async ({ fields }) => {
    await post(fields)

    expect(mockDatabase.updateAccountImage).toHaveBeenCalledWith({
      accountId: 'account-1',
      iconUrl: null
    })
  })
})
