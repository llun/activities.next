import { NextRequest } from 'next/server'

import { publishActorUpdate } from '@/lib/services/actors/actorUpdate'
import { queueProfileLinkVerification } from '@/lib/services/profile-links/queueProfileLinkVerification'
import { MockActor } from '@/lib/stub/actor'
import { ActorSettings } from '@/lib/types/database/rows'
import { Actor } from '@/lib/types/domain/actor'

import { PATCH, POST } from './route'

vi.mock('@/lib/services/actors/actorUpdate', () => ({
  publishActorUpdate: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@/lib/services/profile-links/queueProfileLinkVerification', () => ({
  queueProfileLinkVerification: vi.fn().mockResolvedValue(undefined)
}))

const MEDIA_URL = 'https://llun.test/api/v1/files/a1b2c3d4e5f60718.jpg'
const HEADER_MEDIA_URL = 'https://llun.test/api/v1/files/0718a1b2c3d4e5f6.jpg'

const mockCurrentActor: Actor = MockActor({
  id: 'https://llun.test/users/llun'
})
let mockSettings: Partial<ActorSettings> | undefined
// The actor as stored. The guard hands the route a partial session actor
// (no links), so a test that sets this one apart from mockCurrentActor checks
// that changes are measured against the stored actor.
let mockStoredActor: Actor | null = null
let mockStoredMissing = false

