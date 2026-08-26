// This schema is base on https://docs.joinmastodon.org/entities/MediaAttachment/#video
import { z } from 'zod'

import { BaseMediaAttachment } from './base'

export const Video = BaseMediaAttachment.extend({
  type: z.literal('video').describe('The type of the attachment (Video clip)'),
  meta: z
    .object({
      length: z.string().nullish(),
      duration: z.number().nullish(),
      fps: z.number().nullish(),

      size: z.string().describe('Video width and height in string wxh format'),
      width: z.number(),
      height: z.number(),
      aspect: z.number().describe('Aspect ratio of the video (width/height)'),

      // Focal point of the preview frame, each axis in [-1.0, 1.0]. Mastodon
      // sets one on a video the same way it does on an image — the upload path
      // stores it for video preview frames, so it has to serialise here too.
      focus: z.object({ x: z.number(), y: z.number() }).optional(),

      audio_encode: z.string().nullish(),
      audio_bitrate: z.string().nullish(),
      audio_channels: z.string().nullish(),

      original: z.object({
        width: z.number(),
        height: z.number(),
        frame_rate: z.string().nullish(),
        duration: z.number().nullish(),
        bitrate: z.number().nullish()
      }),
      small: z
        .object({
          width: z.number(),
          height: z.number(),
          size: z.string(),
          aspect: z.number()
        })
        .describe('A video preview in static image')
        .nullish()
    })
    .nullish()
})
export type Video = z.infer<typeof Video>
