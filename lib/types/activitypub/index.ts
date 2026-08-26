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

// A term definition is an IRI, or an expanded form carrying any of JSON-LD's
// keywords — `@type` for a typed value, `@container` for an ordered list such
// as `toot:focalPoint`, which loses its ordering without it.
export type TermDefinition = {
  '@id': string
  '@type'?: string
  '@container'?: string
}

export type Context = string | { [key: string]: string | TermDefinition }

export interface ContextEntity {
  '@context'?: Context | Context[]
}
