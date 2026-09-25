import { MAX_MEDIA_DESCRIPTION_LENGTH } from '@/lib/services/medias/constants'
import { logger } from '@/lib/utils/logger'
import { safeRemoteFetch } from '@/lib/utils/safeRemoteFetch'

import { generateAltText, generateRouteAltText } from './openai'

vi.mock('@/lib/utils/safeRemoteFetch', () => ({
  safeRemoteFetch: vi.fn()
}))

const config = {
  endpoint: 'https://api.openai.com/v1/chat/completions',
  apiKey: 'sk-test',
  model: 'gpt-4o-mini'
}

const chatResponse = (content: string) =>
  JSON.stringify({ choices: [{ message: { content } }] })

describe('generateAltText', () => {
  const sampleImageBuffer = Buffer.from('sample-image-binary-data')
  const mimeType = 'image/jpeg'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends vision chat completion request and returns generated alt text', async () => {
    const expectedAltText =
      'A golden retriever sitting in a sunny grassy field looking at the camera.'
    vi.mocked(safeRemoteFetch).mockResolvedValue({
      statusCode: 200,
      body: chatResponse(expectedAltText),
      bodyTruncated: false,
      headers: {},
      url: config.endpoint
    })

    const result = await generateAltText(config, sampleImageBuffer, mimeType)

    expect(result).toBe(expectedAltText)
    expect(safeRemoteFetch).toHaveBeenCalledTimes(1)
    const callArgs = vi.mocked(safeRemoteFetch).mock.calls[0]?.[0]
    expect(callArgs?.url).toBe('https://api.openai.com/v1/chat/completions')
    expect(callArgs?.headers).toEqual({
      Authorization: 'Bearer sk-test',
      'Content-Type': 'application/json'
    })

    const body = JSON.parse(callArgs?.body ?? '{}')
    expect(body.model).toBe('gpt-4o-mini')
    expect(body.messages).toHaveLength(2)
    expect(body.messages[0].role).toBe('system')
    expect(body.messages[1].role).toBe('user')
    expect(body.messages[1].content).toEqual([
      {
        type: 'image_url',
        image_url: {
          url: `data:image/jpeg;base64,${sampleImageBuffer.toString('base64')}`
        }
      },
      {
        type: 'text',
        text: 'Describe this image for alt text.'
      }
    ])
  })

  it('instructs the model to describe images and video frames without meta-preambles', async () => {
    vi.mocked(safeRemoteFetch).mockResolvedValue({
      statusCode: 200,
      body: chatResponse('A cyclist on a road bike.'),
      bodyTruncated: false,
      headers: {},
      url: config.endpoint
    })

    await generateAltText(config, sampleImageBuffer, mimeType)

    const callArgs = vi.mocked(safeRemoteFetch).mock.calls[0]?.[0]
    const body = JSON.parse(callArgs?.body ?? '{}')
    expect(body.messages[0].role).toBe('system')
    const systemPrompt = body.messages[0].content as string
    expect(systemPrompt).toContain('video preview frames')
    // The instruction has to be the NEGATION. Asserting the forbidden strings
    // merely appear would also pass a prompt that required them.
    expect(systemPrompt).toMatch(
      /Never start with phrases such as "This video shows"/
    )
    expect(systemPrompt).toContain('This image depicts')
    expect(systemPrompt).toContain('A photo of')
    expect(systemPrompt).toContain('Screenshot of')
  })

  it('trims whitespace from generated alt text', async () => {
    vi.mocked(safeRemoteFetch).mockResolvedValue({
      statusCode: 200,
      body: chatResponse('  A snowy mountain landscape at sunset.  \n'),
      bodyTruncated: false,
      headers: {},
      url: config.endpoint
    })

    const result = await generateAltText(config, sampleImageBuffer, mimeType)

    expect(result).toBe('A snowy mountain landscape at sunset.')
  })

  it('returns null when model returns empty or whitespace-only content', async () => {
    vi.mocked(safeRemoteFetch).mockResolvedValue({
      statusCode: 200,
      body: chatResponse('   \n  '),
      bodyTruncated: false,
      headers: {},
      url: config.endpoint
    })

    const result = await generateAltText(config, sampleImageBuffer, mimeType)

    expect(result).toBeNull()
  })

  it('returns null and logs when backend returns non-200 status', async () => {
    const warnSpy = vi.spyOn(logger, 'warn')
    vi.mocked(safeRemoteFetch).mockResolvedValue({
      statusCode: 500,
      body: JSON.stringify({ error: { message: 'Internal server error' } }),
      bodyTruncated: false,
      headers: {},
      url: config.endpoint
    })

    const result = await generateAltText(config, sampleImageBuffer, mimeType)

    expect(result).toBeNull()
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Failed to generate alt text for uploaded media'
      })
    )
  })

  it('returns null when backend returns invalid JSON', async () => {
    vi.mocked(safeRemoteFetch).mockResolvedValue({
      statusCode: 200,
      body: 'invalid-json',
      bodyTruncated: false,
      headers: {},
      url: config.endpoint
    })

    const result = await generateAltText(config, sampleImageBuffer, mimeType)

    expect(result).toBeNull()
  })

  it('returns null when safeRemoteFetch throws an error (e.g. timeout)', async () => {
    vi.mocked(safeRemoteFetch).mockRejectedValue(new Error('Request timed out'))

    const result = await generateAltText(config, sampleImageBuffer, mimeType)

    expect(result).toBeNull()
  })

  it('truncates alt text to MAX_MEDIA_DESCRIPTION_LENGTH if too long', async () => {
    const longText = 'A'.repeat(MAX_MEDIA_DESCRIPTION_LENGTH + 100)
    vi.mocked(safeRemoteFetch).mockResolvedValue({
      statusCode: 200,
      body: chatResponse(longText),
      bodyTruncated: false,
      headers: {},
      url: config.endpoint
    })

    const result = await generateAltText(config, sampleImageBuffer, mimeType)

    expect(result).toHaveLength(MAX_MEDIA_DESCRIPTION_LENGTH)
    expect(result).toBe(longText.slice(0, MAX_MEDIA_DESCRIPTION_LENGTH))
  })
})

