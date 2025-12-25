import { formatDistance } from 'date-fns'
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
import { Actor } from './Actor'
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
    <div className="flex items-center mb-1">
      <Repeat2 className="size-4 mr-2" />
      <span className="mr-2 whitespace-nowrap">Boost by</span>
      <Actor
        className="flex-1"
        actor={status.actor}
        actorId={status.actorId}
      />
    </div>
  )
}

export const Post: FC<PostProps> = (props) => {
  const { host, status, currentTime, onShowAttachment } = props
  const actualStatus = getActualStatus(status)

  const processedAndCleanedText = _.chain(actualStatus)
    .thru((s) => processStatusText(host, s))
    .thru(cleanClassName)
    .value()

  return (
    <div key={status.id} className="[&_p]:whitespace-pre-wrap [&_video]:max-w-full">
      <BoostStatus status={status} />
      <div className="flex mb-2">
        <Actor
          className="flex-1 overflow-hidden mr-2"
          actor={actualStatus.actor}
          actorId={actualStatus.actorId}
        />
        <div className="shrink-0 flex flex-row items-center">
          <a href={actualStatus.url} target="_blank" rel="noreferrer">
            {formatDistance(actualStatus.createdAt, currentTime)}
          </a>
        </div>
      </div>
      <div className="mr-1 break-words">{processedAndCleanedText}</div>
      <Poll status={actualStatus} currentTime={currentTime} />
      <Attachments status={actualStatus} onMediaSelected={onShowAttachment} />
      <Actions {...props} />
    </div>
  )
}
