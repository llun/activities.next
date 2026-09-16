import { CornerDownRight } from 'lucide-react'
import Link from 'next/link'
import { FC } from 'react'

import { TimelineParentPreview } from '@/lib/types/domain/timeline'
import { cn } from '@/lib/utils'

const stripHtml = (html: string): string =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

export interface StatusContextIndicatorProps {
  parentPreview?: TimelineParentPreview | null
  isReply?: boolean
  className?: string
}

export const StatusContextIndicator: FC<StatusContextIndicatorProps> = ({
  parentPreview,
  isReply,
  className
}) => {
  // Case 1: Known parent preview with permitted context
  if (parentPreview) {
    const actor = parentPreview.actor
    const displayName = actor.name || actor.username
    const handle = actor.domain
      ? `@${actor.username}@${actor.domain}`
      : `@${actor.username}`
    const accessibleLabel = `Reply to @${actor.username}`

    const hasCw = Boolean(
      parentPreview.isSensitive || parentPreview.spoilerText
    )
    const snippet = hasCw
      ? null
      : parentPreview.text || stripHtml(parentPreview.contentHtml || '')

    const content = (
      <div
        className={cn(
          'flex min-w-0 max-w-full items-center gap-2 rounded-md border border-border/60 bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/60 ml-12 mb-1',
          className
        )}
        aria-label={accessibleLabel}
      >
        <CornerDownRight
          className="size-3.5 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        {actor.avatarUrl ? (
          <img
            src={actor.avatarUrl}
            alt=""
            className="size-4 shrink-0 rounded-full object-cover"
          />
        ) : (
          <div className="size-4 shrink-0 rounded-full bg-muted-foreground/20" />
        )}
        <span className="shrink-0 font-medium text-foreground truncate max-w-[120px]">
          {displayName}
        </span>
        <span className="shrink-0 text-muted-foreground/80 truncate max-w-[140px]">
          {handle}
        </span>
        {hasCw ? (
          <span className="shrink-0 rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
            CW: {parentPreview.spoilerText || 'Sensitive content'}
          </span>
        ) : snippet ? (
          <span className="truncate text-muted-foreground/70">· {snippet}</span>
        ) : null}
      </div>
    )

    if (parentPreview.url) {
      return (
        <Link
          href={parentPreview.url}
          prefetch={false}
          onClick={(e) => e.stopPropagation()}
          className="inline-block max-w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded-md"
        >
          {content}
        </Link>
      )
    }

    return content
  }

  // Case 2: Reply target exists, but parent context is not available or unknown
  if (isReply) {
    return (
      <div
        className={cn(
          'flex items-center gap-1.5 text-xs text-muted-foreground ml-12 mb-1',
          className
        )}
        aria-label="In reply to a post"
      >
        <CornerDownRight className="size-3.5 shrink-0" aria-hidden="true" />
        <span>In reply to a post</span>
      </div>
    )
  }

  return null
}
