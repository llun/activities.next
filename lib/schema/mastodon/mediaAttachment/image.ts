// This schema is base on https://docs.joinmastodon.org/entities/MediaAttachment/#image
import { z } from "zod";
import { BaseMediaAttachment } from "./base";

export const Image = BaseMediaAttachment.extend({
  type: z
    .literal("image")
    .describe("The type of the attachment (Static image)"),
  meta: z
    .object({
      original: z.object({
        width: z.number(),
        height: z.number(),
        size: z.string(),
        aspect: z.number(),
      }),
      small: z
        .object({
          width: z.number(),
          height: z.number(),
          size: z.string(),
          aspect: z.number(),
        })
        .nullish(),
      focus: z
        .object({
          x: z.number(),
          y: z.number(),
        })
        .nullish(),
    })
    .nullish(),
});
export type Image = z.infer<typeof Image>;
