import { formatDistanceToNow } from 'date-fns'
import _ from 'lodash'
import { Repeat2 } from 'lucide-react'
import { FC } from 'react'

import { ActorProfile } from '@/lib/models/actor'
import { EditableStatus, Status, StatusType } from '@/lib/models/status'
import { cleanClassName } from '@/lib/utils/text/cleanClassName'
import {
  getActualStatus,
  processStatusText
} from '@/lib/utils/text/processStatusText'

import { Actions } from './Actions'
import { ActorAvatar, ActorInfo } from './Actor'
import { Attachments, OnMediaSelectedHandle } from './Attachments'
import { Poll } from './Poll'

export interface PostProps {
  host: string
  currentActor?: ActorProfile
  currentTime: Date
  status: Status
  editable?: boolean
  showActions?: boolean
  onReply?: (status: Status) => void
  onEdit?: (status: EditableStatus) => void
  onPostDeleted?: (status: Status) => void
  onShowAttachment: OnMediaSelectedHandle
}

interface BoostStatusProps {
  status: Status
}
export const BoostStatus: FC<BoostStatusProps> = ({ status }) => {
  if (status.type !== StatusType.enum.Announce) return null
  return (
    <div className="flex items-center gap-2 mb-1 text-sm text-muted-foreground ml-12">
      <Repeat2 className="size-4" />
      <span>Boosted by {status.actor?.name || status.actor?.username}</span>
    </div>
  )
}

export const Post: FC<PostProps> = (props) => {
  const { host, status, onShowAttachment } = props
  const actualStatus = getActualStatus(status)

  const processedAndCleanedText = _.chain(actualStatus)
    .thru((s) => processStatusText(host, s))
    .thru(cleanClassName)
    .value()

  return (
    <div className="flex flex-col gap-1">
      <BoostStatus status={status} />
      <div className="flex gap-3">
        <div className="shrink-0">
          <ActorAvatar actor={actualStatus.actor} actorId={actualStatus.actorId} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 text-sm">
            <ActorInfo actor={actualStatus.actor} actorId={actualStatus.actorId} />
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground text-xs whitespace-nowrap">
              {formatDistanceToNow(actualStatus.createdAt)}
            </span>
          </div>

          <div 
            className="mt-1 text-sm leading-relaxed break-words [&_p]:mb-4 last:[&_p]:mb-0"
            dangerouslySetInnerHTML={{ __html: processedAndCleanedText }}
          />
          
          <Poll status={actualStatus} currentTime={new Date()} />
          <Attachments status={actualStatus} onMediaSelected={onShowAttachment} />
          
          <div onClick={(e) => e.stopPropagation()}>
            <Actions {...props} />
          </div>
        </div>
      </div>
    </div>
  )
}