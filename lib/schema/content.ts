import { z } from 'zod'

import { BaseContent } from './note/baseContent'
import { Note as QuestionOptionNote } from './question/note'

/**
 * Note content type - the standard ActivityPub content type.
 */
export const ENTITY_TYPE_NOTE = 'Note'
export const Note = BaseContent.extend({
  type: z.literal(ENTITY_TYPE_NOTE)
})
export type Note = z.infer<typeof Note>

/**
 * Question content type for polls.
 */
export const ENTITY_TYPE_QUESTION = 'Question'
export const Question = BaseContent.extend({
  type: z.literal(ENTITY_TYPE_QUESTION),

  endTime: z
    .string()
    .describe('Question end time in ISO 8601 datetime format')
    .optional(),
  closed: z
    .string()
    .describe(
      'The datetime when the poll was closed, in ISO 8601 format. Used when a poll is closed early'
    )
    .nullish(),

  // Single-choice poll options (mutually exclusive with anyOf)
  oneOf: QuestionOptionNote.array()
    .describe('Poll options for single-choice polls')
    .optional(),
  // Multiple-choice poll options (mutually exclusive with oneOf)
  anyOf: QuestionOptionNote.array()
    .describe('Poll options for multiple-choice polls')
    .optional(),

  // Misskey extension for total unique voters
  votersCount: z
    .number()
    .describe('Total number of unique voters (Misskey extension)')
    .optional()
})
export type Question = z.infer<typeof Question>

/**
 * Image content type used by Pixelfed and similar services.
 * Extends BaseContent with image-specific properties.
 */
export const ImageContent = BaseContent.extend({
  type: z.literal('Image'),
  name: z.string().nullish(),
  mediaType: z.string().nullish(),
  width: z.number().nullish(),
  height: z.number().nullish(),
  blurhash: z.string().nullish()
})
export type ImageContent = z.infer<typeof ImageContent>

/**
 * Page content type used by WriteFreely and similar services.
 */
export const PageContent = BaseContent.extend({
  type: z.literal('Page'),
  name: z.string().nullish(),
  mediaType: z.string().nullish(),
  width: z.number().nullish(),
  height: z.number().nullish(),
  blurhash: z.string().nullish()
})
export type PageContent = z.infer<typeof PageContent>

/**
 * Article content type used by blogs and similar services.
 */
export const ArticleContent = BaseContent.extend({
  type: z.literal('Article'),
  name: z.string().nullish(),
  mediaType: z.string().nullish(),
  width: z.number().nullish(),
  height: z.number().nullish(),
  blurhash: z.string().nullish()
})
export type ArticleContent = z.infer<typeof ArticleContent>

/**
 * Video content type used by PeerTube and similar services.
 */
export const VideoContent = BaseContent.extend({
  type: z.literal('Video'),
  name: z.string().nullish(),
  mediaType: z.string().nullish(),
  width: z.number().nullish(),
  height: z.number().nullish(),
  blurhash: z.string().nullish()
})
export type VideoContent = z.infer<typeof VideoContent>
