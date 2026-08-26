import { NextRequest } from 'next/server'

import { POST } from './route'

const MEDIA_URL = 'https://llun.test/api/v1/files/a1b2c3d4e5f60718.jpg'
const HEADER_MEDIA_URL = 'https://llun.test/api/v1/files/0718a1b2c3d4e5f6.jpg'

const mockCurrentActor: {
  id: string
  domain: string
  iconUrl?: string
  headerImageUrl?: string
} = {
  id: 'https://llun.test/users/llun',
  domain: 'llun.test'
}
const mockDatabase = {
  updateActor: vi.fn()
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

describe('POST /api/v1/accounts/profile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDatabase.updateActor.mockResolvedValue(null)
    delete mockCurrentActor.iconUrl
    delete mockCurrentActor.headerImageUrl
  })

  const createRequest = (fields: Record<string, string>) => {
    const form = new FormData()
    for (const [key, value] of Object.entries(fields)) {
      form.append(key, value)
    }
    return new NextRequest('https://llun.test/api/v1/accounts/profile', {
      method: 'POST',
      headers: { origin: 'https://llun.test' },
      body: form
    })
  }

  const post = (fields: Record<string, string>) =>
    POST(createRequest(fields), { params: Promise.resolve({}) })

  describe('profile image URLs', () => {
    it('stores a media URL this instance serves', async () => {
      const response = await post({
        iconUrl: MEDIA_URL,
        headerImageUrl: HEADER_MEDIA_URL
      })

      expect(response.status).toBe(307)
      expect(mockDatabase.updateActor).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: mockCurrentActor.id,
          iconUrl: MEDIA_URL,
          headerImageUrl: HEADER_MEDIA_URL
        })
      )
    })

    it.each([
      {
        description: 'a URL on somebody else’s host',
        value: 'https://evil.example/api/v1/files/abc.jpg'
      },
      {
        description: 'a javascript: URL',
        value: 'javascript://llun.test/%0aalert(document.domain)'
      },
      {
        description: 'a data: URL',
        value: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='
      },
      {
        description: 'a URL naming an internal address',
        value: 'http://169.254.169.254/api/v1/files/abc.jpg'
      },
      {
        description: 'a traversing media path',
        value: 'https://llun.test/api/v1/files/..%2f..%2fsecrets/env'
      }
    ])('refuses $description in iconUrl', async ({ value }) => {
      const response = await post({ iconUrl: value })

      expect(response.status).toBe(422)
      expect(mockDatabase.updateActor).not.toHaveBeenCalled()
    })

    it('refuses a rejected headerImageUrl even when iconUrl is fine', async () => {
      const response = await post({
        iconUrl: MEDIA_URL,
        headerImageUrl: 'https://evil.example/api/v1/files/abc.jpg'
      })

      expect(response.status).toBe(422)
      expect(mockDatabase.updateActor).not.toHaveBeenCalled()
    })

    it('refuses the whole request without writing any other field', async () => {
      // The form submits every field at once, so a refused image must not let
      // the name through — the user is redirected back to a page still showing
      // their old name, and a partial write would contradict it.
      const response = await post({
        name: 'New name',
        iconUrl: 'https://evil.example/api/v1/files/abc.jpg'
      })

      expect(response.status).toBe(422)
      expect(mockDatabase.updateActor).not.toHaveBeenCalled()
    })

    it('clears the stored image when the field is submitted empty', async () => {
      await post({ iconUrl: '', headerImageUrl: '' })

      expect(mockDatabase.updateActor).toHaveBeenCalledWith(
        expect.objectContaining({ iconUrl: null, headerImageUrl: null })
      )
    })

    it('leaves the stored images alone when neither field is submitted', async () => {
      await post({ name: 'New name' })

      const params = mockDatabase.updateActor.mock.calls[0][0]
      expect(params).not.toHaveProperty('iconUrl')
      expect(params).not.toHaveProperty('headerImageUrl')
    })
  })

  describe('a URL the actor already has stored', () => {
    // `/settings` is ONE form around name, summary, both images and privacy,
    // and `ImageUploadField` resubmits the stored URL untouched. Without this,
    // an actor carrying a URL stored before this rule existed could not save
    // anything on the page — editing only their display name would 422 the
    // whole form and lose the edit to a bare JSON body with no error UI.
    const STALE = 'https://gravatar.example/avatar/abc.jpg'

    it('lets an unrelated field be saved without touching the image', async () => {
      mockCurrentActor.iconUrl = STALE
      const response = await post({ name: 'New name', iconUrl: STALE })

      expect(response.status).toBe(307)
      const params = mockDatabase.updateActor.mock.calls[0][0]
      expect(params).toMatchObject({ name: 'New name' })
      expect(params).not.toHaveProperty('iconUrl')
    })

    it('still refuses a different unacceptable URL', async () => {
      mockCurrentActor.iconUrl = STALE
      const response = await post({
        iconUrl: 'https://evil.example/api/v1/files/a.jpg'
      })

      expect(response.status).toBe(422)
      expect(mockDatabase.updateActor).not.toHaveBeenCalled()
    })

    it('still lets the stale URL be cleared', async () => {
      mockCurrentActor.iconUrl = STALE
      await post({ iconUrl: '' })

      expect(mockDatabase.updateActor).toHaveBeenCalledWith(
        expect.objectContaining({ iconUrl: null })
      )
    })
  })

  it('accepts a media URL on a trusted alias host', async () => {
    // A multi-domain instance mints media URLs on the OWNING actor's domain,
    // so the route has to hand `getConfig()`'s trustedHosts to the validator.
    const aliasUrl = 'https://alias.llun.test/api/v1/files/abc.jpg'
    await post({ iconUrl: aliasUrl })

    expect(mockDatabase.updateActor).toHaveBeenCalledWith(
      expect.objectContaining({ iconUrl: aliasUrl })
    )
  })

  it('clears one image while setting the other', async () => {
    mockCurrentActor.headerImageUrl = HEADER_MEDIA_URL
    await post({ iconUrl: MEDIA_URL, headerImageUrl: '' })

    expect(mockDatabase.updateActor).toHaveBeenCalledWith(
      expect.objectContaining({ iconUrl: MEDIA_URL, headerImageUrl: null })
    )
  })

  describe('fields the settings form does not own', () => {
    // `updateActor` persists all four, so accepting them here let any
    // signed-in user rewrite the public key and inbox endpoints their own
    // actor publishes in its ActivityPub document.
    it.each([
      ['publicKey', 'attacker-supplied-key'],
      ['followersUrl', 'https://evil.example/followers'],
      ['inboxUrl', 'https://evil.example/inbox'],
      ['sharedInboxUrl', 'https://evil.example/inbox']
    ])('ignores %s', async (field, value) => {
      await post({ name: 'New name', [field]: value })

      expect(mockDatabase.updateActor).toHaveBeenCalledTimes(1)
      expect(mockDatabase.updateActor.mock.calls[0][0]).not.toHaveProperty(
        field
      )
    })
  })

  describe('the fields the settings form does own', () => {
    it('updates the name and summary', async () => {
      await post({ name: 'New name', summary: 'New summary' })

      expect(mockDatabase.updateActor).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'New name', summary: 'New summary' })
      )
    })

    it.each<{
      description: string
      fields: Record<string, string>
      expected: boolean
    }>([
      {
        description: 'a checked box',
        fields: { manuallyApprovesFollowers: 'on' },
        expected: true
      },
      {
        description: 'an unchecked box carrying its marker',
        fields: { manuallyApprovesFollowers_marker: 'true' },
        expected: false
      }
    ])('reads $description', async ({ fields, expected }) => {
      await post(fields)

      expect(mockDatabase.updateActor).toHaveBeenCalledWith(
        expect.objectContaining({ manuallyApprovesFollowers: expected })
      )
    })

    it('updates the post line limit', async () => {
      await post({ postLineLimit: '10' })

      expect(mockDatabase.updateActor).toHaveBeenCalledWith(
        expect.objectContaining({ postLineLimit: 10 })
      )
    })
  })
})
