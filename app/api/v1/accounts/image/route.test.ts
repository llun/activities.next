import { NextRequest } from 'next/server'

import { POST } from './route'

const MEDIA_URL = 'https://llun.test/api/v1/files/a1b2c3d4e5f60718.jpg'

const mockCurrentActor: {
  id: string
  domain: string
  account: { id: string; iconUrl?: string | null }
} = {
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
    delete mockCurrentActor.account.iconUrl
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

  it('accepts a media URL on a trusted alias host', async () => {
    const aliasUrl = 'https://alias.llun.test/api/v1/files/abc.jpg'
    await post({ iconUrl: aliasUrl })

    expect(mockDatabase.updateAccountImage).toHaveBeenCalledWith({
      accountId: 'account-1',
      iconUrl: aliasUrl
    })
  })

  it('sets the first avatar on an account that has never had one', () => {
    // `accounts.iconUrl` is nullable and the domain type carries the DB's
    // `null` through, so this — not `undefined` — is the state of every new
    // account. It is the most common path through this route, and a stored-value
    // guard that dereferenced the null instead of testing truthiness would 500.
    mockCurrentActor.account.iconUrl = null
    return post({ iconUrl: MEDIA_URL }).then(() => {
      expect(mockDatabase.updateAccountImage).toHaveBeenCalledWith({
        accountId: 'account-1',
        iconUrl: MEDIA_URL
      })
    })
  })

  describe('a URL the account already has stored', () => {
    const STALE = 'https://gravatar.example/avatar/abc.jpg'

    it('writes nothing rather than refusing or clearing it', async () => {
      // `undefined` means "already stored". `updateAccountImage` always
      // writes, so it must be skipped — passing the value through would clear
      // the image the form was resubmitting unchanged.
      mockCurrentActor.account.iconUrl = STALE
      const response = await post({ iconUrl: STALE })

      expect(response.headers.get('location')).toBe('https://llun.test/account')
      expect(mockDatabase.updateAccountImage).not.toHaveBeenCalled()
    })

    it('still lets the stale URL be cleared', async () => {
      mockCurrentActor.account.iconUrl = STALE
      await post({ iconUrl: '' })

      expect(mockDatabase.updateAccountImage).toHaveBeenCalledWith({
        accountId: 'account-1',
        iconUrl: null
      })
    })
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
