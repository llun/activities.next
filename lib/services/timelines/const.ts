import { z } from 'zod'

export const TimelineFormat = z.enum(['activities_next', 'mastodon'])
export type TimelineFormat = z.infer<typeof TimelineFormat>
