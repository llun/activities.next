import { Status } from '@/lib/models/status'
import { Timeline } from '@/lib/services/timelines/types'

export type GetTimelineParams = {
  timeline: Timeline
  actorId?: string
  startAfterStatusId?: string | null
  limit?: number
}
export type CreateTimelineStatusParams = {
  timeline: Timeline
  actorId: string
  status: Status
}

export interface TimelineDatabase {
  getTimeline({
    timeline,
    actorId,
    startAfterStatusId,
    limit
  }: GetTimelineParams): Promise<Status[]>
  createTimelineStatus(params: CreateTimelineStatusParams): Promise<void>
}
