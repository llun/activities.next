'use client'

import { AlertTriangle } from 'lucide-react'
import { FC, ReactNode, useId, useState } from 'react'

interface Props {
  children: ReactNode
  summary: string
}

export const ContentWarning: FC<Props> = ({ children, summary }) => {
  const [isExpanded, setIsExpanded] = useState(false)
  const contentId = useId()

  return (
    <div className="mt-2 rounded-md border border-border/70 bg-muted/30 px-3 py-2">
      <button
        type="button"
        className="flex w-full cursor-pointer items-center justify-between gap-3 text-left"
        onClick={(event) => {
          event.stopPropagation()
          setIsExpanded(!isExpanded)
        }}
        aria-expanded={isExpanded}
        aria-controls={isExpanded ? contentId : undefined}
        aria-label={isExpanded ? 'Hide content' : 'Show content'}
      >
        <div className="flex min-w-0 items-center gap-2">
          <AlertTriangle className="size-4 shrink-0 text-muted-foreground" />
          <span className="break-words text-sm font-medium">{summary}</span>
        </div>
        <span
          className="inline-flex h-8 shrink-0 items-center justify-center rounded-md border border-input bg-secondary px-3 text-sm font-medium text-secondary-foreground shadow-xs"
          aria-hidden="true"
        >
          {isExpanded ? 'Hide' : 'Show'}
        </span>
      </button>
      {isExpanded ? (
        <div id={contentId} className="mt-2">
          {children}
        </div>
      ) : null}
    </div>
  )
}
