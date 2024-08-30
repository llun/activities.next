import { z } from 'zod'

import { CreateNoteJobMessage } from '@/lib/actions/createNote'

export const JobMessage = CreateNoteJobMessage
export type JobMessage = z.infer<typeof JobMessage>

export interface Queue {
  publish(message: JobMessage): Promise<void>
  handle(message: JobMessage): Promise<void>
}
