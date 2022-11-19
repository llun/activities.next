export type Context =
  | string
  | { [key in string]: string | { '@id': string; '@type': string } }

export interface ContextEntity {
  '@context': Context | Context[]
}
