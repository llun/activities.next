import { MAX_MEDIA_DESCRIPTION_LENGTH } from '@/lib/services/medias/constants'

import { generateAltText } from './openai'
import { AltTextHttpClient, AltTextHttpRequest } from './types'

const config = {
  endpoint: 'https://api.openai.com/v1/chat/completions',
  apiKey: 'sk-test',
  model: 'gpt-4o-mini'
}

const chatResponse = (content: string) =>
  JSON.stringify({ choices: [{ message: { content } }] })

const createRecordingClient = (
  responder: (request: AltTextHttpRequest) => {
    statusCode: number
    body: string
  }
) => {
  const requests: AltTextHttpRequest[] = []
  const client: AltTextHttpClient = async (request) => {
    requests.push(request)
    return responder(request)
  }
  return { client, requests }
}

describe('generateAltText', () => {
  const sampleImageBuffer = Buffer.from('sample-image-binary-data')
  const mimeType = 'image/jpeg'

  it('sends vision chat completion request and returns generated alt text', async () => {
    const expectedAltText =
      'A golden retriever sitting in a sunny grassy field looking at the camera.'
    const { client, requests } = createRecordingClient(() => ({
      statusCode: 200,
      body: chatResponse(expectedAltText)
    }))

    const result = await generateAltText(
      config,
      sampleImageBuffer,
      mimeType,
      client
    )

    expect(result).toBe(expectedAltText)
    expect(requests).toHaveLength(1)
    const request = requests[0]
    expect(request?.url).toBe('https://api.openai.com/v1/chat/completions')
    expect(request?.headers.Authorization).toBe('Bearer sk-test')
    expect(request?.headers['Content-Type']).toBe('application/json')

    const body = JSON.parse(request?.body ?? '{}')
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

  it('trims whitespace from generated alt text', async () => {
    const { client } = createRecordingClient(() => ({
      statusCode: 200,
      body: chatResponse('  A snowy mountain landscape at sunset.  \n')
    }))

    const result = await generateAltText(
      config,
      sampleImageBuffer,
      mimeType,
      client
    )

    expect(result).toBe('A snowy mountain landscape at sunset.')
  })

  it('returns null when model returns empty or whitespace-only content', async () => {
    const { client } = createRecordingClient(() => ({
      statusCode: 200,
      body: chatResponse('   \n  ')
    }))

    const result = await generateAltText(
      config,
      sampleImageBuffer,
      mimeType,
      client
    )

    expect(result).toBeNull()
  })

  it('returns null and logs when backend returns non-200 status', async () => {
    const { client } = createRecordingClient(() => ({
      statusCode: 500,
      body: JSON.stringify({ error: { message: 'Internal server error' } })
    }))

    const result = await generateAltText(
      config,
      sampleImageBuffer,
      mimeType,
      client
    )

    expect(result).toBeNull()
  })

  it('returns null when backend returns invalid JSON', async () => {
    const { client } = createRecordingClient(() => ({
      statusCode: 200,
      body: 'invalid-json'
    }))

    const result = await generateAltText(
      config,
      sampleImageBuffer,
      mimeType,
      client
    )

    expect(result).toBeNull()
  })

  it('returns null when http client throws an error (e.g. timeout)', async () => {
    const client: AltTextHttpClient = async () => {
      throw new Error('Request timed out')
    }

    const result = await generateAltText(
      config,
      sampleImageBuffer,
      mimeType,
      client
    )

    expect(result).toBeNull()
  })

  it('truncates alt text to MAX_MEDIA_DESCRIPTION_LENGTH if too long', async () => {
    const longText = 'A'.repeat(MAX_MEDIA_DESCRIPTION_LENGTH + 100)
    const { client } = createRecordingClient(() => ({
      statusCode: 200,
      body: chatResponse(longText)
    }))

    const result = await generateAltText(
      config,
      sampleImageBuffer,
      mimeType,
      client
    )

    expect(result).toHaveLength(MAX_MEDIA_DESCRIPTION_LENGTH)
    expect(result).toBe(longText.slice(0, MAX_MEDIA_DESCRIPTION_LENGTH))
  })
})
