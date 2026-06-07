// This schema is based on https://docs.joinmastodon.org/entities/Translation/
import { z } from 'zod'

export const TranslationMediaAttachment = z.object({
  id: z.string().describe('The ID of the media attachment'),
  description: z
    .string()
    .describe('The translated description of the media attachment')
})
export type TranslationMediaAttachment = z.infer<
  typeof TranslationMediaAttachment
>

export const TranslationPollOption = z.object({
  title: z.string().describe('The translated text of the poll option')
})
export type TranslationPollOption = z.infer<typeof TranslationPollOption>

export const TranslationPoll = z.object({
  id: z.string().describe('The ID of the poll'),
  options: TranslationPollOption.array().describe('The translated poll options')
})
export type TranslationPoll = z.infer<typeof TranslationPoll>

export const Translation = z.object({
  content: z.string().describe('The translated text of the status (HTML)'),
  spoiler_text: z
    .string()
    .describe('The translated spoiler warning of the status'),
  language: z
    .string()
    .describe('The language of the translation output, as ISO 639-1'),
  media_attachments: TranslationMediaAttachment.array(),
  poll: TranslationPoll.nullable(),
  detected_source_language: z
    .string()
    .describe('The language of the source text, as ISO 639-1'),
  provider: z.string().describe('The service that provided the translation')
})
export type Translation = z.infer<typeof Translation>
