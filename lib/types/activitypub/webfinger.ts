import { z } from 'zod'

export const APLink = z.union([
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
export type APLink = z.infer<typeof APLink>

export const WebFinger = z.object({
  subject: z.string(),
  aliases: z.string().array().optional(),
  links: APLink.array()
})
export type WebFinger = z.infer<typeof WebFinger>

export interface Signature {
  type: string
  creator: string
  created: string
  signatureValue: string
}

export interface APError {
  error: string
}