// Applies the params a profile save writes onto the actor, the way the
// database does, so the route sees the actor as saved.
const mockUpdateActor = vi.fn(
  async (params: Record<string, unknown>): Promise<Actor | null> => {
    const next: Record<string, unknown> = {
      ...(mockStoredActor ?? mockCurrentActor)
    }
    for (const key of [
      'name',
      'summary',
      'iconUrl',
      'headerImageUrl',
      'fields',
      'manuallyApprovesFollowers'
    ]) {
      if (!(key in params)) continue
      if (params[key] === null) delete next[key]
      else next[key] = params[key]
    }
    // The real updateActor writes these into actors.settings, which
    // getActorSettings reads back.
    for (const key of [
      'avatarDescription',
      'headerDescription',
      'showReplies',
      'showMedia',
      'showGallery',
      'showFitness'
    ]) {
      if (params[key] === undefined) continue
      mockSettings = { ...mockSettings, [key]: params[key] }
      // The saved row carries the tab flags too (getActorFromId reads them).
      if (key.startsWith('show')) next[key] = params[key]
    }
    return next as Actor
  }
)
// The actor as read under the save's row lock. Undefined means "the stored
// actor"; a test sets it apart from the stored one to model a save that landed
// between the route's pre-read and its own write.
let mockLockedBefore: Actor | null | undefined
const mockUpdateActorWithPrevious = vi.fn(
  async (params: Record<string, unknown>) => {
    const before =
      mockLockedBefore !== undefined
        ? mockLockedBefore
        : (mockStoredActor ?? mockCurrentActor)
    return { before, after: await mockUpdateActor(params) }
  }
)
const mockDatabase = {
  updateActorWithPrevious: mockUpdateActorWithPrevious,
  getActorFromId: vi.fn(async () =>
    mockStoredMissing ? null : (mockStoredActor ?? mockCurrentActor)
  ),
  getActorSettings: vi.fn(async () => mockSettings)
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
    mockSettings = undefined
    mockStoredActor = null
    mockStoredMissing = false
    mockLockedBefore = undefined
    delete mockCurrentActor.iconUrl
    delete mockCurrentActor.headerImageUrl
    delete mockCurrentActor.fields
    delete mockCurrentActor.name
    delete mockCurrentActor.summary
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

      expect(response.status).toBe(303)
      expect(mockDatabase.updateActorWithPrevious).toHaveBeenCalledWith(
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
      expect(mockDatabase.updateActorWithPrevious).not.toHaveBeenCalled()
    })

    it('refuses a rejected headerImageUrl even when iconUrl is fine', async () => {
      const response = await post({
        iconUrl: MEDIA_URL,
        headerImageUrl: 'https://evil.example/api/v1/files/abc.jpg'
      })

      expect(response.status).toBe(422)
      expect(mockDatabase.updateActorWithPrevious).not.toHaveBeenCalled()
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
      expect(mockDatabase.updateActorWithPrevious).not.toHaveBeenCalled()
    })

    it('clears the stored image when the field is submitted empty', async () => {
      await post({ iconUrl: '', headerImageUrl: '' })

      expect(mockDatabase.updateActorWithPrevious).toHaveBeenCalledWith(
        expect.objectContaining({ iconUrl: null, headerImageUrl: null })
      )
    })

    it('leaves the stored images alone when neither field is submitted', async () => {
      await post({ name: 'New name' })

      const params = mockDatabase.updateActorWithPrevious.mock.calls[0][0]
      expect(params).not.toHaveProperty('iconUrl')
      expect(params).not.toHaveProperty('headerImageUrl')
    })
  })

  describe('profile links', () => {
    it('saves the filled rows and drops the empty ones', async () => {
      const response = await post({
        'fields[0][name]': ' Blog ',
        'fields[0][value]': ' https://blog.example ',
        'fields[1][name]': '',
        'fields[1][value]': '',
        'fields[2][name]': 'Pronouns',
        'fields[2][value]': 'they/them'
      })

      expect(response.status).toBe(303)
      expect(mockDatabase.updateActorWithPrevious).toHaveBeenCalledWith(
        expect.objectContaining({
          fields: [
            { name: 'Blog', value: 'https://blog.example' },
            { name: 'Pronouns', value: 'they/them' }
          ]
        })
      )
    })

    it('clears the stored links when every row is emptied', async () => {
      await post({ 'fields[0][name]': '', 'fields[0][value]': '' })

      expect(mockDatabase.updateActorWithPrevious).toHaveBeenCalledWith(
        expect.objectContaining({ fields: [] })
      )
    })

    it('sends an Update(Person) when every stored link is removed, though the session actor has none', async () => {
      mockStoredActor = {
        ...mockCurrentActor,
        fields: [{ name: 'Blog', value: 'https://blog.example' }]
      }

      await post({ 'fields[0][name]': '', 'fields[0][value]': '' })

      expect(publishActorUpdate).toHaveBeenCalledTimes(1)
      expect(queueProfileLinkVerification).toHaveBeenCalledWith(
        expect.objectContaining({
          before: [{ name: 'Blog', value: 'https://blog.example' }],
          after: []
        })
      )
    })

    it('leaves the stored links alone when the form sends none', async () => {
      await post({ name: 'New name' })

      expect(
        mockDatabase.updateActorWithPrevious.mock.calls[0][0]
      ).not.toHaveProperty('fields')
    })

    it('queues the link check with the stored and the submitted fields', async () => {
      mockCurrentActor.fields = [{ name: 'Blog', value: 'https://old.example' }]

      await post({
        'fields[0][name]': 'Blog',
        'fields[0][value]': 'https://blog.example'
      })

      expect(queueProfileLinkVerification).toHaveBeenCalledWith({
        actorId: mockCurrentActor.id,
        before: [{ name: 'Blog', value: 'https://old.example' }],
        after: [{ name: 'Blog', value: 'https://blog.example' }],
        remote: false
      })
    })

    it('queues no link check and sends no Update when the actor is gone mid-save', async () => {
      mockUpdateActor.mockResolvedValueOnce(null)

      const response = await post({
        'fields[0][name]': 'Blog',
        'fields[0][value]': 'https://blog.example'
      })

      expect(response.status).toBe(303)
      expect(queueProfileLinkVerification).not.toHaveBeenCalled()
      expect(publishActorUpdate).not.toHaveBeenCalled()
    })

    it('does not queue the link check when the form sends no links', async () => {
      await post({ name: 'New name' })

      expect(queueProfileLinkVerification).not.toHaveBeenCalled()
    })

    it('refuses an invalid row without writing or federating anything', async () => {
      const response = await post({
        name: 'New name',
        'fields[0][name]': 'Blog'
      })

      expect(response.status).toBe(422)
      expect(mockDatabase.updateActorWithPrevious).not.toHaveBeenCalled()
      expect(publishActorUpdate).not.toHaveBeenCalled()
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

      expect(response.status).toBe(303)
      const params = mockDatabase.updateActorWithPrevious.mock.calls[0][0]
      expect(params).toMatchObject({ name: 'New name' })
      expect(params).not.toHaveProperty('iconUrl')
    })

    it('still refuses a different unacceptable URL', async () => {
      mockCurrentActor.iconUrl = STALE
      const response = await post({
        iconUrl: 'https://evil.example/api/v1/files/a.jpg'
      })

      expect(response.status).toBe(422)
      expect(mockDatabase.updateActorWithPrevious).not.toHaveBeenCalled()
    })

    it('still lets the stale URL be cleared', async () => {
      mockCurrentActor.iconUrl = STALE
      await post({ iconUrl: '' })

      expect(mockDatabase.updateActorWithPrevious).toHaveBeenCalledWith(
        expect.objectContaining({ iconUrl: null })
      )
    })
  })

  it('accepts a media URL on a trusted alias host', async () => {
    // A multi-domain instance mints media URLs on the OWNING actor's domain,
    // so the route has to hand `getConfig()`'s trustedHosts to the validator.
    const aliasUrl = 'https://alias.llun.test/api/v1/files/abc.jpg'
    await post({ iconUrl: aliasUrl })

    expect(mockDatabase.updateActorWithPrevious).toHaveBeenCalledWith(
      expect.objectContaining({ iconUrl: aliasUrl })
    )
  })

  it('clears one image while setting the other', async () => {
    mockCurrentActor.headerImageUrl = HEADER_MEDIA_URL
    await post({ iconUrl: MEDIA_URL, headerImageUrl: '' })

    expect(mockDatabase.updateActorWithPrevious).toHaveBeenCalledWith(
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

      expect(mockDatabase.updateActorWithPrevious).toHaveBeenCalledTimes(1)
      expect(
        mockDatabase.updateActorWithPrevious.mock.calls[0][0]
      ).not.toHaveProperty(field)
    })
  })

  describe('the fields the settings form does own', () => {
    it('updates the name and summary', async () => {
      await post({ name: 'New name', summary: 'New summary' })

      expect(mockDatabase.updateActorWithPrevious).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'New name', summary: 'New summary' })
      )
      expect(publishActorUpdate).toHaveBeenCalledWith({
        actorId: mockCurrentActor.id
      })
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

      expect(mockDatabase.updateActorWithPrevious).toHaveBeenCalledWith(
        expect.objectContaining({ manuallyApprovesFollowers: expected })
      )
    })

    it.each([
      { description: '10 lines', submitted: '10', expected: 10 },
      // "No limit" is a real option in the select, and it is the one valid
      // value that is falsy — a truthiness guard on the raw string silently
      // stops persisting it.
      { description: 'no limit', submitted: '0', expected: 0 }
    ])(
      'updates the post line limit to $description',
      async ({ submitted, expected }) => {
        await post({ postLineLimit: submitted })

        expect(mockDatabase.updateActorWithPrevious).toHaveBeenCalledWith(
          expect.objectContaining({ postLineLimit: expected })
        )
      }
    )

    it('clears the bio when the form is saved with it empty', async () => {
      mockCurrentActor.summary = 'Old bio'
      await post({ name: 'Same', summary: '' })

      expect(mockDatabase.updateActorWithPrevious).toHaveBeenCalledWith(
        expect.objectContaining({ summary: '' })
      )
      expect(publishActorUpdate).toHaveBeenCalledTimes(1)
    })

    it('sends no Update(Person) for a post line limit change alone', async () => {
      await post({ postLineLimit: '10' })

      expect(mockDatabase.updateActorWithPrevious).toHaveBeenCalledTimes(1)
      expect(publishActorUpdate).not.toHaveBeenCalled()
    })

    it('sends no Update(Person) when the form resubmits the stored profile', async () => {
      mockCurrentActor.name = 'Same name'
      mockCurrentActor.summary = 'Same bio'
      await post({ name: 'Same name', summary: 'Same bio', postLineLimit: '5' })

      expect(publishActorUpdate).not.toHaveBeenCalled()
    })

    it('sends an Update(Person) when a concurrent save changed the row after the pre-read, so the pre-read is stale', async () => {
      // Pre-read: Old. Another save wrote New (and published it) before this
      // one took the row lock. This save writes Old, which differs from the
      // locked New, so remote servers must be told.
      mockCurrentActor.name = 'Old'
      mockLockedBefore = { ...mockCurrentActor, name: 'New' }

      await post({ name: 'Old', postLineLimit: '5' })

      expect(publishActorUpdate).toHaveBeenCalledTimes(1)
    })

    it('sends no Update(Person) when the row read under the lock already equals the saved one', async () => {
      mockCurrentActor.name = 'Old'
      mockLockedBefore = { ...mockCurrentActor, name: 'New' }

      await post({ name: 'New', postLineLimit: '5' })

      expect(publishActorUpdate).not.toHaveBeenCalled()
    })

    it('sends exactly one Update(Person) for a name change', async () => {
      await post({ name: 'Another name', postLineLimit: '5' })

      expect(publishActorUpdate).toHaveBeenCalledTimes(1)
    })

    it('still queues the link check when only the links changed', async () => {
      mockCurrentActor.fields = [{ name: 'Blog', value: 'https://old.example' }]
      await post({
        'fields[0][name]': 'Blog',
        'fields[0][value]': 'https://blog.example'
      })

      expect(publishActorUpdate).toHaveBeenCalledTimes(1)
      expect(queueProfileLinkVerification).toHaveBeenCalledTimes(1)
    })

    it('redirects back to the settings page with 303 so the browser loads it with GET', async () => {
      const response = await post({ name: 'New name' })

      expect(response.status).toBe(303)
      expect(response.headers.get('location')).toBe(
        'https://llun.test/settings'
      )
    })
  })
})

