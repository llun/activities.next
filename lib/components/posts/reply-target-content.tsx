import { FC, ReactNode } from 'react'

import { Status, getOriginalStatus } from '@/lib/types/domain/status'
import { cn } from '@/lib/utils'
import { cleanClassName } from '@/lib/utils/text/cleanClassName'
import { processStatusText } from '@/lib/utils/text/processStatusText'

interface Props {
  host: string
  status: Status
  className?: string
  // Rendered instead when the status has no text (an attachment-only post).
  fallback?: ReactNode
}

/**
 * The body of the status a composer is replying to, rendered through the same
 * pipeline and `markdown-content` styles as `post.tsx`, so mentions, hashtags,
 * links and custom emoji look the way they do in the status itself. Clamped to
 * two lines, with paragraphs run inline so the preview stays compact.
 */
export const ReplyTargetContent: FC<Props> = ({
  host,
  status,
  className,
  fallback = null
}) => {
  const actualStatus = getOriginalStatus(status)
  const text = processStatusText(host, actualStatus)
  if (!text) return <>{fallback}</>

  return (
    <div
      data-testid="reply-target-content"
      className={cn(
        "markdown-content line-clamp-2 break-words text-sm leading-relaxed text-foreground [&_p]:inline [&_p]:after:content-['_']",
        className
      )}
    >
      {cleanClassName(text, {
        // Read it as `post.tsx` renders the body: the "RE: <link>" fallback
        // hides once a quote card renders for the status.
        hideQuoteInline: Boolean(actualStatus.quote),
        host,
        tags: actualStatus.tags
      })}
    </div>
  )
}
