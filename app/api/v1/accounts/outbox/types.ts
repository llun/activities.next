import { z } from 'zod'

import { SecondsToDurationText } from '@/lib/components/post-box/poll-durations'
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
  choices: z.string().array(),
  pollType: z.enum(['oneOf', 'anyOf']).optional(),
  // `.map(parseInt)` would pass the array index as the radix — '1800' parsed
  // base 1 is NaN, '21600' base 3 is 7, and so on — so every duration except
  // the first silently failed validation and the composer could only create
  // 5-minute polls. Parse each key explicitly.
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
