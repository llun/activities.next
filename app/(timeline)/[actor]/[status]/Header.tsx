'use client'

import { ArrowLeft } from 'lucide-react'
import { FC } from 'react'

import { BackLink } from '@/lib/components/back-link'
import { MOBILE_BACK_ROW_CLASS } from '@/lib/components/layout/chromeLayout'
import { useInAppBack } from '@/lib/components/navigation-history/useInAppBack'
import { Button } from '@/lib/components/ui/button'
import { cn } from '@/lib/utils'

interface Props {
  isFitnessDashboard?: boolean
  /**
   * Where the mobile Back goes when there is no in-app page to return to —
   * a permalink opened from elsewhere, a bookmark, a fresh tab: the viewed
   * author's profile.
   */
  fallbackHref: string
}

/**
 * The post / activity card's first row.
 *
 * From `md` up it is the bar it always was: an icon Back (`router.back()`)
 * beside "Post" / "Activity". Below `md` the page title lives in the mobile
 * compact bar above the card, so this row is only a labelled Back: "Back"
 * through browser history when this tab arrived from a page inside the app,
 * otherwise a real link "Back to profile" — never a Back that leaves the app.
 */
export const Header: FC<Props> = ({
  isFitnessDashboard = false,
  fallbackHref
}) => {
  const { canGoBack, goBack } = useInAppBack()

  return (
    <div className="sticky top-0 z-10 flex items-center gap-3 border-b bg-surface-chrome px-5 py-3 backdrop-blur max-md:bg-transparent max-md:px-4 max-md:py-0.5 max-md:backdrop-blur-none">
      <Button
        variant="ghost"
        size="icon"
        onClick={goBack}
        className="h-8 w-8 max-md:hidden"
        aria-label="Go back"
      >
        <ArrowLeft className="h-4 w-4" />
      </Button>
      {canGoBack ? (
        <button
          type="button"
          onClick={goBack}
          className={cn(
            'inline-flex items-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring md:hidden',
            MOBILE_BACK_ROW_CLASS
          )}
        >
          <ArrowLeft className="size-4 shrink-0" aria-hidden="true" />
          <span>Back</span>
        </button>
      ) : (
        <BackLink
          href={fallbackHref}
          label="Back to profile"
          prefetch={false}
          className="md:hidden"
        />
      )}
      <div className="max-md:hidden">
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
