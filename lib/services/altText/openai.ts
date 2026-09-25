import sharp from 'sharp'

import { AltTextConfig } from '@/lib/config/altText'
import { MAX_MEDIA_DESCRIPTION_LENGTH } from '@/lib/services/medias/constants'
import { logger } from '@/lib/utils/logger'
import { safeRemoteFetch } from '@/lib/utils/safeRemoteFetch'
import { toLoggableError } from '@/lib/utils/toLoggableError'

import { AltTextProviderError, parseAltTextJson } from './types'

const REQUEST_TIMEOUT_MS = 30000
const MAX_RESPONSE_BYTES = 1 * 1024 * 1024
const MAX_VISION_IMAGE_DIMENSION = 1536

export const SYSTEM_PROMPT =
  'You generate concise and accurate alt text descriptions for images and video preview frames for visually impaired users. Provide a clear 1-2 sentence description of the key visual elements and scene. Describe what is shown directly, without conversational filler or meta-preambles. Never start with phrases such as "This video shows", "This image depicts", "A photo of" or "Screenshot of".'

export const ROUTE_SYSTEM_PROMPT =
  'You generate concise and accurate alt text descriptions of route maps for fitness activities for visually impaired users. Provide a clear 1-2 sentence description of the route shown on the map, including terrain, landmarks, neighborhoods, and the general shape or direction of the route if visible. Describe what is shown directly, without conversational filler or meta-preambles. Never start with phrases such as "This map shows", "This route depicts", "A map of" or "Route of".'

export const DEFAULT_IMAGE_PROMPT = 'Describe this image for alt text.'
export const DEFAULT_ROUTE_PROMPT =
  'Describe the route shown on this map for alt text.'

interface OpenAIChatResponse {
  choices?: { message?: { content?: string } }[]
}

export interface GenerateAltTextOptions {
  systemPrompt?: string
  prompt?: string
  logMessage?: string
}

/**
 * Generates an alt text description for an image or a video preview frame
 * using an OpenAI-compatible vision chat-completions endpoint. Returns null if
 * generation fails or is empty, ensuring the media upload flow is not blocked.
 */
export const generateAltText = async (
  config: AltTextConfig,
  imageBuffer: Buffer,
  mimeType: string,
  options?: GenerateAltTextOptions
): Promise<string | null> => {
  try {
    let processedBuffer = imageBuffer
    try {
      processedBuffer = await sharp(imageBuffer)
        .rotate()
        .resize(MAX_VISION_IMAGE_DIMENSION, MAX_VISION_IMAGE_DIMENSION, {
          fit: 'inside',
          withoutEnlargement: true
        })
        .toBuffer()
    } catch {
      // If sharp cannot process the buffer, proceed with the original buffer
    }

    const base64Data = processedBuffer.toString('base64')
    const dataUrl = `data:${mimeType};base64,${base64Data}`

    const response = await safeRemoteFetch({
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
          { role: 'system', content: options?.systemPrompt ?? SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: { url: dataUrl }
              },
              {
                type: 'text',
                text: options?.prompt ?? DEFAULT_IMAGE_PROMPT
              }
            ]
          }
        ]
      }),
      timeoutInMilliseconds: REQUEST_TIMEOUT_MS,
      maxBodyBytes: MAX_RESPONSE_BYTES
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
      message:
        options?.logMessage ?? 'Failed to generate alt text for uploaded media',
      err: toLoggableError(error)
    })
    return null
  }
}

/**
 * Generates an alt text description of a fitness route map image using an
 * OpenAI-compatible vision chat-completions endpoint. Returns null if
 * generation fails or is empty, ensuring fitness activity processing is not blocked.
 */
export const generateRouteAltText = async (
  config: AltTextConfig,
  imageBuffer: Buffer,
  mimeType: string = 'image/png'
): Promise<string | null> => {
  return generateAltText(config, imageBuffer, mimeType, {
    systemPrompt: ROUTE_SYSTEM_PROMPT,
    prompt: DEFAULT_ROUTE_PROMPT,
    logMessage: 'Failed to generate alt text for route map'
  })
}
