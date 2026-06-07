import { Fingerprint } from 'lucide-react'
import Link from 'next/link'
import { FC } from 'react'

import { Button } from '@/lib/components/ui/button'

interface LandingAuthPanelProps {
  serviceName: string
}

/**
 * Right column of the logged-out landing: the minimal create/sign-in entry. The
 * CTAs link to the real auth routes (`/auth/signup`, `/auth/signin`) rather than
 * re-implementing the credential/passkey flows; the passkey CTA points at the
 * sign-in page where the WebAuthn button lives.
 */
export const LandingAuthPanel: FC<LandingAuthPanelProps> = ({
  serviceName
}) => (
  <div className="flex h-full flex-col justify-center px-7 py-9 sm:px-14 sm:py-14">
    <div className="mx-auto w-full max-w-[360px]">
      <h2 className="text-2xl font-semibold tracking-tight">
        Join {serviceName}
      </h2>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Create an account or sign in to continue.
      </p>

      <div className="mt-7 flex flex-col gap-2.5">
        <Button asChild className="h-11 w-full">
          <Link href="/auth/signup">Create account</Link>
        </Button>
        <Button asChild variant="outline" className="h-11 w-full">
          <Link href="/auth/signin">Sign in</Link>
        </Button>
      </div>

      <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>

      <Button asChild variant="outline" className="h-11 w-full">
        <Link href="/auth/signin">
          <Fingerprint className="size-4" /> Continue with a passkey
        </Link>
      </Button>

      <p className="mt-7 text-xs leading-relaxed text-muted-foreground">
        By continuing you agree to the Terms and Privacy Policy.
      </p>
    </div>
  </div>
)
