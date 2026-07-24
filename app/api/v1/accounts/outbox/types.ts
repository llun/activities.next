import { z } from 'zod'

import {
  MIN_POLL_OPTIONS,
  POLL_OPTIONS_CEILING,
  POLL_OPTION_CHARS_CEILING
} from '@/lib/services/mastodon/constants'
import { SecondsToDurationText } from '@/lib/services/statuses/pollDurations'
import { PostBoxAttachment } from '@/lib/types/domain/attachment'
import { QuoteApprovalPolicy, Status } from '@/lib/types/domain/status'
import { MastodonVisibility } from '@/lib/utils/getVisibility'

export const CreateNoteRequest = z.object({
  type: z.literal('note'),
  message: z.string(),
  contentWarning: z.string().optional(),
  replyStatus: Status.optional(),
  attachments: PostBoxAttachment.array().optional(),
  fitnessFileId: z.string().optional(),
  // The canonical URL id of the status this note quotes (FEP-044f), if any.
  quotedStatusId: z.string().optional(),
  // Who may quote the new status; omitted defaults to the actor's setting.
  quoteApprovalPolicy: QuoteApprovalPolicy.optional(),
  visibility: z
    .enum(['public', 'unlisted', 'private', 'direct'])
    .optional() as z.ZodOptional<z.ZodType<MastodonVisibility>>
})
export type CreateNoteRequest = z.infer<typeof CreateNoteRequest>

export const CreatePollRequest = z.object({
  type: z.literal('poll'),
  message: z.string(),
  contentWarning: z.string().optional(),
  // Same structural floor and safety ceilings as PollSchema in
  // app/api/v1/statuses/route.ts, so the two create endpoints agree on what a
  // well-formed poll is; the admin-configured bounds are applied on top at
  // runtime by validateStatusContentLimits.
  choices: z
    .array(z.string().trim().min(1).max(POLL_OPTION_CHARS_CEILING))
    .min(MIN_POLL_OPTIONS)
    .max(POLL_OPTIONS_CEILING),
  pollType: z.enum(['oneOf', 'anyOf']).optional(),
  // `.map(parseInt)` would pass the array index as the radix — '1800' parsed
  // base 1 is NaN, '21600' base 3 is 7, and so on — so all but the first
  // duration silently failed validation. Parse each key explicitly. (The list
  // itself was also empty on the server until the durations moved out of the
  // 'use client' poll editor, so in practice no duration validated at all.)
  durationInSeconds: z.number().refine(
    (value) =>
      Object.keys(SecondsToDurationText)
        .map((seconds) => parseInt(seconds, 10))
        .includes(value),
    `Supported duration are ${Object.keys(SecondsToDurationText).join(',')}`
  ),
  replyStatus: Status.optional(),
  visibility: z
    .enum(['public', 'unlisted', 'private', 'direct'])
    .optional() as z.ZodOptional<z.ZodType<MastodonVisibility>>
})
export type CreatePollRequest = z.infer<typeof CreatePollRequest>

export const PostRequest = z.union([CreateNoteRequest, CreatePollRequest])
export type PostRequest = z.infer<typeof PostRequest>

export const DeleteStatusRequest = z.object({
  statusId: z.string()
})
export type DeleteStatusRequest = z.infer<typeof DeleteStatusRequest>
