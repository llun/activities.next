import { z } from 'zod'

import { SecondsToDurationText } from '@/lib/components/post-box/poll-choices'
import { PostBoxAttachment } from '@/lib/models/attachment'
import { Status } from '@/lib/models/status'
import { MastodonVisibility } from '@/lib/utils/getVisibility'

export const CreateNoteRequest = z.object({
  type: z.literal('note'),
  message: z.string(),
  replyStatus: Status.optional(),
  attachments: PostBoxAttachment.array().optional(),
  visibility: z
    .enum(['public', 'unlisted', 'private', 'direct'])
    .optional() as z.ZodOptional<z.ZodType<MastodonVisibility>>
})
export type CreateNoteRequest = z.infer<typeof CreateNoteRequest>

export const CreatePollRequest = z.object({
  type: z.literal('poll'),
  message: z.string(),
  choices: z.string().array(),
  pollType: z.enum(['oneOf', 'anyOf']).optional(),
  durationInSeconds: z
    .number()
    .refine(
      (value) =>
        Object.keys(SecondsToDurationText).map(parseInt).includes(value),
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
