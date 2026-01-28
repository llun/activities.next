// ActivityPub protocol types
export * from './activities'
export * from './actor'
export * from './collections'
export * from './objects'
export * from './webfinger'

// Mastodon API types namespace
export * as Mastodon from '@/lib/types/mastodon'

// ============================================================================
// Base ActivityPub Types
// ============================================================================

export type Context =
  | string
  | { [key: string]: string | { '@id': string; '@type': string } }

export interface ContextEntity {
  '@context'?: Context | Context[]
}
