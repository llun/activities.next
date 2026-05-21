import { formatDistance } from 'date-fns'
import _ from 'lodash'
import { Activity, ExternalLink, LoaderCircle, Repeat2 } from 'lucide-react'
import { FC } from 'react'

import { PostLineLimit } from '@/lib/types/database/rows'
import { ActorProfile } from '@/lib/types/domain/actor'
import {
  EditableStatus,
  Status,
  StatusNote,
  StatusPoll,
  StatusType
} from '@/lib/types/domain/status'
import {
  formatFitnessDistance,
  formatFitnessDuration,
  formatFitnessElevation,
  getFitnessPaceOrSpeed
} from '@/lib/utils/fitness'
import { getDeviceDisplayLabel } from '@/lib/utils/fitnessDeviceBrands'
import { cleanClassName } from '@/lib/utils/text/cleanClassName'
import {
  getActualStatus,
  processStatusText
} from '@/lib/utils/text/processStatusText'

import { BrandedDeviceLink } from './BrandedDeviceLink'
import { Actions } from './actions/actions'
import { ActorAvatar, ActorInfo, getActorIdMention } from './actor'
import { Attachments, OnMediaSelectedHandle } from './attachments'
import { CollapsibleContent } from './collapsible-content'
import { ContentWarning } from './content-warning'
import { Poll } from './poll'
import { RetryFitnessButton } from './retry-fitness-button'

export interface PostProps {
  host: string
  currentActor?: ActorProfile
  currentTime: number
  status: Status
  editable?: boolean
  showActions?: boolean
  onReply?: (status: Status) => void
  onEdit?: (status: EditableStatus) => void
  onPostDeleted?: (status: Status) => void
  onBookmarkChanged?: (
    status: StatusNote | StatusPoll,
    isBookmarked: boolean
  ) => void
  onOpenStatus?: (status: Status) => void
  onShowAttachment: OnMediaSelectedHandle
  collapsible?: boolean
  postLineLimit?: PostLineLimit
}

interface BoostStatusProps {
  status: Status
}

export const BoostStatus: FC<BoostStatusProps> = ({ status }) => {
  if (status.type !== StatusType.enum.Announce) return null
  const actorName =
    status.actor?.name ||
    status.actor?.username ||
    getActorIdMention(status.actorId)

  return (
    <div className="flex items-center gap-2 mb-1 text-sm text-muted-foreground ml-12">
      <Repeat2 className="size-4" />
      <span>Boosted by {actorName}</span>
    </div>
  )
}

export const Post: FC<PostProps> = (props) => {
  const { host, status, onShowAttachment, collapsible, postLineLimit } = props
  const actualStatus = getActualStatus(status)
  const externalStatusUrl = actualStatus.url || actualStatus.id
  const showExternalLink =
    !actualStatus.isLocalActor && Boolean(externalStatusUrl)
  const relativeCreatedAt = formatDistance(
    actualStatus.createdAt,
    props.currentTime
  )
  const actorName = actualStatus.actor
    ? actualStatus.actor.name || actualStatus.actor.username
    : null
  const openStatusLabel = actorName
    ? `Open status by ${actorName}, posted ${relativeCreatedAt} ago`
    : `Open status, posted ${relativeCreatedAt} ago`
  const timestampClassName = 'text-muted-foreground text-xs whitespace-nowrap'

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
  const isOwner =
    Boolean(actualStatus.isLocalActor) &&
    props.currentActor?.id === actualStatus.actorId
  const summary = actualStatus.summary?.trim()
  const statusBody = (
    <>
      {collapsible && postLineLimit !== 0 && !summary ? (
        <CollapsibleContent
          className="mt-1 text-sm leading-relaxed break-words"
          contentClassName="markdown-content"
          maxLines={postLineLimit}
        >
          {processedAndCleanedText}
        </CollapsibleContent>
      ) : (
        <div className="mt-1 text-sm leading-relaxed break-words markdown-content">
          {processedAndCleanedText}
        </div>
      )}
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
            isOwner ? (
              <RetryFitnessButton statusId={actualStatus.id} />
            ) : (
              <div className="mt-2 flex items-center gap-2 text-destructive">
                <span>
                  Processing failed. The original activity file is still
                  available.
                </span>
              </div>
            )
          ) : null}

          {isFitnessCompleted ? (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
              {fitnessDistance ? (
                <span>
                  Distance:{' '}
                  <strong className="text-foreground">{fitnessDistance}</strong>
                </span>
              ) : null}
              {fitnessDuration ? (
                <span>
                  Duration:{' '}
                  <strong className="text-foreground">{fitnessDuration}</strong>
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
              {getDeviceDisplayLabel(
                fitnessFile.deviceName,
                fitnessFile.deviceManufacturer
              ) ? (
                <span className="text-muted-foreground">
                  Via:{' '}
                  <BrandedDeviceLink
                    deviceName={fitnessFile.deviceName}
                    deviceManufacturer={fitnessFile.deviceManufacturer}
                  />
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <Poll
        status={actualStatus}
        currentTime={props.currentTime}
        currentActorId={props.currentActor?.id}
      />
      <Attachments status={actualStatus} onMediaSelected={onShowAttachment} />
    </>
  )

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <BoostStatus status={status} />
      <div className="flex min-w-0 gap-3">
        <div className="shrink-0">
          <ActorAvatar
            actor={actualStatus.actor}
            actorId={actualStatus.actorId}
            statusUrl={actualStatus.url}
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 text-sm">
            <ActorInfo
              actor={actualStatus.actor}
              actorId={actualStatus.actorId}
              statusUrl={actualStatus.url}
            />
            <span className="text-muted-foreground">·</span>
            {props.onOpenStatus ? (
              <button
                type="button"
                className={`${timestampClassName} -mx-1 inline-flex min-h-8 items-center rounded-sm px-1 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50`}
                aria-label={openStatusLabel}
                onClick={() => {
                  props.onOpenStatus?.(status)
                }}
              >
                {relativeCreatedAt}
              </button>
            ) : (
              <span className={timestampClassName}>{relativeCreatedAt}</span>
            )}
            {showExternalLink && (
              <a
                href={externalStatusUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-1 inline-flex items-center text-muted-foreground hover:text-foreground"
                aria-label="Open original post"
                title="Open original post"
              >
                <ExternalLink className="size-3.5" />
              </a>
            )}
          </div>

          {summary ? (
            <ContentWarning summary={summary}>{statusBody}</ContentWarning>
          ) : (
            statusBody
          )}

          <div>
            <Actions {...props} />
          </div>
        </div>
      </div>
    </div>
  )
}
