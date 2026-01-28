// This schema is base on https://docs.joinmastodon.org/entities/MediaAttachment/#audio
import { z } from 'zod'

import { BaseMediaAttachment } from './base'

export const Audio = BaseMediaAttachment.extend({
  type: z.literal('audio').describe('The type of the attachment (Audio track)'),
  meta: z.object({
    length: z.string(),
    duration: z.number(),
    audio_encode: z.string().nullish(),
    audio_bitrate: z.string().nullish(),
    audio_channels: z.string().nullish(),
    original: z.object({
      duration: z.number(),
      bitrate: z.number().nullish()
    })
  })
})
export type Audio = z.infer<typeof Audio>
