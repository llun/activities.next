import { formatDistanceToNow } from 'date-fns'
import _ from 'lodash'
import { Activity, ExternalLink, LoaderCircle, Repeat2 } from 'lucide-react'
import { FC } from 'react'

import { ActorProfile } from '@/lib/types/domain/actor'
import { EditableStatus, Status, StatusType } from '@/lib/types/domain/status'
import {
  formatFitnessDistance,
  formatFitnessDuration,
  formatFitnessElevation,
  getFitnessPaceOrSpeed
} from '@/lib/utils/fitness'
import { cleanClassName } from '@/lib/utils/text/cleanClassName'
import {
  getActualStatus,
  processStatusText
} from '@/lib/utils/text/processStatusText'

import { Actions } from './actions/actions'
import { ActorAvatar, ActorInfo } from './actor'
import { Attachments, OnMediaSelectedHandle } from './attachments'
import { Poll } from './poll'

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
  const externalStatusUrl = actualStatus.url || actualStatus.id
  const showExternalLink =
    !actualStatus.isLocalActor && Boolean(externalStatusUrl)

  const processedAndCleanedText = _.chain(actualStatus)
    .thru((s) => processStatusText(host, s))
    .thru(cleanClassName)
    .value()
  const fitnessFile =
    actualStatus.type === StatusType.enum.Note ? actualStatus.fitness : null
  const fitnessProcessingStatus = fitnessFile?.processingStatus ?? 'completed'
  const isFitnessProcessing =
    fitnessProcessingStatus === 'pending' ||
    fitnessProcessingStatus === 'processing'
  const isFitnessFailed = fitnessProcessingStatus === 'failed'
  const isFitnessCompleted = fitnessProcessingStatus === 'completed'
  const fitnessDistance = formatFitnessDistance(
    fitnessFile?.totalDistanceMeters
  )
  const fitnessDuration = formatFitnessDuration(
    fitnessFile?.totalDurationSeconds
  )
  const fitnessElevation = formatFitnessElevation(
    fitnessFile?.elevationGainMeters
  )
  const fitnessPaceOrSpeed = getFitnessPaceOrSpeed({
    distanceMeters: fitnessFile?.totalDistanceMeters,
    durationSeconds: fitnessFile?.totalDurationSeconds,
    activityType: fitnessFile?.activityType
  })

  return (
    <div className="flex flex-col gap-1">
      <BoostStatus status={status} />
      <div className="flex gap-3">
        <div className="shrink-0">
          <ActorAvatar
            actor={actualStatus.actor}
            actorId={actualStatus.actorId}
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 text-sm">
            <ActorInfo
              actor={actualStatus.actor}
              actorId={actualStatus.actorId}
            />
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground text-xs whitespace-nowrap">
              {formatDistanceToNow(actualStatus.createdAt)}
            </span>
            {showExternalLink && (
              <a
                href={externalStatusUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => event.stopPropagation()}
                className="ml-1 inline-flex items-center text-muted-foreground hover:text-foreground"
                aria-label="Open original post"
                title="Open original post"
              >
                <ExternalLink className="size-3.5" />
              </a>
            )}
          </div>

          <div className="mt-1 text-sm leading-relaxed break-words markdown-content">
            {processedAndCleanedText}
          </div>
          {fitnessFile ? (
            <div className="mt-2 max-w-full rounded-md border bg-muted/30 px-3 py-2 text-xs">
              <div className="flex max-w-full items-center gap-2">
                <Activity className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="shrink-0 font-medium text-muted-foreground">
                  Fitness
                </span>
                <a
                  href={fitnessFile.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(event) => event.stopPropagation()}
                  className="truncate text-foreground underline-offset-2 hover:underline"
                  title={fitnessFile.fileName}
                >
                  {fitnessFile.fileName}
                </a>
                <span className="shrink-0 text-muted-foreground uppercase">
                  {fitnessFile.fileType}
                </span>
              </div>

              {isFitnessProcessing ? (
                <div className="mt-2 inline-flex items-center gap-2 text-muted-foreground">
                  <LoaderCircle className="size-3.5 animate-spin" />
                  <span>Processing fitness activity...</span>
                </div>
              ) : null}

              {isFitnessFailed ? (
                <div className="mt-2 text-destructive">
                  Processing failed. The original activity file is still
                  available.
                </div>
              ) : null}

              {isFitnessCompleted ? (
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
                  {fitnessDistance ? (
                    <span>
                      Distance:{' '}
                      <strong className="text-foreground">
                        {fitnessDistance}
                      </strong>
                    </span>
                  ) : null}
                  {fitnessDuration ? (
                    <span>
                      Duration:{' '}
                      <strong className="text-foreground">
                        {fitnessDuration}
                      </strong>
                    </span>
                  ) : null}
                  {fitnessPaceOrSpeed ? (
                    <span>
                      {fitnessPaceOrSpeed.label}:{' '}
                      <strong className="text-foreground">
                        {fitnessPaceOrSpeed.value}
                      </strong>
                    </span>
                  ) : null}
                  {fitnessElevation ? (
                    <span>
                      Elevation:{' '}
                      <strong className="text-foreground">
                        {fitnessElevation}
                      </strong>
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          <Poll
            status={actualStatus}
            currentTime={new Date()}
            currentActorId={props.currentActor?.id}
          />
          <Attachments
            status={actualStatus}
            onMediaSelected={onShowAttachment}
          />

          <div onClick={(e) => e.stopPropagation()}>
            <Actions {...props} />
          </div>
        </div>
      </div>
    </div>
  )
}
