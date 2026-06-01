import _ from 'lodash'
import { Activity, Download } from 'lucide-react'
import { FC, MouseEvent } from 'react'

import { Media } from '@/lib/components/posts/media'
import { Avatar, AvatarFallback, AvatarImage } from '@/lib/components/ui/avatar'
import { Attachment } from '@/lib/types/domain/attachment'
import { Status } from '@/lib/types/domain/status'
import { cn } from '@/lib/utils'
import {
  formatFitnessDistance,
  formatFitnessDuration,
  formatFitnessElevation
} from '@/lib/utils/fitness'
import { cleanClassName } from '@/lib/utils/text/cleanClassName'
import { htmlToPlainText } from '@/lib/utils/text/htmlToPlainText'
import {
  getActualStatus,
  processStatusText
} from '@/lib/utils/text/processStatusText'

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit'
})

const getInitial = (value: string) =>
  value.trim().length > 0 ? value.trim()[0].toUpperCase() : '?'

const isVisualMedia = (attachment: Attachment) =>
  attachment.mediaType.startsWith('image') ||
  attachment.mediaType.startsWith('video')

interface MessageBubbleProps {
  host: string
  status: Status
  isOwn: boolean
  onShowAttachment: (attachments: Attachment[], index: number) => void
}

export const MessageBubble: FC<MessageBubbleProps> = ({
  host,
  status,
  isOwn,
  onShowAttachment
}) => {
  const actualStatus = getActualStatus(status)
  const actor = actualStatus.actor
  const authorName = actor?.name || actor?.username || ''
  const mediaAttachments = actualStatus.attachments.filter(isVisualMedia)
  const fitnessFile = actualStatus.fitness
  const hasText = htmlToPlainText(actualStatus.text ?? '').trim().length > 0
  const processedText = hasText
    ? _.chain(status)
        .thru((value) => processStatusText(host, value))
        .thru(cleanClassName)
        .value()
    : null
  const time = timeFormatter.format(new Date(actualStatus.createdAt))

  const fitnessMeta = fitnessFile
    ? [
        formatFitnessDistance(fitnessFile.totalDistanceMeters),
        formatFitnessDuration(fitnessFile.totalDurationSeconds),
        formatFitnessElevation(fitnessFile.elevationGainMeters)
      ]
        .filter((value): value is string => Boolean(value))
        .join(' · ')
    : ''
  const fitnessLabel = fitnessFile
    ? [fitnessFile.fileType.toUpperCase(), fitnessMeta]
        .filter(Boolean)
        .join(' · ')
    : ''

  const handleMediaClick = (index: number) => (event: MouseEvent) => {
    event.stopPropagation()
    onShowAttachment(mediaAttachments, index)
  }

  return (
    <div
      className={cn(
        'flex items-end gap-2',
        isOwn ? 'justify-end' : 'justify-start'
      )}
    >
      {!isOwn && (
        <Avatar className="size-7 shrink-0">
          {actor?.iconUrl && <AvatarImage src={actor.iconUrl} alt="" />}
          <AvatarFallback>{getInitial(authorName)}</AvatarFallback>
        </Avatar>
      )}
      <div
        className={cn(
          'flex max-w-[78%] flex-col gap-1',
          isOwn ? 'items-end' : 'items-start'
        )}
      >
        {mediaAttachments.length === 1 ? (
          <button
            type="button"
            onClick={handleMediaClick(0)}
            className="block overflow-hidden rounded-2xl border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <Media
              className="block max-h-72 w-full object-cover"
              attachment={mediaAttachments[0]}
            />
          </button>
        ) : mediaAttachments.length > 1 ? (
          <div className="grid w-full max-w-80 grid-cols-2 gap-[3px] overflow-hidden rounded-2xl border">
            {mediaAttachments.map((attachment, index) => (
              <button
                key={attachment.id}
                type="button"
                onClick={handleMediaClick(index)}
                className="block h-32 overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
              >
                <Media
                  className="h-full w-full object-cover"
                  attachment={attachment}
                />
              </button>
            ))}
          </div>
        ) : null}

        {fitnessFile && (
          <a
            href={fitnessFile.url}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              'flex max-w-full items-center gap-3 rounded-2xl border px-3 py-2.5',
              isOwn
                ? 'border-transparent bg-primary text-primary-foreground'
                : 'bg-muted text-foreground'
            )}
          >
            <span
              className={cn(
                'flex size-10 shrink-0 items-center justify-center rounded-lg',
                isOwn
                  ? 'bg-primary-foreground/20 text-primary-foreground'
                  : 'bg-primary/10 text-primary'
              )}
            >
              <Activity className="size-5" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">
                {fitnessFile.fileName}
              </span>
              {fitnessLabel && (
                <span
                  className={cn(
                    'block truncate text-xs',
                    isOwn
                      ? 'text-primary-foreground/80'
                      : 'text-muted-foreground'
                  )}
                >
                  {fitnessLabel}
                </span>
              )}
            </span>
            <Download
              className={cn(
                'ml-1 size-4 shrink-0',
                isOwn ? 'text-primary-foreground/90' : 'text-muted-foreground'
              )}
            />
          </a>
        )}

        {processedText && (
          <div
            className={cn(
              'markdown-content max-w-full overflow-hidden break-words rounded-2xl px-3.5 py-2 text-sm leading-relaxed',
              isOwn
                ? 'rounded-br-md bg-primary text-primary-foreground [&_a]:text-primary-foreground [&_a]:underline'
                : 'rounded-bl-md bg-muted text-foreground'
            )}
          >
            {processedText}
          </div>
        )}

        <div className="px-1 text-[11px] text-muted-foreground">{time}</div>
      </div>
    </div>
  )
}
