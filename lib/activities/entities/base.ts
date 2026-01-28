// Base types for ActivityPub entities
// These are utility types used by action definitions

export type Context =
  | string
  | { [key: string]: string | { '@id': string; '@type': string } }

export interface ContextEntity {
  '@context'?: Context | Context[]
}
