import { NextRequest } from 'next/server'
import sharp from 'sharp'

import { getPhotoEditorConfig } from '@/lib/config'
import { getTestDatabaseWithInstance } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { logger } from '@/lib/utils/logger'
import { safeRemoteFetch } from '@/lib/utils/safeRemoteFetch'

import {
  ENHANCE_PREVIEW_MAX_BYTES,
  ENHANCE_PREVIEW_MAX_LONG_EDGE,
  POST
} from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase:
  ReturnType<typeof getTestDatabaseWithInstance>['database'] | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase,
  getKnex: () => () => ({ where: () => ({ first: () => null }) })
}))

vi.mock('next/headers', () => ({
  cookies: vi
    .fn()
    .mockResolvedValue({ get: vi.fn().mockReturnValue(undefined) })
}))

vi.mock('better-auth/oauth2', () => ({ verifyBearerToken: vi.fn() }))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getPhotoEditorConfig: vi.fn(),
  getConfig: vi.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

const takeMock = vi.hoisted(() => vi.fn())
// What the route built its counter with, recorded at import (a plain array, so
// clearing the mocks between tests keeps it).
const counterOptions = vi.hoisted(() => [] as unknown[])
vi.mock('@/lib/services/gallery/lookups/rateLimit', async (importActual) => ({
  ...(await importActual<
    typeof import('@/lib/services/gallery/lookups/rateLimit')
  >()),
  createWindowCounter: (options: unknown) => {
    counterOptions.push(options)
    return { tryHit: takeMock, reset: vi.fn() }
  }
}))

vi.mock('@/lib/utils/safeRemoteFetch', () => ({ safeRemoteFetch: vi.fn() }))

const ENHANCE = {
  endpoint: 'https://vision.example.com/v1/chat/completions',
  apiKey: 'sk-vision',
  model: 'vision-1'
}

const STYLE = {
  global: { exposure: 0.4, contrast: 12, temperature: -4 },
  subject: { highlights: -15 },
  background: null
}
const ANSWER = { natural: STYLE, vivid: STYLE, dramatic: STYLE }

const completion = (content: string) => ({
  statusCode: 200,
  body: JSON.stringify({ choices: [{ message: { content } }] }),
  bodyTruncated: false,
  headers: {},
  url: ENHANCE.endpoint
})

const jpeg = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: '#996633' } })
    .jpeg()
    .toBuffer()

