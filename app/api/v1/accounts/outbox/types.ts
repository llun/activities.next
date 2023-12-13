import { z } from 'zod'

import { SecondsToDurationText } from '../../../../../lib/components/PostBox/PollChoices'
import { PostBoxAttachment } from '../../../../../lib/models/attachment'
import { StatusData } from '../../../../../lib/models/status'

export const CreateNoteRequest = z.object({
  type: z.literal('note'),
  message: z.string(),
  replyStatus: StatusData.array().optional(),
  attachments: PostBoxAttachment.array().optional()
})

export const CreatePollParams = z.object({
  type: z.literal('poll'),
  message: z.string(),
  choices: z.string().array(),
  durationInSeconds: z
    .number()
    .refine(
      (value) =>
        Object.keys(SecondsToDurationText).map(parseInt).includes(value),
      `Supported duration are ${Object.keys(SecondsToDurationText).join(',')}`
    )
})
