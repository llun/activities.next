import { z } from 'zod'

import { APCollection } from './collections'

// ============================================================================
// Basic Objects
// ============================================================================

export const APImage = z.object({
  type: z.literal('Image'),
  mediaType: z.string().nullish(),
  url: z.string()
})
export type APImage = z.infer<typeof APImage>

export const APDocument = z.object({
  type: z.literal('Document'),
  mediaType: z.string(),
  url: z.string(),
  blurhash: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  name: z.string().optional().nullable(),
  focalPoint: z.tuple([z.number(), z.number()]).optional()
})
export type APDocument = z.infer<typeof APDocument>

export const APPropertyValue = z.object({
  type: z.literal('PropertyValue'),
  name: z.string(),
  value: z.string()
})
export type APPropertyValue = z.infer<typeof APPropertyValue>

export const APTombstone = z.object({
  type: z.literal('Tombstone'),
  id: z.string()
})
export type APTombstone = z.infer<typeof APTombstone>

export const ENTITY_TYPE_TOMBSTONE = 'Tombstone'

// ============================================================================
// Tag Types
// ============================================================================

export const APMention = z.object({
  type: z.literal('Mention'),
  href: z.string(),
  name: z.string()
})
export type APMention = z.infer<typeof APMention>

export const APEmoji = z.object({
  type: z.literal('Emoji'),
  id: z.string().optional(),
  name: z.string(),
  updated: z.string(),
  icon: APImage
})
export type APEmoji = z.infer<typeof APEmoji>

export const APHashTag = z.object({
  type: z.literal('Hashtag'),
  href: z.string().url(),
  name: z.string().startsWith('#')
})
export type APHashTag = z.infer<typeof APHashTag>

export const APTag = z.union([APMention, APEmoji, APHashTag])
export type APTag = z.infer<typeof APTag>

export const APAttachment = z.union([APPropertyValue, APDocument])
export type APAttachment = z.infer<typeof APAttachment>

// ============================================================================
// Content Types
// ============================================================================

// Base content schema shared by Note, Question, etc.
export const APBaseContent = z.object({
  id: z.string(),
  url: z.string().describe('Note URL. This is optional for Pleloma').nullish(),
  attributedTo: z.string().describe('Note publisher'),

  to: z.union([z.string(), z.string().array()]),
  cc: z.union([z.string(), z.string().array()]),

  inReplyTo: z.string().nullish(),

  summary: z.string().describe('Note short summary').nullish(),
  summaryMap: z
    .record(z.string(), z.string())
    .describe('Note short summary in each locale')
    .nullish(),

  content: z
    .union([
      z.string().describe('Note content'),
      z.string().describe('Note content in array from Wordpress').array()
    ])
    .nullish(),
  contentMap: z
    .union([
      z.record(z.string(), z.string()).describe('Note content in each locale'),
      z
        .string()
        .describe(
          'Some activity pub server use content map as array with content in the first element'
        )
        .array()
    ])
    .nullish(),
  replies: APCollection.nullish(),

  attachment: z.union([APAttachment, APAttachment.array()]).nullish(),
  tag: z.union([APTag, APTag.array()]).nullish(),

  published: z.string().describe('Object published datetime'),
  updated: z.string().describe('Object updated datetime').nullish()
})
export type APBaseContent = z.infer<typeof APBaseContent>

// Note content type
export const ENTITY_TYPE_NOTE = 'Note'
export const APNote = APBaseContent.extend({
  type: z.literal(ENTITY_TYPE_NOTE)
})
export type APNote = z.infer<typeof APNote>

// Question option for polls
export const APQuestionOption = z.object({
  type: z.literal('Note'),
  name: z.string().describe('The text of the poll option'),
  replies: z.object({
    type: z.literal('Collection'),
    totalItems: z.number().describe('The number of votes for this option')
  })
})
export type APQuestionOption = z.infer<typeof APQuestionOption>

// Question content type for polls
export const ENTITY_TYPE_QUESTION = 'Question'
export const APQuestion = APBaseContent.extend({
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
  oneOf: APQuestionOption.array()
    .describe('Poll options for single-choice polls')
    .optional(),
  // Multiple-choice poll options (mutually exclusive with oneOf)
  anyOf: APQuestionOption.array()
    .describe('Poll options for multiple-choice polls')
    .optional(),

  // Misskey extension for total unique voters
  votersCount: z
    .number()
    .describe('Total number of unique voters (Misskey extension)')
    .optional()
})
export type APQuestion = z.infer<typeof APQuestion>

// Image content type used by Pixelfed
export const APImageContent = APBaseContent.extend({
  type: z.literal('Image'),
  name: z.string().nullish(),
  mediaType: z.string().nullish(),
  width: z.number().nullish(),
  height: z.number().nullish(),
  blurhash: z.string().nullish()
})
export type APImageContent = z.infer<typeof APImageContent>

// Page content type used by WriteFreely
export const APPageContent = APBaseContent.extend({
  type: z.literal('Page'),
  name: z.string().nullish(),
  mediaType: z.string().nullish(),
  width: z.number().nullish(),
  height: z.number().nullish(),
  blurhash: z.string().nullish()
})
export type APPageContent = z.infer<typeof APPageContent>

// Article content type
export const APArticleContent = APBaseContent.extend({
  type: z.literal('Article'),
  name: z.string().nullish(),
  mediaType: z.string().nullish(),
  width: z.number().nullish(),
  height: z.number().nullish(),
  blurhash: z.string().nullish()
})
export type APArticleContent = z.infer<typeof APArticleContent>

// Video content type used by PeerTube
export const APVideoContent = APBaseContent.extend({
  type: z.literal('Video'),
  name: z.string().nullish(),
  mediaType: z.string().nullish(),
  width: z.number().nullish(),
  height: z.number().nullish(),
  blurhash: z.string().nullish()
})
export type APVideoContent = z.infer<typeof APVideoContent>
