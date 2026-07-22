import { z } from 'zod'

// FEP-044f quote handshake objects. Both are validated only after the inbound
// document has been run through `compactActivityPub`, which turns the
// `@type: @id` extension terms into bare id strings and the extension types into
// bare terms. Schemas stay liberal (no `.strict()`): we model only the fields we
// consume and tolerate everything else.

/**
 * The hosted authorization stamp the quoted author issues. It must stay
 * dereferenceable while the quote is approved; a receiver treats a quote as
 * approved only when this stamp's three fields all match.
 */
export const QuoteAuthorization = z.object({
  id: z.string(),
  type: z.literal('QuoteAuthorization'),
  // The quoted author who issued the authorization.
  attributedTo: z.string(),
  // The quoting object (the note that does the quoting).
  interactingObject: z.string(),
  // The quoted object (the status being quoted).
  interactionTarget: z.string()
})
export type QuoteAuthorization = z.infer<typeof QuoteAuthorization>

/**
 * The request a quoter sends to the quoted author's inbox. `instrument` is the
 * quoting note (embedded object or a bare id after compaction).
 */
export const QuoteRequest = z.object({
  id: z.string(),
  type: z.literal('QuoteRequest'),
  actor: z.string(),
  // The quoted status id.
  object: z.string(),
  // The quoting note (embedded object or a bare id reference).
  instrument: z.union([z.string(), z.looseObject({ id: z.string() })])
})
export type QuoteRequest = z.infer<typeof QuoteRequest>
