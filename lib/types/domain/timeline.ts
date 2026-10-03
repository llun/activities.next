import { Status } from '@/lib/types/database'
import { Tag } from '@/lib/types/domain/tag'

export interface TimelineParentPreview {
  id: string
  url?: string
  actor: {
    id: string
    username: string
    domain: string
    name?: string
    avatarUrl?: string
  }
  contentHtml: string
  text?: string
  tags?: Tag[]
  isLocalActor?: boolean
  spoilerText?: string
  isSensitive?: boolean
  createdAt: string
  inReplyToId?: string
  inReplyToUrl?: string
  visibility: Status['visibility']
}

export interface TimelineContext {
  ancestorsById: Record<string, TimelineParentPreview>
}
