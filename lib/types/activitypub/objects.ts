// ActivityPub Object types
import { z } from 'zod'

import { Collection } from './collections'

// ============================================================================
// Basic Objects
// ============================================================================

export const Image = z.object({
  type: z.literal('Image'),
  mediaType: z.string().nullish(),
  url: z.string()
})

export type Image = z.infer<typeof Image>

export const Document = z.object({
  type: z.literal('Document'),
  mediaType: z.string(),
  url: z.string(),
  blurhash: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  name: z.string().optional().nullable(),
  focalPoint: z.tuple([z.number(), z.number()]).optional()
})

export type Document = z.infer<typeof Document>

export const PropertyValue = z.object({
  type: z.literal('PropertyValue'),
  name: z.string(),
  value: z.string()
})

export type PropertyValue = z.infer<typeof PropertyValue>

// ============================================================================
// Tags
// ============================================================================

export const Mention = z.object({
  type: z.literal('Mention'),
  href: z.string(),
  name: z.string()
})

export type Mention = z.infer<typeof Mention>

export const HashTag = z.object({
  type: z.literal('Hashtag'),
  href: z.string().url(),
  name: z.string().startsWith('#')
})

export type HashTag = z.infer<typeof HashTag>

export const Emoji = z.object({
  type: z.literal('Emoji'),
  id: z.string().optional(),
  name: z.string(),
  updated: z.string(),
  icon: Image
})

export type Emoji = z.infer<typeof Emoji>

export const Tag = z.union([Mention, Emoji, HashTag])
export type Tag = z.infer<typeof Tag>

// ============================================================================
// Attachments
// ============================================================================

export const Attachment = z.union([PropertyValue, Document])
export type Attachment = z.infer<typeof Attachment>

// ============================================================================
// Content Types (Notes, Questions, etc.)
// ============================================================================

export const BaseContent = z.object({
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
  replies: Collection.nullish(),

  attachment: z.union([Attachment, Attachment.array()]).nullish(),
  tag: z.union([Tag, Tag.array()]).nullish(),

  published: z.string().describe('Object published datetime'),
  updated: z.string().describe('Object updated datetime').nullish()
})

export type BaseContent = z.infer<typeof BaseContent>

/**
 * Note content type - the standard ActivityPub content type.
 */
export const ENTITY_TYPE_NOTE = 'Note'
export const Note = BaseContent.extend({
  type: z.literal(ENTITY_TYPE_NOTE)
})
export type Note = z.infer<typeof Note>

/**
 * Poll option representation in ActivityPub Question
 * Each option is a Note with a name (the option text) and replies collection (vote count)
 */
export const QuestionOption = z.object({
  type: z.literal('Note'),
  name: z.string().describe('The text of the poll option'),
  replies: z.object({
    type: z.literal('Collection'),
    totalItems: z.number().describe('The number of votes for this option')
  })
})

export type QuestionOption = z.infer<typeof QuestionOption>

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
  oneOf: QuestionOption.array()
    .describe('Poll options for single-choice polls')
    .optional(),
  // Multiple-choice poll options (mutually exclusive with oneOf)
  anyOf: QuestionOption.array()
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
  name: z.string().nullish()
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

// ============================================================================
// Tombstone (Deleted Object)
// ============================================================================

export const ENTITY_TYPE_TOMBSTONE = 'Tombstone'
export const Tombstone = z.object({
  type: z.literal(ENTITY_TYPE_TOMBSTONE),
  id: z.string()
})
export type Tombstone = z.infer<typeof Tombstone>
