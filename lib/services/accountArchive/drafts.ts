import { z } from 'zod'

import { ARCHIVE_DRAFTS_MAX_BYTES } from './constants'

const MAX_DRAFTS = 2000
const MAX_TEXT = 200_000
const SHORT = 2000

const reference = z
  .object({
    id: z.string().max(SHORT),
    url: z.string().max(SHORT).optional()
  })
  .optional()

// Only the fields below survive: the schema is an allowlist, so a draft record
// that grows a field later (queue claims, idempotency keys, blob bytes) does
// not leak into the file. Attachments keep their metadata and server URLs but
// never the bytes (`hasBlob` is dropped with them).
const attachment = z.object({
  localId: z.string().max(SHORT),
  mediaId: z.string().max(SHORT).optional(),
  mediaType: z.string().max(SHORT),
  fileName: z.string().max(SHORT),
  width: z.number().optional(),
  height: z.number().optional(),
  url: z.string().max(SHORT).optional(),
  posterUrl: z.string().max(SHORT).optional(),
  description: z.string().max(MAX_TEXT),
  decorative: z.boolean().optional()
})

const draft = z.object({
  id: z.string().max(SHORT),
  actorId: z.string().max(SHORT).optional(),
  revision: z.number().int().nonnegative().optional(),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
  composer: z.enum(['post-box', 'reply-box']),
  text: z.string().max(MAX_TEXT),
  contentWarning: z.string().max(MAX_TEXT).default(''),
  contentWarningVisible: z.boolean().optional(),
  visibility: z.string().max(SHORT).optional(),
  quoteApprovalPolicy: z.string().max(SHORT).optional(),
  language: z.string().max(SHORT).optional(),
  replyTo: reference,
  quoteOf: reference,
  poll: z
    .object({
      choices: z.array(z.string().max(SHORT)).max(100),
      durationInSeconds: z.number().optional(),
      pollType: z.enum(['oneOf', 'anyOf'])
    })
    .optional(),
  attachments: z.array(attachment).max(100).default([]),
  fitnessFile: z
    .object({
      localId: z.string().max(SHORT),
      fileName: z.string().max(SHORT),
      mimeType: z.string().max(SHORT),
      size: z.number(),
      fitnessFileId: z.string().max(SHORT).optional()
    })
    .optional()
})

const Payload = z.array(draft).max(MAX_DRAFTS)

export type ArchiveDraftsResult =
  | { ok: true; json: string; count: number }
  | { ok: false; reason: 'too-large' | 'invalid' }

/**
 * Validates the drafts a request carries and returns the JSON the archive
 * stores as `activities.next/drafts.json`. The payload comes from the browser's
 * IndexedDB, so nothing in it is trusted: it is size-capped before and after
 * validation and reduced to the allowlisted fields.
 */
export const prepareArchiveDrafts = (
  input: unknown,
  { now = Date.now }: { now?: () => number } = {}
): ArchiveDraftsResult => {
  let serialized: string | undefined
  try {
    serialized = JSON.stringify(input)
  } catch {
    return { ok: false, reason: 'invalid' }
  }
  if (serialized === undefined) return { ok: false, reason: 'invalid' }
  if (Buffer.byteLength(serialized, 'utf8') > ARCHIVE_DRAFTS_MAX_BYTES) {
    return { ok: false, reason: 'too-large' }
  }

  const parsed = Payload.safeParse(input)
  if (!parsed.success) return { ok: false, reason: 'invalid' }

  const json = `${JSON.stringify(
    {
      version: 1,
      exportedAt: new Date(now()).toISOString(),
      drafts: parsed.data
    },
    null,
    2
  )}\n`
  if (Buffer.byteLength(json, 'utf8') > ARCHIVE_DRAFTS_MAX_BYTES) {
    return { ok: false, reason: 'too-large' }
  }
  return { ok: true, json, count: parsed.data.length }
}
