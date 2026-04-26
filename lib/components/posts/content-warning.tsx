'use client'

import { AlertTriangle } from 'lucide-react'
import { FC, ReactNode, useId, useState } from 'react'

import { Button } from '@/lib/components/ui/button'

interface Props {
  children: ReactNode
  summary: string
}

export const ContentWarning: FC<Props> = ({ children, summary }) => {
  const [isExpanded, setIsExpanded] = useState(false)
  const contentId = useId()

  return (
    <div className="mt-2 rounded-md border border-border/70 bg-muted/30 px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <AlertTriangle className="size-4 shrink-0 text-muted-foreground" />
          <span className="break-words text-sm font-medium">{summary}</span>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={(event) => {
            event.stopPropagation()
            setIsExpanded(!isExpanded)
          }}
          aria-expanded={isExpanded}
          aria-controls={contentId}
          aria-label={isExpanded ? 'Hide content' : 'Show content'}
        >
          {isExpanded ? 'Hide' : 'Show'}
        </Button>
      </div>
      {isExpanded ? (
        <div id={contentId} className="mt-2">
          {children}
        </div>
      ) : null}
    </div>
  )
}
