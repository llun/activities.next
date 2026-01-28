// ActivityPub types - Protocol types for federation
// All types use the AP prefix to distinguish from domain types

// Re-export context entity type
export type Context =
  | string
  | { [key: string]: string | { '@id': string; '@type': string } }

export interface ContextEntity {
  '@context'?: Context | Context[]
}

// Actor types
export { APActor, APPerson, APService } from './actor'

// Activity types
export {
  APFollow,
  ENTITY_TYPE_FOLLOW,
  APAccept,
  APReject,
  APLike,
  ENTITY_TYPE_LIKE,
  APAnnounce,
  APUndo,
  // Action type constants
  CreateAction,
  AnnounceAction,
  UndoAction,
  DeleteAction,
  UpdateAction
} from './activities'

export type { BaseActivity } from './activities'

// Object types
export {
  APImage,
  APDocument,
  APPropertyValue,
  APTombstone,
  ENTITY_TYPE_TOMBSTONE,
  APMention,
  APEmoji,
  APHashTag,
  APTag,
  APAttachment,
  APBaseContent,
  APNote,
  ENTITY_TYPE_NOTE,
  APQuestionOption,
  APQuestion,
  ENTITY_TYPE_QUESTION,
  APImageContent,
  APPageContent,
  APArticleContent,
  APVideoContent
} from './objects'

// Collection types
export {
  APCollectionPage,
  APCollectionWithFirstPage,
  APCollectionWithItems,
  APCollection,
  APOrderedCollectionPage,
  APOrderedCollection,
  APFeaturedOrderedCollection,
  getOrderCollectionFirstPage
} from './collections'

// WebFinger types
export { APLink, WebFinger } from './webfinger'
export type { Signature, APError } from './webfinger'
