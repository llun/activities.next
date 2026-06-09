import Link from 'next/link'
import { FC } from 'react'

import { Button } from '@/lib/components/ui/button'
import { cn } from '@/lib/utils'

interface Props {
  className?: string
  /** Whether new-account sign-up is open; hides "Create account" when false. */
  registrationOpen?: boolean
}

export const SignInCallout: FC<Props> = ({
  className,
  registrationOpen = true
}) => (
  <div className={cn('border-b bg-primary/5 px-5 py-5', className)}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm font-semibold">Join the conversation</div>
        <p className="text-sm text-muted-foreground">
          Sign in to reply, like, and boost — or follow from any server in the
          Fediverse.
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href="/auth/signin">Sign in</Link>
        </Button>
        {registrationOpen && (
          <Button asChild size="sm">
            <Link href="/auth/signup">Create account</Link>
          </Button>
        )}
      </div>
    </div>
  </div>
)
