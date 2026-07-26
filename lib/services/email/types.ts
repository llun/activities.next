import { z } from 'zod'

export const Email = z.union([
  z.string(),
  z.object({ name: z.string(), email: z.string() })
])
export type Email = z.infer<typeof Email>

export const Message = z.object({
  from: Email,
  to: Email.array(),
  replyTo: Email.optional(),
  subject: z.string(),
  content: z.object({
    text: z.string(),
    html: z.string()
  })
})
export type Message = z.infer<typeof Message>

export const BaseEmailSettings = z.object({ serviceFromAddress: z.string() })
export type BaseEmailSettings = z.infer<typeof BaseEmailSettings>

/**
 * What every `build*Email()` template module returns: a subject plus the two
 * media that must stay in step. Templates never assemble a `Message` themselves
 * — the caller supplies `from`/`to` and spreads this in, so a template stays a
 * pure function of its inputs and can be rendered in a test or a preview script
 * without any mail configuration.
 */
export interface RenderedEmail {
  subject: string
  text: string
  html: string
}
