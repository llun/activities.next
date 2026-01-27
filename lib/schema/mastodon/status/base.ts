// This schema is base on https://docs.joinmastodon.org/entities/Status/
import { z } from "zod";
import { Account } from "../account";
import { Visibility } from "../visibility";
import { MediaAttachment } from "../mediaAttachment/index";
import { Application } from "./application";
import { CustomEmoji } from "../customEmoji";
import { Poll } from "../poll/index";
import { PreviewCard } from "../previewCard";
import { FilterResult } from "../filterResult";
import { Mention } from "./mention";
import { Tag } from "./tag";

export const BaseStatus = z.object({
  id: z.string().describe(
    "ID of the status in the database, for Mastodon, it is numeric casting to string. For Activities.next, this is equal to status URI"
  ),
  uri: z.string().describe("URI of the status used for federation"),

  account: Account.describe("The actor that authored the status"),

  content: z.string().describe("HTML-encoded status content"),
  visibility: Visibility.describe("Visibility of this status"),
  sensitive: z.boolean().describe("Is this status marked as sensitive content?"),
  spoiler_text: z.string().describe(
    "Subject or summary line, below which status content is collapsed until expanded"
  ),

  media_attachments: MediaAttachment.array(),
  application: Application.optional(),
  emojis: CustomEmoji.array().describe(
    "Custom emoji to be used when rendering status content"
  ),

  mentions: Mention.array().describe(
    "Mentions of users within the status content"
  ),
  tags: Tag.array().describe("Hashtags used within the status content"),

  reblogs_count: z.number().describe("How many boosts this status has received"),
  favourites_count: z.number().describe("How many favourites this status has received"),
  replies_count: z.number().describe("How many replies this status has received"),

  url: z
    .string()
    .describe("A link to the status's HTML representation")
    .nullable(),
  in_reply_to_id: z
    .string()
    .describe("ID of the status being replied to")
    .nullable(),
  in_reply_to_account_id: z
    .string()
    .describe("ID of the actor that authored the status being replied to")
    .nullable(),

  poll: Poll.nullable().describe("The poll attached to the status"),
  card: PreviewCard.nullable().describe(
    "Preview card for links included within status content"
  ),

  language: z
    .string()
    .describe(
      "Primary language of this status in ISO 639 Part 1 two-letter language code"
    )
    .nullable(),

  text: z
    .string()
    .describe(
      "Plain-text source of a status. Returned instead of `content` when status is deleted, so the user may redraft from the source text without the client having to reverse-engineer the original text from the HTML content"
    )
    .nullable(),

  created_at: z.string().describe(
    "The date when this status was created in ISO 8601 Datetime format"
  ),
  edited_at: z
    .string()
    .describe(
      "Timestamp of when the status was last edited in ISO 8601 Datetime format"
    )
    .nullable(),

  favourited: z
    .boolean()
    .describe(
      "If the current token has an authorized user: Have you favourited this status?"
    )
    .optional(),
  reblogged: z
    .boolean()
    .describe(
      "If the current token has an authorized user: Have you boosted this status?"
    )
    .optional(),
  muted: z
    .boolean()
    .describe(
      "If the current token has an authorized user: Have you muted notifications for this status's conversation?"
    )
    .optional(),
  bookmarked: z
    .boolean()
    .describe(
      "If the current token has an authorized user: Have you bookmarked this status?"
    )
    .optional(),
  pinned: z
    .boolean()
    .describe(
      "If the current token has an authorized user: Have you pinned this status? Only appears if the status is pinnable"
    )
    .optional(),
  filtered: FilterResult.optional().describe(
    "If the current token has an authorized user: The filter and keywords that matched this status"
  ),
});
export type BaseStatus = z.infer<typeof BaseStatus>;
