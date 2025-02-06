import { z } from 'zod'

export const Link = z.union([
  z.object({
    rel: z.string(),
    template: z.string()
  }),
  z.object({
    rel: z.string(),
    href: z.string(),
    type: z.string().optional()
  })
])
export type Link = z.infer<typeof Link>

export const WebFinger = z.object({
  subject: z.string(),
  aliases: z.string().array(),
  links: Link.array()
})
export type WebFinger = z.infer<typeof WebFinger>

export interface Signature {
  type: string
  creator: string
  created: string
  signatureValue: string
}

export interface Error {
  error: string
}
