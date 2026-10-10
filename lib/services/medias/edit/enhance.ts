import { PhotoEditorEnhanceConfig } from '@/lib/config/photoEditor'
import { requestVisionCompletion } from '@/lib/services/altText/openai'

import {
  ENHANCE_MAX_TOKENS,
  ENHANCE_SYSTEM_PROMPT,
  ENHANCE_USER_PROMPT
} from './enhancePrompt'
import { type EnhanceResponse, parseEnhanceAnswer } from './enhanceSchema'

export class EnhanceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EnhanceError'
  }
}

/**
 * Asks the vision model for three styled suggestions for one preview.
 * THROWS `EnhanceError` when the answer is empty or does not parse strictly,
 * and lets a transport or non-200 failure from `requestVisionCompletion`
 * propagate; the route answers both as 502. The preview is sent to the model
 * and forgotten: nothing is stored.
 */
export const requestEnhance = async (
  config: PhotoEditorEnhanceConfig,
  preview: Buffer
): Promise<EnhanceResponse> => {
  const answer = await requestVisionCompletion(config, preview, 'image/jpeg', {
    systemPrompt: ENHANCE_SYSTEM_PROMPT,
    prompt: ENHANCE_USER_PROMPT,
    maxTokens: ENHANCE_MAX_TOKENS
  })
  if (!answer) throw new EnhanceError('The model answered with nothing')

  const suggestion = parseEnhanceAnswer(answer)
  if (!suggestion) {
    throw new EnhanceError('The model did not answer with valid adjustments')
  }
  return { ...suggestion, model: config.model }
}
