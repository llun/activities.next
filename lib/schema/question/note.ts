import { z } from 'zod'

// Poll option representation in ActivityPub Question
// Each option is a Note with a name (the option text) and replies collection (vote count)
export const QuestionOption = z.object({
  type: z.literal('Note'),
  name: z.string().describe('The text of the poll option'),
  replies: z.object({
    type: z.literal('Collection'),
    totalItems: z.number().describe('The number of votes for this option')
  })
})

export type QuestionOption = z.infer<typeof QuestionOption>

// Internal alias used by Question schema (not exported to avoid conflict with main Note)
export const Note = QuestionOption
export type Note = QuestionOption
