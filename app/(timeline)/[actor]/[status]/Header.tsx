'use client'

import { ArrowLeft } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { FC } from 'react'

import { Button } from '@/lib/components/ui/button'
import { cn } from '@/lib/utils'

interface Props {
  isFitnessDashboard?: boolean
  /**
   * Extra classes for the header bar. The conversation card no longer clips its
   * children (post overlays have to escape it), so that card rounds this — its
   * first child — itself.
   */
  className?: string
}

export const Header: FC<Props> = ({
  isFitnessDashboard = false,
  className
}) => {
  const router = useRouter()

  return (
    <div
      className={cn(
        'sticky top-0 z-10 flex items-center gap-3 border-b bg-background/90 px-5 py-3 backdrop-blur',
        className
      )}
    >
      <Button
        variant="ghost"
        size="icon"
        onClick={() => router.back()}
        className="h-8 w-8"
        aria-label="Go back"
      >
        <ArrowLeft className="h-4 w-4" />
      </Button>
      <div>
        <h1 className="text-lg font-semibold">
          {isFitnessDashboard ? 'Activity' : 'Post'}
        </h1>
        {!isFitnessDashboard && (
          <p className="text-xs text-muted-foreground">Conversation thread</p>
        )}
      </div>
    </div>
  )
}