describe('PATCH /api/v1/accounts/profile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSettings = undefined
    mockStoredActor = null
    mockStoredMissing = false
    mockLockedBefore = undefined
    delete mockCurrentActor.iconUrl
    delete mockCurrentActor.headerImageUrl
    delete mockCurrentActor.fields
    delete mockCurrentActor.name
    delete mockCurrentActor.summary
  })

  const patchRaw = (body: string) =>
    PATCH(
      new NextRequest('https://llun.test/api/v1/accounts/profile', {
        method: 'PATCH',
        headers: {
          origin: 'https://llun.test',
          'content-type': 'application/json'
        },
        body
      }),
      { params: Promise.resolve({}) }
    )
  const patch = (body: Record<string, unknown>) =>
    patchRaw(JSON.stringify(body))

  it('saves the profile and returns what the editor needs', async () => {
    mockSettings = { avatarDescription: 'A cat', showGallery: false }
    const response = await patch({
      name: 'New name',
      summary: 'New bio',
      fields: [
        { name: ' Blog ', value: ' https://blog.example ' },
        { name: '', value: '' }
      ],
      iconUrl: MEDIA_URL,
      headerImageUrl: HEADER_MEDIA_URL,
      avatarDescription: '  A cat  ',
      headerDescription: '',
      showReplies: false,
      showMedia: false,
      showGallery: true,
      showFitness: false
    })

    expect(response.status).toBe(200)
    expect(mockDatabase.updateActorWithPrevious).toHaveBeenCalledWith({
      actorId: mockCurrentActor.id,
      name: 'New name',
      summary: 'New bio',
      fields: [{ name: 'Blog', value: 'https://blog.example' }],
      iconUrl: MEDIA_URL,
      headerImageUrl: HEADER_MEDIA_URL,
      avatarDescription: 'A cat',
      headerDescription: '',
      showReplies: false,
      showMedia: false,
      showGallery: true,
      showFitness: false
    })
    expect(await response.json()).toEqual({
      name: 'New name',
      summary: 'New bio',
      fields: [
        { name: 'Blog', value: 'https://blog.example', verifiedAt: null }
      ],
      iconUrl: MEDIA_URL,
      headerImageUrl: HEADER_MEDIA_URL,
      avatarDescription: 'A cat',
      headerDescription: '',
      showReplies: false,
      showMedia: false,
      showGallery: true,
      showFitness: false
    })
  })

  it.each(['showReplies', 'showMedia', 'showGallery', 'showFitness'])(
    'saves only %s as false when the other tab flags stay true',
    async (flag) => {
      const flags = {
        showReplies: true,
        showMedia: true,
        showGallery: true,
        showFitness: true,
        [flag]: false
      }
      const response = await patch(flags)

      expect(response.status).toBe(200)
      expect(mockDatabase.updateActorWithPrevious).toHaveBeenCalledWith({
        actorId: mockCurrentActor.id,
        ...flags
      })
      expect(await response.json()).toMatchObject(flags)
    }
  )

  it('answers with the tab flags of the saved row, not a later settings read', async () => {
    // A concurrent save lands after this one commits: the settings read then
    // holds its flags, but the response must describe the row this save wrote.
    mockUpdateActorWithPrevious.mockImplementationOnce(async (params) => {
      const result = {
        before: mockStoredActor ?? mockCurrentActor,
        after: await mockUpdateActor(params)
      }
      mockSettings = {
        ...mockSettings,
        showReplies: true,
        showMedia: true,
        showGallery: true,
        avatarDescription: 'Alt'
      }
      return result
    })
    const response = await patch({ showReplies: false, showMedia: false })

    expect(await response.json()).toEqual(
      expect.objectContaining({
        showReplies: false,
        showMedia: false,
        showGallery: true,
        showFitness: true,
        avatarDescription: 'Alt'
      })
    )
  })

  it('returns 404 and queues nothing when the actor is gone mid-save', async () => {
    mockUpdateActor.mockResolvedValueOnce(null)
    const response = await patch({
      fields: [{ name: 'Blog', value: 'https://blog.example' }]
    })

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Not found' })
    expect(queueProfileLinkVerification).not.toHaveBeenCalled()
    expect(publishActorUpdate).not.toHaveBeenCalled()
  })

  it('returns the verification time of a verified link as ISO text', async () => {
    mockCurrentActor.fields = [
      { name: 'Blog', value: 'https://blog.example', verifiedAt: 1700000000000 }
    ]
    const response = await patch({ showFitness: false })

    const body = await response.json()
    expect(body.fields).toEqual([
      {
        name: 'Blog',
        value: 'https://blog.example',
        verifiedAt: '2023-11-14T22:13:20.000Z'
      }
    ])
  })

  it('sends no Update(Person) for a tab-only change', async () => {
    const response = await patch({
      showReplies: false,
      showMedia: false,
      showGallery: false,
      showFitness: false,
      avatarDescription: 'Alt text'
    })

    expect(response.status).toBe(200)
    expect(mockDatabase.updateActorWithPrevious).toHaveBeenCalledTimes(1)
    expect(publishActorUpdate).not.toHaveBeenCalled()
  })

  it('sends an Update(Person) when a concurrent save changed the row after the pre-read, so the pre-read is stale', async () => {
    mockCurrentActor.name = 'Old'
    mockLockedBefore = { ...mockCurrentActor, name: 'New' }

    await patch({ name: 'Old' })

    expect(publishActorUpdate).toHaveBeenCalledTimes(1)
  })

  it('sends no Update(Person) when the row read under the lock already equals the saved one', async () => {
    mockCurrentActor.name = 'Old'
    mockLockedBefore = { ...mockCurrentActor, name: 'New' }

    await patch({ name: 'New' })

    expect(publishActorUpdate).not.toHaveBeenCalled()
  })

  it('sends exactly one Update(Person) for a name change', async () => {
    await patch({ name: 'Another name', showReplies: false })

    expect(publishActorUpdate).toHaveBeenCalledTimes(1)
    expect(publishActorUpdate).toHaveBeenCalledWith({
      actorId: mockCurrentActor.id
    })
  })

  it('sends one Update and queues the link check when the links change', async () => {
    mockCurrentActor.fields = [{ name: 'Blog', value: 'https://old.example' }]
    await patch({ fields: [{ name: 'Blog', value: 'https://blog.example' }] })

    expect(publishActorUpdate).toHaveBeenCalledTimes(1)
    expect(queueProfileLinkVerification).toHaveBeenCalledWith({
      actorId: mockCurrentActor.id,
      before: [{ name: 'Blog', value: 'https://old.example' }],
      after: [{ name: 'Blog', value: 'https://blog.example' }],
      remote: false
    })
  })

  it('does not queue the link check when no links are sent', async () => {
    await patch({ name: 'Another name' })

    expect(queueProfileLinkVerification).not.toHaveBeenCalled()
  })

  it('clears an image with null and reports it as null', async () => {
    mockCurrentActor.iconUrl = MEDIA_URL
    const response = await patch({ iconUrl: null })

    expect(mockDatabase.updateActorWithPrevious).toHaveBeenCalledWith(
      expect.objectContaining({ iconUrl: null })
    )
    expect((await response.json()).iconUrl).toBeNull()
    expect(publishActorUpdate).toHaveBeenCalledTimes(1)
  })

  it('treats an echo of the stored image as no change', async () => {
    const stale = 'https://gravatar.example/avatar/abc.jpg'
    mockCurrentActor.iconUrl = stale
    const response = await patch({ iconUrl: stale, name: 'New name' })

    expect(response.status).toBe(200)
    expect(
      mockDatabase.updateActorWithPrevious.mock.calls[0][0]
    ).not.toHaveProperty('iconUrl')
  })

  it('clears the bio with an empty summary and sends one Update', async () => {
    mockCurrentActor.summary = 'Old bio'
    const response = await patch({ summary: '' })

    expect(mockDatabase.updateActorWithPrevious).toHaveBeenCalledWith(
      expect.objectContaining({ summary: '' })
    )
    expect((await response.json()).summary).toBe('')
    expect(publishActorUpdate).toHaveBeenCalledTimes(1)
  })

  it('clears the display name with an empty name and sends one Update', async () => {
    mockCurrentActor.name = 'Old name'
    const response = await patch({ name: '' })

    expect(mockDatabase.updateActorWithPrevious).toHaveBeenCalledWith(
      expect.objectContaining({ name: '' })
    )
    expect((await response.json()).name).toBe('')
    expect(publishActorUpdate).toHaveBeenCalledTimes(1)
  })

  describe('when the session actor lacks the stored links', () => {
    const storedLinks = [{ name: 'Blog', value: 'https://blog.example' }]
    beforeEach(() => {
      mockStoredActor = { ...mockCurrentActor, fields: storedLinks }
    })

    it('sends an Update(Person) when every link is removed', async () => {
      const response = await patch({ fields: [] })

      expect(response.status).toBe(200)
      expect(publishActorUpdate).toHaveBeenCalledTimes(1)
      expect(queueProfileLinkVerification).toHaveBeenCalledWith(
        expect.objectContaining({ before: storedLinks, after: [] })
      )
    })

    it('sends no Update(Person) for a tab-only change', async () => {
      await patch({ showReplies: false, showMedia: false })

      expect(mockDatabase.updateActorWithPrevious).toHaveBeenCalledTimes(1)
      expect(publishActorUpdate).not.toHaveBeenCalled()
    })

    it('sends no Update(Person) for an alt-text-only change', async () => {
      await patch({ avatarDescription: 'Alt text' })

      expect(publishActorUpdate).not.toHaveBeenCalled()
    })

    it('echoes the stored links for an empty body', async () => {
      const response = await patch({})

      expect(mockDatabase.updateActorWithPrevious).not.toHaveBeenCalled()
      expect(publishActorUpdate).not.toHaveBeenCalled()
      expect((await response.json()).fields).toEqual([
        { name: 'Blog', value: 'https://blog.example', verifiedAt: null }
      ])
    })
  })

  it('writes nothing for an empty body', async () => {
    const response = await patch({})

    expect(response.status).toBe(200)
    expect(mockDatabase.updateActorWithPrevious).not.toHaveBeenCalled()
    expect(publishActorUpdate).not.toHaveBeenCalled()
  })

  it('writes nothing for a body of unknown keys only', async () => {
    const response = await patch({
      publicKey: 'attacker-supplied-key',
      inboxUrl: 'https://evil.example/inbox'
    })

    expect(response.status).toBe(200)
    expect(mockDatabase.updateActorWithPrevious).not.toHaveBeenCalled()
    expect(publishActorUpdate).not.toHaveBeenCalled()
  })

  it('answers 404 for an empty body when the stored actor no longer exists', async () => {
    mockStoredMissing = true
    const response = await patch({})

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Not found' })
    expect(mockDatabase.updateActorWithPrevious).not.toHaveBeenCalled()
  })

  it('ignores keys the editor does not own', async () => {
    await patch({
      name: 'New name',
      publicKey: 'attacker-supplied-key',
      inboxUrl: 'https://evil.example/inbox'
    })

    const params = mockDatabase.updateActorWithPrevious.mock.calls[0][0]
    expect(params).not.toHaveProperty('publicKey')
    expect(params).not.toHaveProperty('inboxUrl')
  })

  describe('validation', () => {
    it.each([
      {
        description: 'a name over 255 characters',
        body: { name: 'a'.repeat(256) }
      },
      { description: 'a non-string summary', body: { summary: 5 } },
      {
        description: 'five links',
        body: {
          fields: Array.from({ length: 5 }, (_, i) => ({
            name: `n${i}`,
            value: `v${i}`
          }))
        }
      },
      {
        description: 'a link with a name and no value',
        body: { fields: [{ name: 'Blog', value: '' }] }
      },
      {
        description: 'a link name over its limit',
        body: { fields: [{ name: 'a'.repeat(1000), value: 'x' }] }
      },
      {
        description: 'a description over 1500 characters',
        body: { avatarDescription: 'a'.repeat(1501) }
      },
      {
        description: 'a header description over 1500 characters',
        body: { headerDescription: 'a'.repeat(1501) }
      },
      { description: 'a string tab flag', body: { showGallery: 'no' } },
      {
        description: 'an icon on somebody else’s host',
        body: { iconUrl: 'https://evil.example/api/v1/files/abc.jpg' }
      },
      {
        description: 'a javascript: header',
        body: { headerImageUrl: 'javascript://llun.test/%0aalert(1)' }
      }
    ])('answers 422 with an error body for $description', async ({ body }) => {
      const response = await patch({ name: 'Valid', ...body })

      expect(response.status).toBe(422)
      expect(await response.json()).toEqual({ error: expect.any(String) })
      expect(mockDatabase.updateActorWithPrevious).not.toHaveBeenCalled()
      expect(publishActorUpdate).not.toHaveBeenCalled()
    })

    it('accepts an unchanged name and bio longer than the caps', async () => {
      mockCurrentActor.name = 'n'.repeat(300)
      mockCurrentActor.summary = 's'.repeat(900)
      const response = await patch({
        name: 'n'.repeat(300),
        summary: 's'.repeat(900),
        showGallery: false
      })

      expect(response.status).toBe(200)
      expect(publishActorUpdate).not.toHaveBeenCalled()
    })

    it('still enforces the caps on a changed long value', async () => {
      mockCurrentActor.summary = 's'.repeat(900)
      const longer = await patch({ summary: 's'.repeat(901) })
      const name = await patch({ name: 'n'.repeat(256) })

      expect(longer.status).toBe(422)
      expect(name.status).toBe(422)
      expect(mockDatabase.updateActorWithPrevious).not.toHaveBeenCalled()
    })

    it('accepts descriptions of exactly 1500 characters after trimming', async () => {
      const response = await patch({
        avatarDescription: ` ${'a'.repeat(1500)} `
      })

      expect(response.status).toBe(200)
      expect(mockDatabase.updateActorWithPrevious).toHaveBeenCalledWith(
        expect.objectContaining({ avatarDescription: 'a'.repeat(1500) })
      )
    })

    it('answers 400 for a body that is not JSON', async () => {
      const response = await patchRaw('not json')

      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: 'Bad Request' })
      expect(mockDatabase.updateActorWithPrevious).not.toHaveBeenCalled()
    })
  })
})
