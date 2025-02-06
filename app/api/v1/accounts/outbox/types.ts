import { z } from 'zod'

import { SecondsToDurationText } from '@/lib/components/PostBox/PollChoices'
import { PostBoxAttachment } from '@/lib/models/attachment'
import { Status } from '@/lib/models/status'

export const CreateNoteRequest = z.object({
  type: z.literal('note'),
  message: z.string(),
  replyStatus: Status.optional(),
  attachments: PostBoxAttachment.array().optional()
})
export type CreateNoteRequest = z.infer<typeof CreateNoteRequest>

export const CreatePollRequest = z.object({
  type: z.literal('poll'),
  message: z.string(),
  choices: z.string().array(),
  durationInSeconds: z
    .number()
    .refine(
      (value) =>
        Object.keys(SecondsToDurationText).map(parseInt).includes(value),
      `Supported duration are ${Object.keys(SecondsToDurationText).join(',')}`
    ),
  replyStatus: Status.optional()
})
export type CreatePollRequest = z.infer<typeof CreatePollRequest>

export const PostRequest = z.union([CreateNoteRequest, CreatePollRequest])
export type PostRequest = z.infer<typeof PostRequest>

export const DeleteStatusRequest = z.object({
  statusId: z.string()
})
export type DeleteStatusRequest = z.infer<typeof DeleteStatusRequest>
