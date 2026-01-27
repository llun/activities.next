// This schema is base on https://docs.joinmastodon.org/entities/PreviewCard/
import { z } from "zod";

export const PreviewCard = z.object({
  url: z.string().describe("Location of linked resource"),
  title: z.string().describe("Title of linked resource"),
  description: z.string().describe("Description of preview"),
  type: z.enum(["link", "photo", "video", "rich"]).describe("The type of the preview card"),

  author_name: z.string().describe("The author of the original resource"),
  author_url: z.string().describe("A link to the author of the original resource"),

  provider_name: z.string().describe("The provider of the original resource"),
  provider_url: z.string().describe("A link to the provider of the original resource"),

  html: z.string().describe("HTML to be used for generating the preview card"),
  width: z.number().describe("Width of preview, in pixels"),
  height: z.number().describe("Height of preview, in pixels"),

  image: z.string().describe("Preview thumbnail url").nullable(),
  embed_url: z.string().describe("Used for photo embeds, instead of custom html"),
  blurhash: z
    .string()
    .describe(
      "A hash computed by the [BlurHash algorithm](https://github.com/woltapp/blurhash), for generating colorful preview thumbnails when media has not been downloaded yet"
    )
    .nullable(),
});
export type PreviewCard = z.infer<typeof PreviewCard>;
