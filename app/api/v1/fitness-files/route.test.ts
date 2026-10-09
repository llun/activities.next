import { NextRequest } from 'next/server'

import { getConfig } from '@/lib/config'
import { QuotaExceededError } from '@/lib/services/fitness-files/errors'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { logger } from '@/lib/utils/logger'

import { POST } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

const mockDatabase = {}
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: vi.fn(() => ({
    id: ACTOR1_ID,
    account: { id: 'account-1' }
  }))
}))

vi.mock('@/lib/services/serverSettings', () => ({
  getResolvedServerSettings: vi.fn(async () => ({
    posts: { maxCharacters: 500 }
  }))
}))

const mockSaveFitnessFile = vi.fn()
vi.mock('@/lib/services/fitness-files', () => ({
  saveFitnessFile: (...args: unknown[]) => mockSaveFitnessFile(...args)
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    host: 'llun.test',
    allowEmails: [],
    allowActorDomains: []
  })
}))

const uploadForm = (
  form: FormData,
  headers: Record<string, string> = { Origin: 'https://llun.test' }
) =>
  new NextRequest('https://llun.test/api/v1/fitness-files', {
    method: 'POST',
    headers,
    body: form
  })

const upload = (description?: string) => {
  const form = new FormData()
  form.set(
    'file',
    new File(['<gpx></gpx>'], 'ride.gpx', { type: 'application/gpx+xml' })
  )
  if (description !== undefined) form.set('description', description)
  return uploadForm(form)
}

const context = { params: Promise.resolve({}) }

describe('POST /api/v1/fitness-files', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    mockSaveFitnessFile.mockResolvedValue({ id: 'fitness-1' })
  })

  it('stores a description within the instance post length', async () => {
    const response = await POST(upload('a'.repeat(500)), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    expect(mockSaveFitnessFile).toHaveBeenCalledWith(
      mockDatabase,
      expect.anything(),
      expect.objectContaining({ description: 'a'.repeat(500) })
    )
  })

  it('rejects an over-long description with 400 and saves nothing', async () => {
    const response = await POST(upload('a'.repeat(501)), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(400)
    expect(mockSaveFitnessFile).not.toHaveBeenCalled()
  })

  it('still accepts an upload with no description', async () => {
    const response = await POST(upload(), { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    expect(mockSaveFitnessFile).toHaveBeenCalledWith(
      mockDatabase,
      expect.anything(),
      expect.objectContaining({ description: undefined })
    )
  })

  it('hands the validated file to storage as the signed-in actor', async () => {
    const response = await POST(upload('Lunch ride'), context)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ id: 'fitness-1' })
    const [, actor, input] = mockSaveFitnessFile.mock.calls[0]
    expect(actor.id).toBe(ACTOR1_ID)
    expect(input.file.name).toBe('ride.gpx')
  })

  it('rejects a request without a file part', async () => {
    const form = new FormData()
    form.set('description', 'no file here')

    const response = await POST(uploadForm(form), context)

    expect(response.status).toBe(400)
    expect(mockSaveFitnessFile).not.toHaveBeenCalled()
  })

  it('rejects a text field posted under the file name', async () => {
    const form = new FormData()
    form.set('file', 'not-a-file')

    const response = await POST(uploadForm(form), context)

    expect(response.status).toBe(400)
    expect(mockSaveFitnessFile).not.toHaveBeenCalled()
  })

  it.each([
    ['an unsupported extension', 'notes.txt', 'text/plain'],
    [
      'a generic binary that is not a .fit',
      'ride.gpx',
      'application/octet-stream'
    ]
  ])('rejects %s without saving', async (_, name, type) => {
    const form = new FormData()
    form.set('file', new File(['data'], name, { type }))

    const response = await POST(uploadForm(form), context)

    expect(response.status).toBe(400)
    expect(mockSaveFitnessFile).not.toHaveBeenCalled()
  })

  it('rejects a file larger than the configured limit', async () => {
    const original = vi.mocked(getConfig).getMockImplementation()
    vi.mocked(getConfig).mockReturnValue({
      host: 'llun.test',
      allowEmails: [],
      allowActorDomains: [],
      fitnessStorage: { maxFileSize: 4 }
    } as unknown as ReturnType<typeof getConfig>)
    try {
      const response = await POST(upload(), context)

      expect(response.status).toBe(400)
      expect(mockSaveFitnessFile).not.toHaveBeenCalled()
    } finally {
      vi.mocked(getConfig).mockReset()
      if (original) vi.mocked(getConfig).mockImplementation(original)
      else
        vi.mocked(getConfig).mockReturnValue({
          host: 'llun.test',
          allowEmails: [],
          allowActorDomains: []
        } as unknown as ReturnType<typeof getConfig>)
    }
  })

  it('answers 413 when storage reports the account is over quota', async () => {
    vi.spyOn(logger, 'error').mockImplementation(() => logger)
    mockSaveFitnessFile.mockRejectedValue(
      new QuotaExceededError('Storage quota exceeded', 10, 5)
    )

    const response = await POST(upload(), context)

    expect(response.status).toBe(413)
  })

  it('answers 500 when no storage is configured', async () => {
    vi.spyOn(logger, 'error').mockImplementation(() => logger)
    mockSaveFitnessFile.mockResolvedValue(null)

    const response = await POST(upload(), context)

    expect(response.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith({
      message: 'Failed to save fitness file'
    })
  })

  it('answers 500 and logs when storage throws', async () => {
    vi.spyOn(logger, 'error').mockImplementation(() => logger)
    mockSaveFitnessFile.mockRejectedValue(new Error('bucket unreachable'))

    const response = await POST(upload(), context)

    expect(response.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith({
      message: 'Error uploading fitness file',
      error: 'bucket unreachable'
    })
  })

  it('rejects a cross-site upload before reading the body', async () => {
    const form = new FormData()
    form.set('file', new File(['<gpx/>'], 'ride.gpx'))

    const response = await POST(
      uploadForm(form, { Origin: 'https://evil.example' }),
      context
    )

    expect(response.status).toBe(403)
    expect(mockSaveFitnessFile).not.toHaveBeenCalled()
  })

  it('redirects a signed-out caller to sign in', async () => {
    mockGetServerSession.mockResolvedValue(null)

    const response = await POST(upload(), context)

    expect(response.status).toBe(307)
    expect(mockSaveFitnessFile).not.toHaveBeenCalled()
  })
})