describe('generateRouteAltText', () => {
  const sampleMapBuffer = Buffer.from('sample-map-png-binary-data')

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends vision chat completion request with route prompt and returns generated alt text', async () => {
    const expectedAltText =
      'A counter-clockwise loop route along the coastline and returning through the city center.'
    vi.mocked(safeRemoteFetch).mockResolvedValue({
      statusCode: 200,
      body: chatResponse(expectedAltText),
      bodyTruncated: false,
      headers: {},
      url: config.endpoint
    })

    const result = await generateRouteAltText(config, sampleMapBuffer)

    expect(result).toBe(expectedAltText)
    expect(safeRemoteFetch).toHaveBeenCalledTimes(1)
    const callArgs = vi.mocked(safeRemoteFetch).mock.calls[0]?.[0]
    expect(callArgs?.url).toBe('https://api.openai.com/v1/chat/completions')
    expect(callArgs?.headers).toEqual({
      Authorization: 'Bearer sk-test',
      'Content-Type': 'application/json'
    })

    const body = JSON.parse(callArgs?.body ?? '{}')
    expect(body.model).toBe('gpt-4o-mini')
    expect(body.messages).toHaveLength(2)
    expect(body.messages[0].role).toBe('system')
    expect(body.messages[1].role).toBe('user')
    expect(body.messages[1].content).toEqual([
      {
        type: 'image_url',
        image_url: {
          url: `data:image/png;base64,${sampleMapBuffer.toString('base64')}`
        }
      },
      {
        type: 'text',
        text: 'Describe the route shown on this map for alt text.'
      }
    ])
  })

  it('instructs the model to describe route maps without meta-preambles', async () => {
    vi.mocked(safeRemoteFetch).mockResolvedValue({
      statusCode: 200,
      body: chatResponse('A 10km loop through hilly forest terrain.'),
      bodyTruncated: false,
      headers: {},
      url: config.endpoint
    })

    await generateRouteAltText(config, sampleMapBuffer)

    const callArgs = vi.mocked(safeRemoteFetch).mock.calls[0]?.[0]
    const body = JSON.parse(callArgs?.body ?? '{}')
    expect(body.messages[0].role).toBe('system')
    const systemPrompt = body.messages[0].content as string
    expect(systemPrompt).toContain('route maps for fitness activities')
    expect(systemPrompt).toMatch(
      /Never start with phrases such as "This map shows"/
    )
    expect(systemPrompt).toContain('This route depicts')
    expect(systemPrompt).toContain('A map of')
    expect(systemPrompt).toContain('Route of')
  })

  it('trims whitespace from generated route alt text', async () => {
    vi.mocked(safeRemoteFetch).mockResolvedValue({
      statusCode: 200,
      body: chatResponse('  An out-and-back trail run along the river.  \n'),
      bodyTruncated: false,
      headers: {},
      url: config.endpoint
    })

    const result = await generateRouteAltText(config, sampleMapBuffer)

    expect(result).toBe('An out-and-back trail run along the river.')
  })

  it('returns null when model returns empty or whitespace-only content', async () => {
    vi.mocked(safeRemoteFetch).mockResolvedValue({
      statusCode: 200,
      body: chatResponse('   \n  '),
      bodyTruncated: false,
      headers: {},
      url: config.endpoint
    })

    const result = await generateRouteAltText(config, sampleMapBuffer)

    expect(result).toBeNull()
  })

  it('returns null and logs when backend returns non-200 status', async () => {
    const warnSpy = vi.spyOn(logger, 'warn')
    vi.mocked(safeRemoteFetch).mockResolvedValue({
      statusCode: 500,
      body: JSON.stringify({ error: { message: 'Internal server error' } }),
      bodyTruncated: false,
      headers: {},
      url: config.endpoint
    })

    const result = await generateRouteAltText(config, sampleMapBuffer)

    expect(result).toBeNull()
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Failed to generate alt text for route map'
      })
    )
  })

  it('returns null when backend returns invalid JSON', async () => {
    vi.mocked(safeRemoteFetch).mockResolvedValue({
      statusCode: 200,
      body: 'invalid-json',
      bodyTruncated: false,
      headers: {},
      url: config.endpoint
    })

    const result = await generateRouteAltText(config, sampleMapBuffer)

    expect(result).toBeNull()
  })

  it('returns null when safeRemoteFetch throws an error', async () => {
    vi.mocked(safeRemoteFetch).mockRejectedValue(new Error('Connection failed'))

    const result = await generateRouteAltText(config, sampleMapBuffer)

    expect(result).toBeNull()
  })

  it('truncates route alt text to MAX_MEDIA_DESCRIPTION_LENGTH if too long', async () => {
    const longText = 'R'.repeat(MAX_MEDIA_DESCRIPTION_LENGTH + 50)
    vi.mocked(safeRemoteFetch).mockResolvedValue({
      statusCode: 200,
      body: chatResponse(longText),
      bodyTruncated: false,
      headers: {},
      url: config.endpoint
    })

    const result = await generateRouteAltText(config, sampleMapBuffer)

    expect(result).toHaveLength(MAX_MEDIA_DESCRIPTION_LENGTH)
    expect(result).toBe(longText.slice(0, MAX_MEDIA_DESCRIPTION_LENGTH))
  })
})
