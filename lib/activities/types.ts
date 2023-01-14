export interface Signature {
  type: string
  creator: string
  created: string
  signatureValue: string
}

export type Link =
  | { rel: string; template: string }
  | { rel: string; type?: string; href: string }

export interface WebFinger {
  subject: string
  aliases: string[]
  links: Link[]
}

export interface Error {
  error: string
}
