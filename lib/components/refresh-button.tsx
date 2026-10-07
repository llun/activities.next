'use client'

import { RefreshCw } from 'lucide-react'
import { FC } from 'react'

import { Button } from '@/lib/components/ui/button'
import { cn } from '@/lib/utils'

interface Props {
  onRefresh: () => void
  /** Spins the icon and disables the button while a reload is in flight. */
  refreshing?: boolean
  /** Names what is reloaded: "Refresh timeline", "Refresh fitness overview". */
  accessibleName: string
  className?: string
}

/**
 * The page-level reload control the home timeline introduced: an outline icon
 * button at the end of a header or section row whose icon spins while the
 * reload runs. It is a chrome control, so in dark it sits on the card surface
 * with the hairline border instead of the translucent outline fill.
 *
 * Use it wherever a surface can be reloaded in place, beside the shimmering
 * skeleton bars it then shows, rather than a hand-rolled Refresh button.
 */
export const RefreshButton: FC<Props> = ({
  onRefresh,
  refreshing = false,
  accessibleName,
  className
}) => (
  <Button
    type="button"
    variant="outline"
    size="icon"
    className={cn(
      'dark:border-border dark:bg-card dark:hover:bg-accent',
      className
    )}
    onClick={onRefresh}
    disabled={refreshing}
    aria-label={accessibleName}
  >
    <RefreshCw
      className={cn('size-4', refreshing && 'animate-spin')}
      aria-hidden="true"
    />
  </Button>
)
