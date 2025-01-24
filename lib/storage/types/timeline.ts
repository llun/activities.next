import { Status } from '@/lib/models/status'
import { Timeline } from '@/lib/services/timelines/types'

export type GetTimelineParams = {
  timeline: Timeline
  actorId?: string
  startAfterStatusId?: string | null
}
export type CreateTimelineStatusParams = {
  timeline: Timeline
  actorId: string
  status: Status
}

export interface TimelineStorage {
  getTimeline({
    timeline,
    actorId,
    startAfterStatusId
  }: GetTimelineParams): Promise<Status[]>
  createTimelineStatus(params: CreateTimelineStatusParams): Promise<void>
}
