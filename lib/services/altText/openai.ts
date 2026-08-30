import { AltTextConfig } from '@/lib/config/altText'
import { MAX_MEDIA_DESCRIPTION_LENGTH } from '@/lib/services/medias/constants'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

import { fetchAltTextHttpClient } from './httpClient'
import {
  AltTextHttpClient,
  AltTextProviderError,
  parseAltTextJson
} from './types'

const REQUEST_TIMEOUT_MS = 30000

const SYSTEM_PROMPT =
  'You generate concise and accurate alt text descriptions for images for visually impaired users. Provide a clear 1-2 sentence description of the key visual elements and scene. Do not include introductory phrases like "This image shows" or "A photo of".'

interface OpenAIChatResponse {
  choices?: { message?: { content?: string } }[]
}

/**
 * Generates an alt text description for an image using an OpenAI-compatible
 * vision chat-completions endpoint. Returns null if generation fails or is empty,
 * ensuring the media upload flow is not blocked.
 */
export const generateAltText = async (
  config: AltTextConfig,
  imageBuffer: Buffer,
  mimeType: string,
  httpClient: AltTextHttpClient = fetchAltTextHttpClient
): Promise<string | null> => {
  try {
    const base64Data = imageBuffer.toString('base64')
    const dataUrl = `data:${mimeType};base64,${base64Data}`

    const response = await httpClient({
      url: config.endpoint,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.2,
        max_tokens: 300,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: { url: dataUrl }
              },
              {
                type: 'text',
                text: 'Describe this image for alt text.'
              }
            ]
          }
        ]
      }),
      timeoutMs: REQUEST_TIMEOUT_MS
    })

    if (response.statusCode !== 200) {
      throw new AltTextProviderError(
        `Alt text backend request failed with status ${response.statusCode}`
      )
    }

    const data = parseAltTextJson<OpenAIChatResponse>(response.body)
    const content = data.choices?.[0]?.message?.content?.trim()
    if (!content) {
      return null
    }

    return content.slice(0, MAX_MEDIA_DESCRIPTION_LENGTH)
  } catch (error) {
    logger.warn({
      message: 'Failed to generate alt text for uploaded image',
      err: toLoggableError(error)
    })
    return null
  }
}
