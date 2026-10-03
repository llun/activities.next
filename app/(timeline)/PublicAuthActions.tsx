import Link from 'next/link'
import { FC } from 'react'

import { Button } from '@/lib/components/ui/button'
import { cn } from '@/lib/utils'

export interface PublicAuthActionsProps {
  /** Whether the instance accepts sign-ups; "Create account" hides when closed. */
  registrationOpen: boolean
  signinHref?: string
  signupHref?: string
  /** `inline` for a top bar, `stacked` (full width) for the public drawer. */
  layout?: 'inline' | 'stacked'
  /** Closes the public drawer when a link is chosen. */
  onNavigate?: () => void
  className?: string
}

/**
 * The logged-out "Sign in" / "Create account" pair: one source for the public
 * top bar, the shared heatmap page and the public mobile drawer, so the
 * closed-registration rule is applied the same way everywhere. No hooks, so
 * both server and client components render it.
 */
export const PublicAuthActions: FC<PublicAuthActionsProps> = ({
  registrationOpen,
  signinHref = '/auth/signin',
  signupHref = '/auth/signup',
  layout = 'inline',
  onNavigate,
  className
}) => {
  const stacked = layout === 'stacked'
  return (
    <div
      className={cn(
        stacked ? 'flex flex-col gap-2' : 'flex items-center gap-2',
        className
      )}
    >
      <Button
        asChild
        variant="outline"
        size={stacked ? 'default' : 'sm'}
        className={stacked ? 'w-full' : undefined}
      >
        <Link href={signinHref} onClick={onNavigate}>
          Sign in
        </Link>
      </Button>
      {registrationOpen && (
        <Button
          asChild
          size={stacked ? 'default' : 'sm'}
          className={stacked ? 'w-full' : undefined}
        >
          <Link href={signupHref} onClick={onNavigate}>
            Create account
          </Link>
        </Button>
      )}
    </div>
  )
}
