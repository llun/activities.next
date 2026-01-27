// This schema is base on https://docs.joinmastodon.org/entities/MediaAttachment/#video
import { z } from "zod";
import { BaseMediaAttachment } from "./base";

export const Video = BaseMediaAttachment.extend({
  type: z.literal("video").describe("The type of the attachment (Video clip)"),
  meta: z
    .object({
      length: z.string().nullish(),
      duration: z.number().nullish(),
      fps: z.number().nullish(),

      size: z.string().describe("Video width and height in string wxh format"),
      width: z.number(),
      height: z.number(),
      aspect: z.number().describe("Aspect ratio of the video (width/height)"),

      audio_encode: z.string().nullish(),
      audio_bitrate: z.string().nullish(),
      audio_channels: z.string().nullish(),

      original: z.object({
        width: z.number(),
        height: z.number(),
        frame_rate: z.string().nullish(),
        duration: z.number().nullish(),
        bitrate: z.number().nullish(),
      }),
      small: z
        .object({
          width: z.number(),
          height: z.number(),
          size: z.string(),
          aspect: z.number(),
        })
        .describe("A video preview in static image")
        .nullish(),
    })
    .nullish(),
});
export type Video = z.infer<typeof Video>;
