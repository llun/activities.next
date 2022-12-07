export type Context =
  | string
  | { [key: string]: string | { '@id': string; '@type': string } }

export interface ContextEntity {
  '@context'?: Context | Context[]
}