describe('POST /api/v1/media/[id]/edit/enhance', () => {
  const { database, prepare } = getTestDatabaseWithInstance()
  let preview: Buffer

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
    preview = await jpeg(1200, 800)
  })

  afterAll(async () => {
    mockDatabase = null
    await database.destroy()
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
    await database.updateGallerySettings({
      actorId: ACTOR1_ID,
      photoEnhance: true
    })
    vi.mocked(getPhotoEditorConfig).mockReturnValue({
      subjectModel: null,
      connectOrigins: [],
      enhance: ENHANCE
    })
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    takeMock.mockReturnValue(true)
    vi.mocked(safeRemoteFetch).mockResolvedValue(
      completion(JSON.stringify(ANSWER))
    )
  })

  let counter = 0
  const createMediaFor = async (
    actorId: string,
    mimeType = 'image/jpeg',
    metaData: { width: number; height: number } = { width: 400, height: 300 }
  ) => {
    counter += 1
    const media = await database.createMedia({
      actorId,
      original: {
        path: `medias/enhance-${counter}.jpg`,
        bytes: 1000,
        mimeType,
        metaData
      }
    })
    return media!.id
  }

  const part = (
    data: Buffer | null = preview,
    type = 'image/jpeg'
  ): FormData => {
    const form = new FormData()
    if (data) {
      form.set(
        'preview',
        new File([new Uint8Array(data)], 'preview.jpg', { type })
      )
    }
    return form
  }

  const post = (id: string, body: FormData | string = part()) =>
    POST(
      new NextRequest(`https://llun.test/api/v1/media/${id}/edit/enhance`, {
        method: 'POST',
        headers: { origin: 'https://llun.test' },
        body
      }),
      { params: Promise.resolve({ id }) }
    )

  it('limits each actor to 30 suggestions an hour', () => {
    expect(counterOptions).toContainEqual({ limit: 30, windowMs: 3_600_000 })
  })

  it('answers the three styles and the model', async () => {
    const id = await createMediaFor(ACTOR1_ID)

    const response = await post(id)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ...ANSWER, model: 'vision-1' })
    expect(takeMock).toHaveBeenCalledWith(ACTOR1_ID)
  })

  it('sends the preview to the configured endpoint as a JPEG data URL', async () => {
    const id = await createMediaFor(ACTOR1_ID)

    await post(id)

    expect(safeRemoteFetch).toHaveBeenCalledTimes(1)
    const call = vi.mocked(safeRemoteFetch).mock.calls[0][0]
    expect(call.url).toBe(ENHANCE.endpoint)
    expect(call.method).toBe('POST')
    expect(call.headers).toMatchObject({
      Authorization: 'Bearer sk-vision'
    })
    const body = JSON.parse(call.body as string)
    expect(body.model).toBe('vision-1')
    expect(body.max_tokens).toBe(600)
    const [system, user] = body.messages
    expect(system.role).toBe('system')
    expect(system.content).toContain('JSON')
    expect(system.content).toContain('exposure')
    expect(user.content[0].image_url.url).toMatch(/^data:image\/jpeg;base64,/)
  })

  it('keeps nothing: no row, no setting and no media change', async () => {
    const id = await createMediaFor(ACTOR1_ID)
    const before = await database.getMediaByIdForAccount({
      mediaId: id,
      accountId: (await database.getActorFromId({ id: ACTOR1_ID }))!.account!.id
    })
    const editBefore = await database.getMediaEditState({ mediaId: id })
    const settings = await database.getGallerySettings({ actorId: ACTOR1_ID })

    await post(id)

    const accountId = (await database.getActorFromId({ id: ACTOR1_ID }))!
      .account!.id
    expect(
      await database.getMediaByIdForAccount({ mediaId: id, accountId })
    ).toEqual(before)
    expect(await database.getMediaEditState({ mediaId: id })).toEqual(
      editBefore
    )
    expect(await database.getGallerySettings({ actorId: ACTOR1_ID })).toEqual(
      settings
    )
  })

  it.each([
    ['plain JSON', JSON.stringify(ANSWER)],
    ['a json code fence', `\`\`\`json\n${JSON.stringify(ANSWER)}\n\`\`\``],
    ['a bare code fence', `\`\`\`\n${JSON.stringify(ANSWER)}\n\`\`\``]
  ])('accepts %s from the model', async (_, content) => {
    vi.mocked(safeRemoteFetch).mockResolvedValue(completion(content))
    const id = await createMediaFor(ACTOR1_ID)

    const response = await post(id)

    expect(response.status).toBe(200)
    expect((await response.json()).natural).toEqual(STYLE)
  })

  describe('a suggestion it cannot use', () => {
    it.each([
      ['an extra key', { ...ANSWER, notes: 'nice photo' }],
      ['an extra key in a style', { ...ANSWER, vivid: { ...STYLE, mood: 1 } }],
      [
        'an unknown adjustment',
        { ...ANSWER, vivid: { ...STYLE, global: { sharpen: 5 } } }
      ],
      [
        'an out-of-range exposure',
        { ...ANSWER, dramatic: { ...STYLE, global: { exposure: 2 } } }
      ],
      [
        'an out-of-range step',
        { ...ANSWER, dramatic: { ...STYLE, global: { contrast: 75 } } }
      ],
      [
        'an out-of-range temperature',
        { ...ANSWER, dramatic: { ...STYLE, global: { temperature: 45 } } }
      ],
      [
        'a vignette on the subject',
        { ...ANSWER, vivid: { ...STYLE, subject: { vignette: 10 } } }
      ],
      ['a missing style', { natural: STYLE, vivid: STYLE }]
    ])('is a 502 for %s', async (_, answer) => {
      vi.mocked(safeRemoteFetch).mockResolvedValue(
        completion(JSON.stringify(answer))
      )
      const id = await createMediaFor(ACTOR1_ID)

      const response = await post(id)

      expect(response.status).toBe(502)
      expect(await response.json()).toEqual({
        error: "Couldn't get a suggestion"
      })
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Failed to get an AI enhance suggestion',
          mediaId: id,
          err: expect.any(Error)
        })
      )
    })

    it.each([
      ['prose', 'I would brighten it a little.'],
      ['prose around JSON', `Sure! ${JSON.stringify(ANSWER)} Hope it helps.`],
      ['malformed JSON', '{"natural": {'],
      ['nothing', ''],
      ['a JSON array', '[]']
    ])('is a 502 for %s', async (_, content) => {
      vi.mocked(safeRemoteFetch).mockResolvedValue(completion(content))
      const id = await createMediaFor(ACTOR1_ID)

      expect((await post(id)).status).toBe(502)
    })

    it('is a 502 when the model endpoint answers with an error', async () => {
      vi.mocked(safeRemoteFetch).mockResolvedValue({
        ...completion(''),
        statusCode: 500
      })
      const id = await createMediaFor(ACTOR1_ID)

      const response = await post(id)

      expect(response.status).toBe(502)
      expect(await response.json()).toEqual({
        error: "Couldn't get a suggestion"
      })
    })

    it('is a 502 when the request fails', async () => {
      vi.mocked(safeRemoteFetch).mockRejectedValue(new Error('ECONNRESET'))
      const id = await createMediaFor(ACTOR1_ID)

      expect((await post(id)).status).toBe(502)
    })

    it('does not leak the model output or the key', async () => {
      vi.mocked(safeRemoteFetch).mockResolvedValue(
        completion('secret model chatter')
      )
      const id = await createMediaFor(ACTOR1_ID)

      const text = await (await post(id)).text()

      expect(text).not.toContain('secret model chatter')
      expect(text).not.toContain('sk-vision')
    })
  })

  describe('checks, in order', () => {
    it('is 404 for someone else’s media, before anything else', async () => {
      const id = await createMediaFor(ACTOR2_ID)
      await database.updateGallerySettings({
        actorId: ACTOR1_ID,
        photoEnhance: false
      })
      vi.mocked(getPhotoEditorConfig).mockReturnValue({
        subjectModel: null,
        connectOrigins: [],
        enhance: null
      })

      expect((await post(id)).status).toBe(404)
      expect(safeRemoteFetch).not.toHaveBeenCalled()
    })

    it('is 404 for a media that does not exist', async () => {
      expect((await post('999999')).status).toBe(404)
    })

    it('is 422 for media that cannot be edited', async () => {
      const id = await createMediaFor(ACTOR1_ID, 'video/mp4')

      const response = await post(id)

      expect(response.status).toBe(422)
      expect(safeRemoteFetch).not.toHaveBeenCalled()
    })

    it('is 409 when the owner turned AI enhance off, before the server config', async () => {
      await database.updateGallerySettings({
        actorId: ACTOR1_ID,
        photoEnhance: false
      })
      vi.mocked(getPhotoEditorConfig).mockReturnValue({
        subjectModel: null,
        connectOrigins: [],
        enhance: null
      })
      takeMock.mockReturnValue(false)
      const id = await createMediaFor(ACTOR1_ID)

      const response = await post(id)

      expect(response.status).toBe(409)
      expect(await response.json()).toEqual({
        error: 'AI enhance is turned off'
      })
      expect(takeMock).not.toHaveBeenCalled()
      expect(safeRemoteFetch).not.toHaveBeenCalled()
    })

    describe('when the account has two actors', () => {
      // The switch is the one Settings → Media writes: the actor the person
      // is acting as (ACTOR1), whichever of the account's actors owns the
      // photo.
      const createSecondActorMedia = async () => {
        const actor = await database.getActorFromId({ id: ACTOR1_ID })
        const second = await database.createActorForAccount({
          accountId: actor!.account!.id,
          username: `second${counter}`,
          domain: 'llun.test',
          privateKey: 'private',
          publicKey: 'public'
        })
        return { secondId: second, mediaId: await createMediaFor(second) }
      }

      it('reads the current actor’s switch, not the photo owner’s', async () => {
        const { secondId, mediaId } = await createSecondActorMedia()
        await database.updateGallerySettings({
          actorId: secondId,
          photoEnhance: false
        })

        expect((await post(mediaId)).status).toBe(200)

        await database.updateGallerySettings({
          actorId: ACTOR1_ID,
          photoEnhance: false
        })
        await database.updateGallerySettings({
          actorId: secondId,
          photoEnhance: true
        })

        const response = await post(mediaId)
        expect(response.status).toBe(409)
        expect(await response.json()).toEqual({
          error: 'AI enhance is turned off'
        })
      })
    })

    it('is 503 when the server has no model, before the rate limit', async () => {
      vi.mocked(getPhotoEditorConfig).mockReturnValue({
        subjectModel: null,
        connectOrigins: [],
        enhance: null
      })
      takeMock.mockReturnValue(false)
      const id = await createMediaFor(ACTOR1_ID)

      const response = await post(id)

      expect(response.status).toBe(503)
      expect(await response.json()).toEqual({
        error: 'AI enhance is not set up'
      })
      expect(takeMock).not.toHaveBeenCalled()
      expect(safeRemoteFetch).not.toHaveBeenCalled()
    })

    it('is 429 over the rate limit, and the model is not asked', async () => {
      takeMock.mockReturnValue(false)
      const id = await createMediaFor(ACTOR1_ID)

      const response = await post(id)

      expect(response.status).toBe(429)
      expect(takeMock).toHaveBeenCalledWith(ACTOR1_ID)
      expect(safeRemoteFetch).not.toHaveBeenCalled()
    })
  })

  describe('the preview', () => {
    it('is required', async () => {
      const id = await createMediaFor(ACTOR1_ID)

      expect((await post(id, new FormData())).status).toBe(422)
      expect((await post(id, 'preview=text')).status).toBe(422)
      expect(takeMock).not.toHaveBeenCalled()
    })

    it('must be a file, not text', async () => {
      const id = await createMediaFor(ACTOR1_ID)
      const form = new FormData()
      form.set('preview', 'not a file')

      expect((await post(id, form)).status).toBe(422)
    })

    it.each(['image/png', 'image/webp', 'application/octet-stream', ''])(
      'must be image/jpeg, not %j',
      async (type) => {
        const id = await createMediaFor(ACTOR1_ID)

        expect((await post(id, part(preview, type))).status).toBe(422)
        expect(takeMock).not.toHaveBeenCalled()
        expect(safeRemoteFetch).not.toHaveBeenCalled()
      }
    )

    it('must really be a JPEG', async () => {
      const png = await sharp({
        create: { width: 100, height: 100, channels: 3, background: '#fff' }
      })
        .png()
        .toBuffer()
      const id = await createMediaFor(ACTOR1_ID)

      expect((await post(id, part(png))).status).toBe(422)
      expect(
        (await post(id, part(Buffer.from('not an image at all')))).status
      ).toBe(422)
      expect(safeRemoteFetch).not.toHaveBeenCalled()
    })

    it('may be at most 3 MB', async () => {
      const id = await createMediaFor(ACTOR1_ID)
      const big = Buffer.concat([
        preview,
        Buffer.alloc(ENHANCE_PREVIEW_MAX_BYTES + 1 - preview.length)
      ])
      expect(big.length).toBe(ENHANCE_PREVIEW_MAX_BYTES + 1)

      const response = await post(id, part(big))

      expect(response.status).toBe(413)
      expect(takeMock).not.toHaveBeenCalled()
      expect(safeRemoteFetch).not.toHaveBeenCalled()
    })

    it('may have a long edge of 1536 px, not more', async () => {
      const id = await createMediaFor(ACTOR1_ID)

      const exact = await jpeg(ENHANCE_PREVIEW_MAX_LONG_EDGE, 900)
      expect((await post(id, part(exact))).status).toBe(200)

      const tall = await jpeg(900, ENHANCE_PREVIEW_MAX_LONG_EDGE + 1)
      const wide = await jpeg(ENHANCE_PREVIEW_MAX_LONG_EDGE + 1, 900)
      expect((await post(id, part(tall))).status).toBe(422)
      expect((await post(id, part(wide))).status).toBe(422)
    })

    it('is not read when the owner has turned enhance off', async () => {
      await database.updateGallerySettings({
        actorId: ACTOR1_ID,
        photoEnhance: false
      })
      const id = await createMediaFor(ACTOR1_ID)

      // Not even a multipart body: the 409 comes first.
      expect((await post(id, 'not a form')).status).toBe(409)
    })
  })
})
