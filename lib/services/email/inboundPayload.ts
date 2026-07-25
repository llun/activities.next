import { z } from 'zod'

// The normalized shape an email provider POSTs to /api/v1/webhooks/email.
// Providers differ in what they send; this models only the parts the reply
// pipeline consumes, and stays liberal about the rest.

export const InboundEmailAttachment = z.object({
  filename: z.string().max(255).optional(),
  contentType: z.string().max(255),
  contentBase64: z.string(),
  // Set by the provider for a part referenced from the HTML body with `cid:`
  // — a signature logo or an image embedded in the quoted history, not
  // something the sender chose to attach.
  contentId: z.string().max(255).optional(),
  disposition: z.string().max(64).optional()
})
export type InboundEmailAttachment = z.infer<typeof InboundEmailAttachment>

export const InboundEmailPayload = z.object({
  // Both are searched for our reply address: on a reply-all the plus-addressed
  // recipient often lands in cc rather than to.
  to: z.array(z.string().max(998)).default([]),
  cc: z.array(z.string().max(998)).default([]),
  from: z.string().max(998).optional(),
  // RFC 5322 caps a header line at 998 octets.
  messageId: z.string().max(998).optional(),
  subject: z.string().max(998).optional(),
  text: z.string().optional(),
  html: z.string().optional(),
  attachments: z.array(InboundEmailAttachment).optional()
})
export type InboundEmailPayload = z.infer<typeof InboundEmailPayload>
