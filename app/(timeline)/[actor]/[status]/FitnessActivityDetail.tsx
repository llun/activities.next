import { formatDistance } from 'date-fns'
import {
  ExternalLink,
  Flame,
  Gauge,
  HeartPulse,
  Mountain,
  Route,
  Timer,
  Zap
} from 'lucide-react'
import Link from 'next/link'
import { FC } from 'react'

import { Media } from '@/lib/components/posts/media'
import { Post } from '@/lib/components/posts/post'
import { StatusActivityData } from '@/lib/services/fitness/activityData'
import { ActorProfile } from '@/lib/types/domain/actor'
import { Attachment } from '@/lib/types/domain/attachment'
import { Status, StatusType } from '@/lib/types/domain/status'
import { cn } from '@/lib/utils'
import { getActualStatus } from '@/lib/utils/text/processStatusText'

import {
  formatActivityDistance,
  formatActivityDuration,
  formatActivityElevation,
  formatActivityStartDate,
  getEffortMetric
} from './activityFormat'

interface Props {
  host: string
  currentTime: Date
  currentActor?: ActorProfile | null
  status: Status
  activity: StatusActivityData
  onShowAttachment: (
    allMedias: Attachment[],
    selectedMediaIndex: number
  ) => void
}

interface StatCardProps {
  label: string
  value: string
  icon: FC<{ className?: string }>
  compact?: boolean
}

const StatCard: FC<StatCardProps> = ({ label, value, icon: Icon, compact }) => (
  <div
    className={cn(
      'rounded-lg border border-border/60 bg-muted/30 p-3',
      compact ? 'min-h-[88px]' : 'min-h-[108px]'
    )}
  >
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <Icon className="size-3.5" />
      <span>{label}</span>
    </div>
    <p
      className={cn(
        'mt-2 font-semibold tracking-tight',
        compact ? 'text-lg' : 'text-2xl'
      )}
    >
      {value}
    </p>
  </div>
)

const withoutAttachments = (status: Status): Status => {
  if (status.type === StatusType.enum.Announce) {
    return {
      ...status,
      originalStatus: {
        ...status.originalStatus,
        attachments: []
      }
    }
  }

  return {
    ...status,
    attachments: []
  }
}

export const FitnessActivityDetail: FC<Props> = ({
  host,
  currentTime,
  currentActor,
  status,
  activity,
  onShowAttachment
}) => {
  const actualStatus = getActualStatus(status)
  const effort = getEffortMetric(activity.type, activity.averageSpeed)

  const mapAttachmentIndexById = actualStatus.attachments.findIndex(
    (attachment) => attachment.id === activity.mapAttachmentId
  )
  const fallbackMapAttachmentIndex = actualStatus.attachments.findIndex(
    (attachment) => attachment.mediaType.startsWith('image')
  )
  const mapAttachmentIndex =
    mapAttachmentIndexById >= 0
      ? mapAttachmentIndexById
      : fallbackMapAttachmentIndex
  const mapAttachment =
    mapAttachmentIndex >= 0
      ? actualStatus.attachments[mapAttachmentIndex]
      : null

  const detailStatus = withoutAttachments(status)

  return (
    <div className="space-y-4">
      <section className="rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {activity.sportType || activity.type}
            </p>
            <h2 className="text-2xl font-semibold tracking-tight">
              {activity.name}
            </h2>
            <p className="text-xs text-muted-foreground">
              {formatActivityStartDate(activity.startDate)} · posted{' '}
              {formatDistance(actualStatus.createdAt, currentTime, {
                addSuffix: true
              })}
            </p>
          </div>

          <Link
            href={activity.stravaUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium hover:bg-muted"
          >
            Open in Strava
            <ExternalLink className="size-3.5" />
          </Link>
        </div>
      </section>

      {mapAttachment && (
        <button
          className="block w-full overflow-hidden rounded-xl border border-border/60 bg-muted/20 text-left"
          onClick={() =>
            onShowAttachment(actualStatus.attachments, mapAttachmentIndex)
          }
        >
          <Media
            className="h-full max-h-[460px] w-full object-cover"
            attachment={mapAttachment}
          />
        </button>
      )}

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Distance"
          value={formatActivityDistance(activity.distance)}
          icon={Route}
        />
        <StatCard
          label="Moving time"
          value={formatActivityDuration(activity.movingTime)}
          icon={Timer}
        />
        <StatCard label={effort.label} value={effort.value} icon={Gauge} />
        <StatCard
          label="Elevation"
          value={formatActivityElevation(activity.totalElevationGain)}
          icon={Mountain}
        />

        {activity.averageHeartrate ? (
          <StatCard
            label="Avg heart rate"
            value={`${Math.round(activity.averageHeartrate)} bpm`}
            icon={HeartPulse}
            compact
          />
        ) : null}

        {activity.averageWatts ? (
          <StatCard
            label="Avg power"
            value={`${Math.round(activity.averageWatts)} W`}
            icon={Zap}
            compact
          />
        ) : null}

        {activity.calories ? (
          <StatCard
            label="Calories"
            value={`${Math.round(activity.calories)} kcal`}
            icon={Flame}
            compact
          />
        ) : null}
      </section>

      <section className="rounded-xl border border-border/60 bg-background/80 p-4">
        <Post
          host={host}
          currentActor={currentActor ?? undefined}
          currentTime={currentTime}
          status={detailStatus}
          showActions
          onShowAttachment={onShowAttachment}
        />
      </section>
    </div>
  )
}
