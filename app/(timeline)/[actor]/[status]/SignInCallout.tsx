import Link from 'next/link'
import { FC } from 'react'

import { Button } from '@/lib/components/ui/button'

/**
 * Logged-out call-to-action shown on the focused status page where a logged-in
 * actor would see the reply box. Mirrors the design system's public status view
 * (SignInCallout): a subtle primary-tinted band prompting the visitor to sign in
 * to interact, or join the Fediverse from any server.
 */
export const SignInCallout: FC = () => (
  <div className="border-b bg-primary/5 px-5 py-5">
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
        <Button asChild size="sm">
          <Link href="/auth/signup">Create account</Link>
        </Button>
      </div>
    </div>
  </div>
)
