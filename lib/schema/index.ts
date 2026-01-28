// Re-export ActivityPub types from new location with backward compatible names
import { z } from 'zod'

import {
  APAccept,
  APAnnounce,
  APArticleContent,
  APDocument,
  APEmoji,
  APFollow,
  APHashTag,
  APImage,
  APImageContent,
  APLike,
  APMention,
  APNote,
  APPageContent,
  APPropertyValue,
  APQuestion,
  APQuestionOption,
  APReject,
  APTombstone,
  APUndo,
  APVideoContent,
  APActor as ActorSchema,
  ENTITY_TYPE_FOLLOW,
  ENTITY_TYPE_LIKE,
  ENTITY_TYPE_NOTE,
  ENTITY_TYPE_QUESTION,
  ENTITY_TYPE_TOMBSTONE,
  APPerson as PersonSchema,
  APService as ServiceSchema
} from '@/lib/types/activitypub'

// Entity type constants
export {
  ENTITY_TYPE_FOLLOW,
  ENTITY_TYPE_LIKE,
  ENTITY_TYPE_NOTE,
  ENTITY_TYPE_QUESTION,
  ENTITY_TYPE_TOMBSTONE
}

// Actor types with backward compatible names
export const Actor = ActorSchema
export type Actor = z.infer<typeof ActorSchema>
export const Person = PersonSchema
export type Person = z.infer<typeof PersonSchema>
export const Service = ServiceSchema
export type Service = z.infer<typeof ServiceSchema>

// ActivityPub activities with backward compatible names
export const Accept = APAccept
export type Accept = z.infer<typeof APAccept>
export const Follow = APFollow
export type Follow = z.infer<typeof APFollow>
export const Like = APLike
export type Like = z.infer<typeof APLike>
export const Reject = APReject
export type Reject = z.infer<typeof APReject>
export const Undo = APUndo
export type Undo = z.infer<typeof APUndo>
export const Announce = APAnnounce
export type Announce = z.infer<typeof APAnnounce>

// ActivityPub objects with backward compatible names
export const Image = APImage
export type Image = z.infer<typeof APImage>
export const Document = APDocument
export type Document = z.infer<typeof APDocument>
export const PropertyValue = APPropertyValue
export type PropertyValue = z.infer<typeof APPropertyValue>
export const Tombstone = APTombstone
export type Tombstone = z.infer<typeof APTombstone>
export const Mention = APMention
export type Mention = z.infer<typeof APMention>
export const Emoji = APEmoji
export type Emoji = z.infer<typeof APEmoji>
export const HashTag = APHashTag
export type HashTag = z.infer<typeof APHashTag>

// Content types with backward compatible names
export const Note = APNote
export type Note = z.infer<typeof APNote>
export const Question = APQuestion
export type Question = z.infer<typeof APQuestion>
export const QuestionOption = APQuestionOption
export type QuestionOption = z.infer<typeof APQuestionOption>
export const ImageContent = APImageContent
export type ImageContent = z.infer<typeof APImageContent>
export const PageContent = APPageContent
export type PageContent = z.infer<typeof APPageContent>
export const ArticleContent = APArticleContent
export type ArticleContent = z.infer<typeof APArticleContent>
export const VideoContent = APVideoContent
export type VideoContent = z.infer<typeof APVideoContent>

// Re-export Mastodon namespace for backward compatibility
export * as Mastodon from './mastodon/index'
